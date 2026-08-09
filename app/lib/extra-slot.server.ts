/**
 * Server logic for two flows the user requested after the original launch:
 *
 *  1. "Refund on court cancel" — when admin removes a court_allocation, any
 *     `cho_pass` votes on that session flip to `hoan_tien` (no charge to A).
 *     Older requests refunded first (FIFO).
 *
 *  2. "Vãng lai request" — when there's no slot available to claim, a member
 *     can request to be added as vãng lai for a specific session. The request
 *     waits until either a pass-slot auto-matches to it, or an admin duyệt-s
 *     it (per-person via `approveSingleRequest`, or the whole session via
 *     `approvePendingForSession` behind the "Duyệt tất cả" button). Adding a
 *     court does NOT auto-approve anything on its own — B28 split "đặt sân"
 *     from "duyệt người".
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb, schema } from "~/db/client";
import { audit } from "./audit.server";
import { tryAutoMatch, type AutoMatchResult } from "./auto-match.server";

/**
 * Convert oldest-first `cho_pass` votes for a session into `hoan_tien` (refund).
 * Used when a court is removed — capacity drops, so people who were already
 * looking to pass are released without charge.
 */
export async function refundPendingPassRequests(
  d1: D1Database,
  playSessionId: string,
  actorUserId: string,
): Promise<number> {
  const db = getDb(d1);

  // Older pass_requests first.
  const openRequests = await db.query.passRequests.findMany({
    where: isNull(schema.passRequests.claimedAt),
    orderBy: [asc(schema.passRequests.createdAt)],
  });
  if (openRequests.length === 0) return 0;

  const candidateVotes = await db.query.votes.findMany({
    where: and(
      inArray(
        schema.votes.id,
        openRequests.map((r) => r.voteId),
      ),
      eq(schema.votes.playSessionId, playSessionId),
      eq(schema.votes.status, "cho_pass"),
    ),
  });
  if (candidateVotes.length === 0) return 0;

  const now = Date.now();
  const voteIdSet = new Set(candidateVotes.map((v) => v.id));
  for (const v of candidateVotes) {
    await db.update(schema.votes).set({ status: "hoan_tien" }).where(eq(schema.votes.id, v.id));
    await audit(d1, {
      kind: "refund_issued",
      actorUserId,
      subjectUserId: v.userId,
      playSessionId,
      voteId: v.id,
      meta: { reason: "court_removed" },
    });
  }
  // Mark each affected pass_request terminal so it doesn't appear as "open"
  // anywhere (home view, invariant checks). Same pattern as approvePassRefund.
  for (const pr of openRequests) {
    if (!voteIdSet.has(pr.voteId)) continue;
    await db
      .update(schema.passRequests)
      .set({ confirmedAt: now })
      .where(eq(schema.passRequests.id, pr.id));
  }
  return candidateVotes.length;
}

/**
 * Vãng lai registration — only after a month is "Đã đặt sân" (DB `done`).
 *
 * One path, always: upsert a single `extra_slot_requests` row (unique on
 * user_id + play_session_id, reusing a previously cancelled / rejected row)
 * then run one `tryAutoMatch` pass. If a pass-slot is open on the session the
 * seat moves to this member atomically; otherwise they wait in line until
 * someone passes or an admin duyệt-s them. There is **no** capacity-based
 * auto-admit — admin owns the queue (B28).
 *
 * No registration deadline (B34): registering stays open right up to the
 * session, and whatever is still queued is the admin's call (duyệt / từ chối on
 * the session page). Caller surfaces the auto-match result via toast.
 */
export async function registerVangLai(
  d1: D1Database,
  userId: string,
  playSessionId: string,
): Promise<{ ok: true; autoMatch?: AutoMatchResult } | { error: string }> {
  const db = getDb(d1);

  const session = await db.query.playSessions.findFirst({
    where: eq(schema.playSessions.id, playSessionId),
  });
  if (!session) return { error: "Buổi không hợp lệ." };
  const month = await db.query.months.findFirst({
    where: eq(schema.months.id, session.monthId),
  });
  if (month?.status !== "done") {
    return { error: "Đăng ký vãng lai chỉ thực hiện được sau khi lịch 'Đã đặt sân'." };
  }
  // Already an attending seat → no need to request.
  const existingVote = await db.query.votes.findFirst({
    where: and(eq(schema.votes.userId, userId), eq(schema.votes.playSessionId, playSessionId)),
  });
  if (existingVote?.status === "thang" || existingVote?.status === "vang_lai") {
    return { error: "Bạn đã có slot cho buổi này." };
  }
  // Đang chờ pass slot của chính mình → không được vừa pass vừa vãng lai
  // (auto-match đã chặn cặp self-match, nhưng để hàng đợi sạch + UX rõ ràng
  // thì chặn ngay tại đây).
  if (existingVote?.status === "cho_pass") {
    return { error: "Bạn đang chờ pass slot — không thể đăng ký vãng lai cùng buổi." };
  }

  const now = Date.now();
  const existingRow = await db.query.extraSlotRequests.findFirst({
    where: and(
      eq(schema.extraSlotRequests.userId, userId),
      eq(schema.extraSlotRequests.playSessionId, playSessionId),
    ),
  });
  if (existingRow?.approvedAt) return { error: "Yêu cầu đã được duyệt." };
  if (existingRow && !existingRow.cancelledAt && !existingRow.rejectedAt) {
    return { error: "Bạn đã gửi yêu cầu vãng lai cho buổi này." };
  }
  if (existingRow) {
    await db
      .update(schema.extraSlotRequests)
      .set({ createdAt: now, cancelledAt: null, rejectedAt: null, rejectedByUserId: null })
      .where(eq(schema.extraSlotRequests.id, existingRow.id));
  } else {
    await db.insert(schema.extraSlotRequests).values({
      id: ulid(),
      userId,
      playSessionId,
      createdAt: now,
    });
  }
  await audit(d1, { kind: "vang_lai_requested", actorUserId: userId, playSessionId });

  const match = await tryAutoMatch(d1, playSessionId);
  return { ok: true, autoMatch: match ?? undefined };
}

