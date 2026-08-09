/**
 * Pass-slot lifecycle.
 *
 * Ownership rule: when a claim is confirmed, the original voter flips to
 * `da_pass` AND the claimer is given a new (or upserted) vote with status
 * `thang`. This makes multi-hop chains (A → B → C) trivial — each owner is a
 * real voter, so requestPass works the same way at every hop.
 *
 * `pass_requests` is a workflow ledger (open → claimed → confirmed); it does
 * NOT decide seat ownership. That's seat-attribution's job, off the votes
 * table.
 *
 * Public entry points (all return `IntentResult`):
 *   - requestPass         — passer opens the pass (auto-routes to vãng lai queue)
 *   - cancelPass          — passer changes their mind before claim
 *   - claimAndConfirm     — manual claim + payment in one click (atomic)
 *   - confirmPass         — auto-assigned claimer marks "đã thanh toán"
 *
 * Preconditions are centralised in the `assert…` helpers below — every
 * mutation goes through them so locked-month / self-claim / ownership rules
 * have one home.
 */
import { and, eq, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb, schema } from "~/db/client";
import { audit } from "./audit.server";
import { tryAutoMatch, type AutoMatchResult } from "./auto-match.server";
import { transferSeatToClaimer } from "./seat-transfer.server";
import { computeAutoMatchPayment } from "./auto-match.server";
import { getPrices } from "./config.server";
import { priceForPassRefund } from "./pricing";

export type IntentResult =
  | { ok: true; autoMatch?: AutoMatchResult }
  | { error: string; status?: number };

/* ---------------- Preconditions (single source of truth) ---------------- */

/**
 * Pass-slot actions only happen in "Đã đặt sân" (DB `done`). Voting / locked
 * months pre-date the booked-courts phase and can't host pass slots yet.
 *
 * Month status is the only time guard — there is no registration deadline (B34).
 * An open pass stays open and claimable right up to the session; the admin sorts
 * out whatever is left over by hand.
 */
async function assertSessionInBookedMonth(
  d1: D1Database,
  playSessionId: string,
): Promise<IntentResult> {
  const db = getDb(d1);
  const session = await db.query.playSessions.findFirst({
    where: eq(schema.playSessions.id, playSessionId),
  });
  if (!session) return { error: "Buổi không hợp lệ.", status: 404 };
  const month = await db.query.months.findFirst({
    where: eq(schema.months.id, session.monthId),
  });
  if (month?.status !== "done") {
    return { error: "Pass slot chỉ thực hiện được sau khi lịch 'Đã đặt sân'.", status: 400 };
  }
  return { ok: true };
}

/** Caller must be the owner of the vote. */
function assertVoteOwnedBy(vote: schema.Vote | undefined, userId: string): IntentResult {
  if (!vote) return { error: "Không tìm thấy vote.", status: 404 };
  if (vote.userId !== userId) return { error: "Không hợp lệ.", status: 403 };
  return { ok: true };
}

/** Claimer must not be the original voter, and must not already hold an
 *  attending seat (thang / vang_lai) on the same session. */
async function assertCanClaim(
  d1: D1Database,
  claimerId: string,
  originalVote: schema.Vote,
): Promise<IntentResult> {
  if (originalVote.userId === claimerId) {
    return { error: "Không nhận slot của chính mình.", status: 400 };
  }
  const db = getDb(d1);
  const existing = await db.query.votes.findFirst({
    where: and(
      eq(schema.votes.userId, claimerId),
      eq(schema.votes.playSessionId, originalVote.playSessionId),
    ),
  });
  if (existing && (existing.status === "thang" || existing.status === "vang_lai")) {
    return { error: "Bạn đã có slot cho buổi này — không cần nhận pass.", status: 400 };
  }
  return { ok: true };
}

/* ---------------- Public entry points ---------------- */

