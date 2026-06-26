/**
 * Cross-table data-integrity invariants for pass-slot / vãng lai state.
 *
 * Returns a list of violation strings — empty array means clean state.
 * Tests should call `assertInvariants(db)` after any mutation (or at least at
 * the end of every integration test) to catch orphan rows + state drift.
 *
 * Invariants enforced:
 *   I1. Per-session vote uniqueness (DB unique index — checked here too as
 *       documentation + double-defence).
 *   I2. No orphan open pass_request: every row that is still OPEN — meaning
 *       `claimedAt`, `rejectedAt`, AND `confirmedAt` are all NULL — must
 *       reference a vote currently in `cho_pass`. The "Huỷ pass" bug we just
 *       fixed produced this exact violation. (Note: admin refund sets
 *       `confirmedAt` only — the row is no longer open even without a claim.)
 *   I3. No "claimed but vote still cho_pass": once a pass is claimed, the
 *       original vote must be `da_pass` (or the claimer's new vote replaced
 *       it; the original row should be flipped).
 *   I4. Approved vãng lai ⇒ user has a vote with status `vang_lai` (or
 *       `thang`/`da_pass` if a later pass-slot was claimed — but never null).
 *       Auto-match path leaves the vãng lai row approved AND the user with a
 *       `thang` vote (newly transferred seat).
 */
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "~/db/schema";

export async function assertInvariants(
  db: DrizzleD1Database<typeof schema>,
): Promise<string[]> {
  const violations: string[] = [];

  const [votes, passRequests, extraRequests] = await Promise.all([
    db.query.votes.findMany(),
    db.query.passRequests.findMany(),
    db.query.extraSlotRequests.findMany(),
  ]);

  // I1: per-session vote uniqueness.
  const seen = new Map<string, string>();
  for (const v of votes) {
    const key = `${v.playSessionId}::${v.userId}`;
    const prior = seen.get(key);
    if (prior) {
      violations.push(
        `I1 vote uniqueness: user ${v.userId} has >1 vote on session ${v.playSessionId} (ids ${prior}, ${v.id})`,
      );
    } else {
      seen.set(key, v.id);
    }
  }

  // Build voteById lookup for I2/I3.
  const voteById = new Map(votes.map((v) => [v.id, v] as const));

  // I2: no orphan open pass_request. "Open" = none of claimedAt / rejectedAt /
  // confirmedAt are set (admin refund stamps confirmedAt only, no claim).
  for (const pr of passRequests) {
    const isOpen = pr.claimedAt == null && pr.rejectedAt == null && pr.confirmedAt == null;
    if (!isOpen) continue;
    const vote = voteById.get(pr.voteId);
    if (!vote) {
      violations.push(`I2 orphan pass_request: ${pr.id} → vote ${pr.voteId} not found`);
      continue;
    }
    if (vote.status !== "cho_pass") {
      violations.push(
        `I2 orphan pass_request: ${pr.id} open but vote ${vote.id} status is "${vote.status}" (expected "cho_pass")`,
      );
    }
  }

  // I3: claimed pass_request ⇒ original vote is da_pass.
  for (const pr of passRequests) {
    if (pr.claimedAt == null) continue;
    if (pr.rejectedAt != null) continue;
    const vote = voteById.get(pr.voteId);
    if (!vote) {
      violations.push(`I3 claimed pass_request: ${pr.id} → vote ${pr.voteId} not found`);
      continue;
    }
    if (vote.status === "cho_pass") {
      violations.push(
        `I3 claim drift: pass_request ${pr.id} claimed but vote ${vote.id} still "cho_pass" (expected "da_pass")`,
      );
    }
  }

  // I4: approved vãng lai ⇒ user has a vote on the session (any status — the
  // transfer / approval path always writes one).
  const voteByUserSession = new Map<string, schema.Vote>();
  for (const v of votes) {
    voteByUserSession.set(`${v.userId}::${v.playSessionId}`, v);
  }
  for (const r of extraRequests) {
    if (r.approvedAt == null) continue;
    const v = voteByUserSession.get(`${r.userId}::${r.playSessionId}`);
    if (!v) {
      violations.push(
        `I4 approved vãng lai missing vote: extra ${r.id} for user ${r.userId} on session ${r.playSessionId} has no vote row`,
      );
    }
  }

  return violations;
}

/**
 * Convenience wrapper for tests: `await expect(assertCleanState(db)).resolves.toEqual([])`.
 * Equivalent to `assertInvariants` — just named for readable assertions.
 */
export const assertCleanState = assertInvariants;
