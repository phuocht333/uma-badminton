/**
 * Event-driven auto-match between pending pass-slots and pending vãng lai
 * requests on the same play session.
 *
 * Triggers (every action that may create a matchable pair):
 *   - requestPass (opens a new pass-slot)
 *   - registerVangLai (member joins the vãng lai queue)
 *   - cancelPass (frees a previously locked slot if claim was undone)
 *
 * Algorithm: pure FIFO, no gender filter. Find oldest unclaimed pass-slot +
 * oldest pending vãng lai → match them in one transaction. Match is locked
 * forever (no cancel, no timeout — see decisions B25, B27).
 *
 * Payment routing for cross-gender pairings (B26):
 *   - vãng lai pays vang_lai[payerGender] to the pass-slotter
 *   - pass-slotter receives vang_lai[payeeGender]
 *   - difference (positive or negative) flows through the quỹ; app only
 *     surfaces the breakdown in emails — no balance tracking.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "~/db/client";
import { audit } from "./audit.server";
import { getPrices, type PriceTable } from "./config.server";
import { transferSeatToClaimer } from "./seat-transfer.server";
import { isAfterCutoff } from "./session-cutoff.server";

export interface AutoMatchPayment {
  /** Amount vãng lai transfers to the pass-slotter. */
  toPassSlotter: number;
  /** Amount vãng lai additionally transfers to quỹ. Zero when no excess. */
  toQuyExtra: number;
  /** Amount quỹ owes pass-slotter to cover the shortage. Zero when none. */
  fromQuyShortage: number;
  /** vang_lai price of vãng lai's gender (what they pay total). */
  payerTotal: number;
  /** vang_lai price of pass-slotter's gender (what they should receive total). */
  payeeTotal: number;
}

export function computeAutoMatchPayment(
  payerGender: "nam" | "nu",
  payeeGender: "nam" | "nu",
  prices: PriceTable,
): AutoMatchPayment {
  const payerTotal = prices.vang_lai[payerGender];
  const payeeTotal = prices.vang_lai[payeeGender];
  const diff = payerTotal - payeeTotal;
  if (diff >= 0) {
    return {
      toPassSlotter: payeeTotal,
      toQuyExtra: diff,
      fromQuyShortage: 0,
      payerTotal,
      payeeTotal,
    };
  }
  return {
    toPassSlotter: payerTotal,
    toQuyExtra: 0,
    fromQuyShortage: -diff,
    payerTotal,
    payeeTotal,
  };
}

export interface AutoMatchResult {
  matched: true;
  passRequestId: string;
  passSlotterUserId: string;
  vangLaiUserId: string;
  playSessionId: string;
  newVoteId: string;
  payment: AutoMatchPayment;
}

/**
 * Try to match one pass-slot ↔ one vãng lai on the given session. Returns the
 * matched pair (or null if either pool is empty / cutoff passed). Caller is
 * responsible for sending emails after this returns — keeps the DB write
 * fast.
 */
export async function tryAutoMatch(
  d1: D1Database,
  playSessionId: string,
  now: number = Date.now(),
): Promise<AutoMatchResult | null> {
  if (await isAfterCutoff(d1, playSessionId, now)) return null;
  const db = getDb(d1);

  // Oldest pending vãng lai on this session — we anchor on this so the
  // pass-slot lookup can skip same-user candidates.
  const pendingVangLai = await db.query.extraSlotRequests.findFirst({
    where: and(
      eq(schema.extraSlotRequests.playSessionId, playSessionId),
      isNull(schema.extraSlotRequests.approvedAt),
      isNull(schema.extraSlotRequests.cancelledAt),
      isNull(schema.extraSlotRequests.rejectedAt),
    ),
    orderBy: [asc(schema.extraSlotRequests.createdAt)],
  });
  if (!pendingVangLai) return null;

  // All pass requests FIFO; we filter open + correct-session below.
  const candidatePassRequests = await db.query.passRequests.findMany({
    orderBy: [asc(schema.passRequests.createdAt)],
  });
  if (candidatePassRequests.length === 0) return null;
  const sessionVotes = await db.query.votes.findMany({
    where: and(eq(schema.votes.playSessionId, playSessionId), eq(schema.votes.status, "cho_pass")),
  });
  const voteOwnerById = new Map(sessionVotes.map((v) => [v.id, v.userId] as const));

  // Pick the oldest open pass-slot that ISN'T owned by the same user as the
  // pending vãng lai. Multi-slot registrations can register against their
  // own session, so we must walk past their own pass(es) to find a real
  // counterpart — returning null on the first same-user hit would stall the
  // queue for everyone behind them.
  const openPassReq = candidatePassRequests.find(
    (pr) =>
      pr.claimedAt == null &&
      pr.rejectedAt == null &&
      voteOwnerById.has(pr.voteId) &&
      voteOwnerById.get(pr.voteId) !== pendingVangLai.userId,
  );
  if (!openPassReq) return null;

  const originalVote = sessionVotes.find((v) => v.id === openPassReq.voteId);
  if (!originalVote) return null;

  // Atomic claim: only the first writer wins if two events race. Note that
  // we set `claimedAt` only — `confirmedAt` stays null so the claimer's
  // homepage payment banner appears until they click "Đã thanh toán". The
  // cutoff sweep auto-confirms any still-pending entries at the 24h mark.
  const claimed = await db
    .update(schema.passRequests)
    .set({
      claimedByUserId: pendingVangLai.userId,
      claimedAt: now,
    })
    .where(and(eq(schema.passRequests.id, openPassReq.id), isNull(schema.passRequests.claimedAt)))
    .returning({ id: schema.passRequests.id });
  if (claimed.length === 0) return null;

  // Move ownership via the shared helper — same rule used by pass-slot's
  // claimAndConfirm / confirmPass.
  const { newVoteId } = await transferSeatToClaimer(
    d1,
    pendingVangLai.userId,
    originalVote,
    now,
  );

  // Mark extra_slot_request approved by system (NULL approvedByUserId signals
  // auto-match, not human admin — per P1).
  await db
    .update(schema.extraSlotRequests)
    .set({ approvedAt: now, approvedByUserId: null })
    .where(eq(schema.extraSlotRequests.id, pendingVangLai.id));

  // Compute payment breakdown for audit + emails.
  const [prices, payer, payee] = await Promise.all([
    getPrices(d1),
    db.query.users.findFirst({ where: eq(schema.users.id, pendingVangLai.userId) }),
    db.query.users.findFirst({ where: eq(schema.users.id, originalVote.userId) }),
  ]);
  const payment = computeAutoMatchPayment(
    payer?.gender ?? "nam",
    payee?.gender ?? "nam",
    prices,
  );

  await audit(d1, {
    kind: "auto_matched",
    actorUserId: pendingVangLai.userId,
    subjectUserId: originalVote.userId,
    playSessionId,
    voteId: newVoteId,
    meta: {
      passRequestId: openPassReq.id,
      passSlotterName: payee?.name ?? null,
      payerName: payer?.name ?? null,
      payerGender: payer?.gender ?? null,
      payeeGender: payee?.gender ?? null,
      toPassSlotter: payment.toPassSlotter,
      toQuyExtra: payment.toQuyExtra,
      fromQuyShortage: payment.fromQuyShortage,
      payerTotal: payment.payerTotal,
      payeeTotal: payment.payeeTotal,
    },
  });

  return {
    matched: true,
    passRequestId: openPassReq.id,
    passSlotterUserId: originalVote.userId,
    vangLaiUserId: pendingVangLai.userId,
    playSessionId,
    newVoteId,
    payment,
  };
}
