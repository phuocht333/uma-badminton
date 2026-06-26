/**
 * Single home for "move a seat from the original voter to the claimer" —
 * the operation behind every pass-slot confirmation (manual claim, auto-
 * match, or admin force-confirm). Idempotent so callers can run it twice
 * (e.g. auto-match writes the seat, then the homepage banner confirm runs
 * it again) without inconsistency.
 *
 * Rule:
 *   - Original vote → `da_pass`
 *   - Claimer's vote → upsert as `thang` with `originalVoterId` chained
 *     through the original voter (or further back if already chained).
 *
 * The returned vote id is the claimer's resulting vote — auto-match uses
 * it to reference the new seat in audit metadata.
 */
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb, schema } from "~/db/client";

export async function transferSeatToClaimer(
  d1: D1Database,
  claimerId: string,
  originalVote: schema.Vote,
  now: number,
): Promise<{ newVoteId: string }> {
  const db = getDb(d1);

  await db
    .update(schema.votes)
    .set({ status: "da_pass" })
    .where(eq(schema.votes.id, originalVote.id));

  const existing = await db.query.votes.findFirst({
    where: and(
      eq(schema.votes.userId, claimerId),
      eq(schema.votes.playSessionId, originalVote.playSessionId),
    ),
  });
  // Preserve the head of the chain if originalVote is itself a chained claim.
  const originalVoterId = originalVote.originalVoterId ?? originalVote.userId;

  if (existing) {
    await db
      .update(schema.votes)
      .set({ status: "thang", votedAt: now, originalVoterId })
      .where(eq(schema.votes.id, existing.id));
    return { newVoteId: existing.id };
  }

  const newVoteId = ulid();
  await db.insert(schema.votes).values({
    id: newVoteId,
    playSessionId: originalVote.playSessionId,
    userId: claimerId,
    status: "thang",
    votedAt: now,
    originalVoterId,
  });
  return { newVoteId };
}
