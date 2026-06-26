/**
 * Seat attribution — single source of truth for "who currently owns this seat".
 * Pure data transformation; no I/O.
 *
 * The model is intentionally vote-centric. When B claims A's pass:
 *   - A's vote is set to `da_pass` (A no longer has a seat / bill)
 *   - A new vote for B is inserted with status `thang` (B owns the seat)
 *
 * This keeps pass chains (A → B → C) trivial: each owner has their own vote
 * row, so requestPass works the same way at every hop. The `pass_requests`
 * table is purely a workflow ledger (open / claimed / confirmed) — it does
 * NOT decide seat ownership.
 *
 * Three callers share this rule:
 *   - month-matrix.server.ts → matrix cells (filters to confirmed only)
 *   - vote.server.ts/computeMemberTotals → group bill totals
 *   - trang-chu.tsx → per-session player list on home cards
 *
 * Rules:
 *   - thang / vang_lai vote → seat on voter, status preserved
 *   - cho_pass vote        → seat on voter, status preserved (still on bill
 *                            until claimed / refunded)
 *   - da_pass / hoan_tien  → no seat (ownership has moved or been refunded)
 */

import type { Vote } from "~/db/schema";

export type SeatStatus = "thang" | "vang_lai" | "cho_pass";

export interface Seat {
  playSessionId: string;
  userId: string;
  status: SeatStatus;
  sourceVoteId: string;
}

type VoteInput = Pick<Vote, "id" | "userId" | "playSessionId" | "status">;

export function attributeSeats(votes: readonly VoteInput[]): Seat[] {
  const seats: Seat[] = [];
  for (const v of votes) {
    if (v.status === "thang" || v.status === "vang_lai" || v.status === "cho_pass") {
      seats.push({
        playSessionId: v.playSessionId,
        userId: v.userId,
        status: v.status,
        sourceVoteId: v.id,
      });
    }
  }
  return seats;
}

/** Returns a Map<playSessionId, Seat[]>. */
export function attributeSeatsBySession(
  votes: readonly VoteInput[],
): Map<string, Seat[]> {
  const bySession = new Map<string, Seat[]>();
  for (const s of attributeSeats(votes)) {
    const arr = bySession.get(s.playSessionId) ?? [];
    arr.push(s);
    bySession.set(s.playSessionId, arr);
  }
  return bySession;
}

/** True when the seat represents a confirmed attendee (counts in the matrix). */
export function isAttendingSeat(s: Seat): boolean {
  return s.status === "thang" || s.status === "vang_lai";
}
