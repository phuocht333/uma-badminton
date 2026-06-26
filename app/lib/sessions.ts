/**
 * "Visible sessions" rule — single source of truth.
 *
 * A play session that ended up without courts allocated is hidden from every
 * view (matrix, bill, home cards) once the month is `locked` or `done`. The
 * intent: those sessions didn't meet the minimum count, so nobody played and
 * nobody is charged.
 *
 * Voting / draft months keep all sessions so members see what's on the table.
 */
import type { Month, PlaySession, CourtAllocation } from "~/db/schema";

export function visibleSessions<S extends Pick<PlaySession, "id">>(
  sessions: readonly S[],
  allocs: readonly Pick<CourtAllocation, "playSessionId">[],
  monthStatus: Month["status"],
): S[] {
  if (monthStatus !== "locked" && monthStatus !== "done") return [...sessions];
  const withCourts = new Set(allocs.map((a) => a.playSessionId));
  return sessions.filter((s) => withCourts.has(s.id));
}