export async function requestPass(
  d1: D1Database,
  userId: string,
  voteId: string,
): Promise<IntentResult> {
  const db = getDb(d1);
  const vote = await db.query.votes.findFirst({ where: eq(schema.votes.id, voteId) });
  const owned = assertVoteOwnedBy(vote, userId);
  if ("error" in owned) return owned;
  if (vote!.status !== "thang" && vote!.status !== "vang_lai") {
    return { error: "Chỉ slot đặt-tháng hoặc vãng lai mới pass được.", status: 400 };
  }
  const mutable = await assertSessionInBookedMonth(d1, vote!.playSessionId);
  if ("error" in mutable) return mutable;

  const existing = await db.query.passRequests.findFirst({
    where: and(eq(schema.passRequests.voteId, voteId), isNull(schema.passRequests.claimedAt)),
  });
  if (existing) return { error: "Đã gửi yêu cầu pass.", status: 400 };
  // Đã đăng ký vãng lai cùng buổi → không được vừa pass vừa vãng lai.
  // (Trường hợp này hiếm vì registerVangLai cũng chặn thang/vang_lai, nhưng
  // để chắc chắn không tự auto-match với chính mình.)
  const pendingVangLai = await db.query.extraSlotRequests.findFirst({
    where: and(
      eq(schema.extraSlotRequests.userId, userId),
      eq(schema.extraSlotRequests.playSessionId, vote!.playSessionId),
      isNull(schema.extraSlotRequests.approvedAt),
      isNull(schema.extraSlotRequests.cancelledAt),
      isNull(schema.extraSlotRequests.rejectedAt),
    ),
  });
  if (pendingVangLai) {
    return {
      error: "Bạn đang đăng ký vãng lai cùng buổi — huỷ trước khi pass slot.",
      status: 400,
    };
  }
  const reqId = ulid();
  const now = Date.now();
  await db.insert(schema.passRequests).values({
    id: reqId,
    voteId,
    createdAt: now,
    originalVoteStatus: vote!.status,
  });
  await db.update(schema.votes).set({ status: "cho_pass" }).where(eq(schema.votes.id, voteId));
  await audit(d1, {
    kind: "pass_requested",
    actorUserId: userId,
    playSessionId: vote!.playSessionId,
    voteId,
  });

  // Auto-route the slot to the earliest pending vãng lai on this session — if
  // anyone is queued, they get the seat immediately (instant flip, no manual
  // confirm step per B27). The match info bubbles up through IntentResult so
  // the route handler can fire the two auto-match emails after the mutation.
  const match = await tryAutoMatch(d1, vote!.playSessionId);
  return { ok: true, ...(match ? { autoMatch: match } : {}) };
}

export async function cancelPass(
  d1: D1Database,
  userId: string,
  voteId: string,
): Promise<IntentResult> {
  const db = getDb(d1);
  const vote = await db.query.votes.findFirst({ where: eq(schema.votes.id, voteId) });
  const owned = assertVoteOwnedBy(vote, userId);
  if ("error" in owned) return owned;
  const pr = await db.query.passRequests.findFirst({
    where: and(eq(schema.passRequests.voteId, voteId), isNull(schema.passRequests.claimedAt)),
  });
  if (!pr) return { error: "Không tìm thấy.", status: 400 };
  await db.delete(schema.passRequests).where(eq(schema.passRequests.id, pr.id));
  // Chỉ restore status khi vote vẫn còn ở "cho_pass". Trường hợp orphan
  // (vote đã bị overwrite sang vang_lai/thang qua đường khác) thì để nguyên —
  // user giữ ghế hiện tại, chỉ cần dọn pass_request mồ côi.
  if (vote!.status === "cho_pass") {
    await db
      .update(schema.votes)
      .set({ status: pr.originalVoteStatus })
      .where(eq(schema.votes.id, voteId));
  }
  await audit(d1, {
    kind: "pass_cancelled",
    actorUserId: userId,
    playSessionId: vote!.playSessionId,
    voteId,
  });
  return { ok: true };
}

/**
 * Atomic claim + confirm — the user has paid externally before clicking, so
 * the seat moves immediately and `confirmedAt` is set in the same write.
 */
