/**
 * Cutoff sweep — on-demand cleanup that runs when relevant pages load.
 *
 * For every session whose cutoff (24h before earliest court start) has
 * passed AND hasn't been swept yet:
 *   - Open pass requests (no claim) → cancel; voter's vote restored to
 *     its `originalVoteStatus` (`pass_cancelled` audit).
 *   - Pending vãng lai requests → reject (`vang_lai_rejected`).
 *   - Claimed-not-confirmed pass requests → auto-confirm (per spec; the
 *     claimer's seat was already transferred at auto-match time, only
 *     `confirmedAt` needs stamping). Emits `pass_confirmed` audit.
 *
 * Idempotency: an audit `cutoff_locked` row per session marks the sweep
 * done. Subsequent calls skip already-swept sessions.
 *
 * Trigger points: loader on /trang-chu and /lich (both call this lazily so
 * members never see stale state in the UI).
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb, schema } from "~/db/client";
import { audit } from "./audit.server";
import { getSessionCutoffAt } from "./session-cutoff.server";

export async function sweepExpiredCutoffs(
  d1: D1Database,
  now: number = Date.now(),
): Promise<{ sessionsSwept: number }> {
  const db = getDb(d1);

  // Sessions that already have a `cutoff_locked` audit row → skip.
  const alreadySwept = await db.query.auditLogs.findMany({
    where: eq(schema.auditLogs.kind, "cutoff_locked"),
  });
  const sweptIds = new Set(
    alreadySwept.map((a) => a.playSessionId).filter((x): x is string => !!x),
  );

  // Look only at sessions in months that are "done" — that's the only state
  // pass/vãng lai is allowed in, so only those need sweeping.
  const doneMonths = await db.query.months.findMany({
    where: eq(schema.months.status, "done"),
  });
  if (doneMonths.length === 0) return { sessionsSwept: 0 };
  const doneMonthIds = new Set(doneMonths.map((m) => m.id));

  const allSessions = await db.query.playSessions.findMany();
  const candidates = allSessions.filter(
    (s) => doneMonthIds.has(s.monthId) && !sweptIds.has(s.id),
  );

  let count = 0;
  for (const s of candidates) {
    const cutoff = await getSessionCutoffAt(d1, s.id);
    if (cutoff == null || now < cutoff) continue;
    await sweepOneSession(d1, s.id);
    await audit(d1, { kind: "cutoff_locked", playSessionId: s.id });
    count += 1;
  }
  return { sessionsSwept: count };
}

async function sweepOneSession(d1: D1Database, playSessionId: string): Promise<void> {
  const db = getDb(d1);
  const now = Date.now();

  // 1) Open pass requests (no claim, no reject) → cancel + restore voter.
  const sessionVotes = await db.query.votes.findMany({
    where: eq(schema.votes.playSessionId, playSessionId),
  });
  const voteIds = sessionVotes.map((v) => v.id);
  if (voteIds.length) {
    const openPasses = await db.query.passRequests.findMany({
      where: and(
        isNull(schema.passRequests.claimedAt),
        isNull(schema.passRequests.rejectedAt),
      ),
    });
    const onSession = openPasses.filter((pr) => voteIds.includes(pr.voteId));
    for (const pr of onSession) {
      await db.delete(schema.passRequests).where(eq(schema.passRequests.id, pr.id));
      const v = sessionVotes.find((x) => x.id === pr.voteId);
      if (v && v.status === "cho_pass") {
        await db
          .update(schema.votes)
          .set({ status: pr.originalVoteStatus })
          .where(eq(schema.votes.id, v.id));
        await audit(d1, {
          kind: "pass_cancelled",
          subjectUserId: v.userId,
          playSessionId,
          voteId: v.id,
        });
      }
    }
  }

  // 2) Pending vãng lai → reject.
  const pendingExtras = await db.query.extraSlotRequests.findMany({
    where: and(
      eq(schema.extraSlotRequests.playSessionId, playSessionId),
      isNull(schema.extraSlotRequests.approvedAt),
      isNull(schema.extraSlotRequests.cancelledAt),
      isNull(schema.extraSlotRequests.rejectedAt),
    ),
  });
  for (const r of pendingExtras) {
    await db
      .update(schema.extraSlotRequests)
      .set({ rejectedAt: now })
      .where(eq(schema.extraSlotRequests.id, r.id));
    await audit(d1, {
      kind: "vang_lai_rejected",
      subjectUserId: r.userId,
      playSessionId,
    });
  }

  // 3) Claimed-not-confirmed pass → auto-confirm. Seat was already
  // transferred at auto-match time (status writes), so we only need to stamp
  // confirmedAt and emit an audit row.
  if (voteIds.length) {
    const claimedUnconfirmed = await db.query.passRequests.findMany({
      where: and(
        isNull(schema.passRequests.confirmedAt),
        isNotNull(schema.passRequests.claimedAt),
      ),
    });
    const onSession = claimedUnconfirmed.filter((pr) => voteIds.includes(pr.voteId));
    for (const pr of onSession) {
      await db
        .update(schema.passRequests)
        .set({ confirmedAt: now })
        .where(eq(schema.passRequests.id, pr.id));
      const v = sessionVotes.find((x) => x.id === pr.voteId);
      if (v && pr.claimedByUserId) {
        await audit(d1, {
          kind: "pass_confirmed",
          actorUserId: pr.claimedByUserId,
          subjectUserId: v.userId,
          playSessionId,
          voteId: v.id,
        });
      }
    }
  }
}
