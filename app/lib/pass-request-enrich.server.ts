/**
 * `pass_requests` is a thin ledger row (voteId + claim/confirm timestamps).
 * Every read site needs to walk vote → user → session to make sense of it.
 * This helper does the joins once so each caller only writes a `where` clause.
 *
 * Rows where any join target is missing are silently skipped — they represent
 * corrupted data (e.g. vote deleted while a pass_request still references it).
 */
import { inArray } from "drizzle-orm";
import { getDb, schema } from "~/db/client";
import type { PassRequest, PlaySession, User, Vote } from "~/db/schema";

export interface EnrichedPassRequest {
  request: PassRequest;
  vote: Vote;
  owner: User;
  session: PlaySession;
}

export async function enrichPassRequests(
  d1: D1Database,
  rows: readonly PassRequest[],
): Promise<EnrichedPassRequest[]> {
  if (rows.length === 0) return [];
  const db = getDb(d1);

  const voteIds = Array.from(new Set(rows.map((r) => r.voteId)));
  const votes = await db.query.votes.findMany({
    where: inArray(schema.votes.id, voteIds),
  });
  const voteById = new Map(votes.map((v) => [v.id, v] as const));

  const userIds = Array.from(new Set(votes.map((v) => v.userId)));
  const sessionIds = Array.from(new Set(votes.map((v) => v.playSessionId)));
  const [users, sessions] = await Promise.all([
    userIds.length
      ? db.query.users.findMany({ where: inArray(schema.users.id, userIds) })
      : Promise.resolve([] as User[]),
    sessionIds.length
      ? db.query.playSessions.findMany({
          where: inArray(schema.playSessions.id, sessionIds),
        })
      : Promise.resolve([] as PlaySession[]),
  ]);
  const userById = new Map(users.map((u) => [u.id, u] as const));
  const sessionById = new Map(sessions.map((s) => [s.id, s] as const));

  const out: EnrichedPassRequest[] = [];
  for (const r of rows) {
    const vote = voteById.get(r.voteId);
    if (!vote) continue;
    const owner = userById.get(vote.userId);
    if (!owner) continue;
    const session = sessionById.get(vote.playSessionId);
    if (!session) continue;
    out.push({ request: r, vote, owner, session });
  }
  return out;
}