export async function cancelExtraSlotRequest(
  d1: D1Database,
  userId: string,
  requestId: string,
): Promise<boolean> {
  const db = getDb(d1);
  const row = await db.query.extraSlotRequests.findFirst({
    where: eq(schema.extraSlotRequests.id, requestId),
  });
  if (!row || row.userId !== userId) return false;
  if (row.approvedAt || row.cancelledAt || row.rejectedAt) return false;
  await db
    .update(schema.extraSlotRequests)
    .set({ cancelledAt: Date.now() })
    .where(eq(schema.extraSlotRequests.id, requestId));
  await audit(d1, {
    kind: "vang_lai_cancelled",
    actorUserId: userId,
    playSessionId: row.playSessionId,
  });
  return true;
}

/**
 * Approve all pending vãng lai requests for the given session — called after
 * admin successfully adds an extra court for that session.
 */
export async function approvePendingForSession(
  d1: D1Database,
  playSessionId: string,
  adminUserId: string,
): Promise<number> {
  const db = getDb(d1);
  const pending = await db.query.extraSlotRequests.findMany({
    where: and(
      eq(schema.extraSlotRequests.playSessionId, playSessionId),
      isNull(schema.extraSlotRequests.approvedAt),
      isNull(schema.extraSlotRequests.cancelledAt),
    ),
    orderBy: [asc(schema.extraSlotRequests.createdAt)],
  });
  let count = 0;
  for (const req of pending) {
    if (await approveOne(db, d1, req, adminUserId)) count++;
  }
  return count;
}

/**
 * Approve a single request explicitly by id. Lets admin override even when
 * not paired with a new court (e.g., decided to allow over-cap).
 */
export async function approveSingleRequest(
  d1: D1Database,
  requestId: string,
  adminUserId: string,
): Promise<boolean> {
  const db = getDb(d1);
  const req = await db.query.extraSlotRequests.findFirst({
    where: eq(schema.extraSlotRequests.id, requestId),
  });
  if (!req || req.approvedAt || req.cancelledAt) return false;
  return approveOne(db, d1, req, adminUserId);
}

/**
 * Admin rejects a single pending vãng lai request — no court was added, so the
 * member doesn't get a seat. Sets rejectedAt to distinguish from member-
 * initiated cancellation.
 */
export async function rejectSingleExtraSlotRequest(
  d1: D1Database,
  requestId: string,
  adminUserId: string,
): Promise<{ ok: true; userId: string; playSessionId: string } | { ok: false }> {
  const db = getDb(d1);
  const req = await db.query.extraSlotRequests.findFirst({
    where: eq(schema.extraSlotRequests.id, requestId),
  });
  if (!req) return { ok: false };
  if (req.approvedAt || req.cancelledAt || req.rejectedAt) return { ok: false };
  const now = Date.now();
  await db
    .update(schema.extraSlotRequests)
    .set({ rejectedAt: now, rejectedByUserId: adminUserId })
    .where(eq(schema.extraSlotRequests.id, requestId));
  await audit(d1, {
    kind: "vang_lai_rejected",
    actorUserId: adminUserId,
    subjectUserId: req.userId,
    playSessionId: req.playSessionId,
  });
  return { ok: true, userId: req.userId, playSessionId: req.playSessionId };
}

async function approveOne(
  db: ReturnType<typeof getDb>,
  d1: D1Database,
  req: schema.ExtraSlotRequest,
  adminUserId: string,
): Promise<boolean> {
  const now = Date.now();
  await db
    .update(schema.extraSlotRequests)
    .set({ approvedAt: now, approvedByUserId: adminUserId })
    .where(eq(schema.extraSlotRequests.id, req.id));

  const existingVote = await db.query.votes.findFirst({
    where: and(
      eq(schema.votes.userId, req.userId),
      eq(schema.votes.playSessionId, req.playSessionId),
    ),
  });
  let voteId: string;
  if (existingVote) {
    voteId = existingVote.id;
    // Nếu vote đang ở "cho_pass" (user đã đăng ký pass slot) thì việc admin
    // duyệt vãng lai cùng buổi ngầm huỷ ý định pass: user đã có ghế lại.
    // Xoá luôn pass_request đang mở để không bị mồ côi (vote=vang_lai nhưng
    // pass_request vẫn open → Huỷ pass slot không chạy được).
    if (existingVote.status === "cho_pass") {
      await db
        .delete(schema.passRequests)
        .where(
          and(
            eq(schema.passRequests.voteId, voteId),
            isNull(schema.passRequests.claimedAt),
          ),
        );
    }
    await db
      .update(schema.votes)
      .set({ status: "vang_lai", votedAt: now })
      .where(eq(schema.votes.id, voteId));
  } else {
    voteId = ulid();
    await db.insert(schema.votes).values({
      id: voteId,
      playSessionId: req.playSessionId,
      userId: req.userId,
      status: "vang_lai",
      votedAt: now,
    });
  }
  await audit(d1, {
    kind: "vang_lai_approved",
    actorUserId: adminUserId,
    subjectUserId: req.userId,
    playSessionId: req.playSessionId,
    voteId,
  });
  return true;
}