export async function claimAndConfirm(
  d1: D1Database,
  userId: string,
  requestId: string,
): Promise<IntentResult> {
  const db = getDb(d1);
  const reqRow = await db.query.passRequests.findFirst({
    where: eq(schema.passRequests.id, requestId),
  });
  if (!reqRow) return { error: "Không tìm thấy yêu cầu.", status: 404 };
  const originalVote = await db.query.votes.findFirst({
    where: eq(schema.votes.id, reqRow.voteId),
  });
  if (!originalVote) return { error: "Không tìm thấy vote gốc.", status: 500 };

  const mutable = await assertSessionInBookedMonth(d1, originalVote.playSessionId);
  if ("error" in mutable) return mutable;
  if (reqRow.rejectedAt) return { error: "Yêu cầu pass đã bị từ chối.", status: 400 };
  const canClaim = await assertCanClaim(d1, userId, originalVote);
  if ("error" in canClaim) return canClaim;

  const now = Date.now();
  const result = await db
    .update(schema.passRequests)
    .set({ claimedByUserId: userId, claimedAt: now, confirmedAt: now })
    .where(and(eq(schema.passRequests.id, requestId), isNull(schema.passRequests.claimedAt)))
    .returning({ id: schema.passRequests.id });
  if (result.length === 0) return { error: "Slot đã có người nhận khác.", status: 409 };

  await transferSeatToClaimer(d1, userId, originalVote, now);
  await cancelMyPendingVangLai(d1, userId, originalVote.playSessionId, now);

  const meta = await buildPaymentMeta(d1, userId, originalVote);
  await audit(d1, {
    kind: "pass_confirmed",
    actorUserId: userId,
    subjectUserId: originalVote.userId,
    playSessionId: originalVote.playSessionId,
    voteId: originalVote.id,
    meta,
  });
  return { ok: true };
}

/**
 * Build payment-breakdown meta for the `pass_confirmed` audit so the history
 * sheet can render "A xác nhận đã chuyển 50k cho B [và 10k cho quỹ]". Uses
 * the same cross-gender split rule as auto-match emails.
 */
async function buildPaymentMeta(
  d1: D1Database,
  claimerId: string,
  originalVote: schema.Vote,
): Promise<Record<string, unknown> | undefined> {
  const db = getDb(d1);
  const [prices, payer, payee] = await Promise.all([
    getPrices(d1),
    db.query.users.findFirst({ where: eq(schema.users.id, claimerId) }),
    db.query.users.findFirst({ where: eq(schema.users.id, originalVote.userId) }),
  ]);
  if (!payer || !payee) return undefined;
  const split = computeAutoMatchPayment(payer.gender, payee.gender, prices);
  return {
    toPassSlotter: split.toPassSlotter,
    toQuyExtra: split.toQuyExtra,
    fromQuyShortage: split.fromQuyShortage,
  };
}

/**
 * Finalize an auto-assigned claim. The seat was already transferred at
 * auto-assign time; this just records that the claimer paid externally and
 * stamps `confirmedAt` so the payment banner clears.
 */
export async function confirmPass(
  d1: D1Database,
  userId: string,
  requestId: string,
): Promise<IntentResult> {
  const db = getDb(d1);
  const row = await db.query.passRequests.findFirst({
    where: eq(schema.passRequests.id, requestId),
  });
  if (!row) return { error: "Không tìm thấy yêu cầu.", status: 404 };
  if (row.claimedByUserId !== userId) return { error: "Slot không thuộc bạn.", status: 403 };
  if (row.confirmedAt) return { ok: true };
  const now = Date.now();
  await db
    .update(schema.passRequests)
    .set({ confirmedAt: now })
    .where(eq(schema.passRequests.id, requestId));
  const originalVote = await db.query.votes.findFirst({
    where: eq(schema.votes.id, row.voteId),
  });
  if (originalVote) {
    // Seat transfer is idempotent — auto-assign already did it.
    await transferSeatToClaimer(d1, userId, originalVote, now);
    await cancelMyPendingVangLai(d1, userId, originalVote.playSessionId, now);
    const meta = await buildPaymentMeta(d1, userId, originalVote);
    await audit(d1, {
      kind: "pass_confirmed",
      actorUserId: userId,
      subjectUserId: originalVote.userId,
      playSessionId: originalVote.playSessionId,
      voteId: originalVote.id,
      meta,
    });
  }
  return { ok: true };
}

/* ---------------- Admin queue actions ---------------- */

/**
 * Admin approves a refund on an unmatched pass-slot. Vote flips to `hoan_tien`
 * (bill excludes), passRequest stays for audit. Returns the pass-slotter's
 * userId + sessionId so caller can send the refund email.
 */
export async function approvePassRefund(
  d1: D1Database,
  passRequestId: string,
  adminUserId: string,
): Promise<{ ok: true; userId: string; playSessionId: string; voteId: string } | { ok: false }> {
  const db = getDb(d1);
  const pr = await db.query.passRequests.findFirst({
    where: eq(schema.passRequests.id, passRequestId),
  });
  if (!pr) return { ok: false };
  if (pr.claimedAt || pr.rejectedAt) return { ok: false };
  const vote = await db.query.votes.findFirst({ where: eq(schema.votes.id, pr.voteId) });
  if (!vote || vote.status !== "cho_pass") return { ok: false };
  const now = Date.now();
  await db
    .update(schema.votes)
    .set({ status: "hoan_tien" })
    .where(eq(schema.votes.id, vote.id));
  await db
    .update(schema.passRequests)
    .set({ confirmedAt: now })
    .where(eq(schema.passRequests.id, passRequestId));
  // Track the obligation: quỹ owes this voter the per-session thang value.
  // Snapshot the amount so future price changes don't rewrite history.
  const [user, prices] = await Promise.all([
    db.query.users.findFirst({ where: eq(schema.users.id, vote.userId) }),
    getPrices(d1),
  ]);
  if (user) {
    await db
      .insert(schema.refundPayments)
      .values({
        voteId: vote.id,
        amount: priceForPassRefund(user.gender, prices),
        createdAt: now,
      })
      .onConflictDoNothing();
  }
  await audit(d1, {
    kind: "refund_issued",
    actorUserId: adminUserId,
    subjectUserId: vote.userId,
    playSessionId: vote.playSessionId,
    voteId: vote.id,
  });
  return { ok: true, userId: vote.userId, playSessionId: vote.playSessionId, voteId: vote.id };
}

/**
 * Admin rejects an unmatched pass-slot. Vote reverts to `thang` (B29 — they
 * still pay as if they played) and rejectedAt marks the failed attempt for
 * history.
 */
export async function rejectPassRequest(
  d1: D1Database,
  passRequestId: string,
  adminUserId: string,
): Promise<{ ok: true; userId: string; playSessionId: string } | { ok: false }> {
  const db = getDb(d1);
  const pr = await db.query.passRequests.findFirst({
    where: eq(schema.passRequests.id, passRequestId),
  });
  if (!pr) return { ok: false };
  if (pr.claimedAt || pr.rejectedAt) return { ok: false };
  const vote = await db.query.votes.findFirst({ where: eq(schema.votes.id, pr.voteId) });
  if (!vote || vote.status !== "cho_pass") return { ok: false };
  const now = Date.now();
  // Revert vote to original status (B29 — pass-slotter is back on the bill).
  await db
    .update(schema.votes)
    .set({ status: pr.originalVoteStatus })
    .where(eq(schema.votes.id, vote.id));
  await db
    .update(schema.passRequests)
    .set({ rejectedAt: now, rejectedByUserId: adminUserId })
    .where(eq(schema.passRequests.id, passRequestId));
  await audit(d1, {
    kind: "pass_rejected",
    actorUserId: adminUserId,
    subjectUserId: vote.userId,
    playSessionId: vote.playSessionId,
    voteId: vote.id,
  });
  return { ok: true, userId: vote.userId, playSessionId: vote.playSessionId };
}

/* ---------------- Internals ---------------- */

/** Once a member has a real seat, their pending vãng lai request (if any) is
 *  redundant — cancel it so the admin's "cần duyệt" list stays accurate. */
async function cancelMyPendingVangLai(
  d1: D1Database,
  userId: string,
  playSessionId: string,
  now: number,
): Promise<void> {
  const db = getDb(d1);
  await db
    .update(schema.extraSlotRequests)
    .set({ cancelledAt: now })
    .where(
      and(
        eq(schema.extraSlotRequests.userId, userId),
        eq(schema.extraSlotRequests.playSessionId, playSessionId),
        isNull(schema.extraSlotRequests.approvedAt),
        isNull(schema.extraSlotRequests.cancelledAt),
      ),
    );
}
