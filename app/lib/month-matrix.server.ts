/**
 * Single source of truth for the month matrix shown on /lich. Seat
 * attribution (which user owns which cell) is delegated to `attributeSeats`
 * — the same rule used by computeMemberTotals and trang-chu.
 *
 * Locked / done months serve the matrix from the lock-time snapshot
 * (`months.lockedSnapshot`); see `month-snapshot.server.ts`.
 */

import { asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "~/db/client";
import { calculateTotalHours, sumCourtHours } from "./allocate-courts";
import {
  CONFIG_KEYS,
  DEFAULT_PEOPLE_PER_HOUR,
  getNumber,
  getPrices,
} from "./config.server";
import { attributeSeats, isAttendingSeat } from "./seat-attribution";
import { visibleSessions } from "./sessions";
import { parseMonthSnapshot } from "./month-snapshot.server";
import type { MatrixRow, MatrixSession } from "~/components/month-matrix";

export interface MonthMatrixData {
  sessions: MatrixSession[];
  rows: MatrixRow[];
  grandTotal: number;
}

export async function buildMonthMatrixData(
  d1: D1Database,
  monthId: string,
  monthStatus: schema.Month["status"],
  opts: { skipSnapshot?: boolean } = {},
): Promise<MonthMatrixData> {
  const db = getDb(d1);

  // "Đã đặt sân" (DB `done`) reads the matrix from the snapshot taken at
  // freeze time — once frozen, post-freeze court tweaks only affect live
  // home cards on trang-chu, not /lich. "Đã khoá" still computes live so
  // admin's in-progress finalisation shows immediately.
  if (!opts.skipSnapshot && monthStatus === "done") {
    const month = await db.query.months.findFirst({
      where: eq(schema.months.id, monthId),
    });
    const snap = parseMonthSnapshot(month?.lockedSnapshot ?? null);
    if (snap) return snap.matrix;
  }

  const allSessions = await db.query.playSessions.findMany({
    where: eq(schema.playSessions.monthId, monthId),
    orderBy: [asc(schema.playSessions.date)],
  });

  const courtCounts = allSessions.length
    ? await db.query.courtAllocations.findMany({
        where: inArray(
          schema.courtAllocations.playSessionId,
          allSessions.map((s) => s.id),
        ),
      })
    : [];
  const sessions = visibleSessions(allSessions, courtCounts, monthStatus);
  const sessionIds = sessions.map((s) => s.id);

  const [allVotes, allocs, users, prices, peoplePerHour] = await Promise.all([
    sessionIds.length
      ? db.query.votes.findMany({
          where: inArray(schema.votes.playSessionId, sessionIds),
        })
      : Promise.resolve([] as schema.Vote[]),
    sessionIds.length
      ? db.query.courtAllocations.findMany({
          where: inArray(schema.courtAllocations.playSessionId, sessionIds),
          orderBy: [asc(schema.courtAllocations.displayOrder)],
        })
      : Promise.resolve([] as schema.CourtAllocation[]),
    db.query.users.findMany({
      where: eq(schema.users.isActive, true),
      orderBy: [asc(schema.users.createdAt)],
    }),
    getPrices(d1),
    getNumber(d1, CONFIG_KEYS.PEOPLE_PER_HOUR, DEFAULT_PEOPLE_PER_HOUR),
  ]);

  // Matrix shows confirmed attendees only — unclaimed cho_pass cells are empty
  // until claimed or refunded.
  const seats = attributeSeats(allVotes).filter(isAttendingSeat);

  // (userId|sessionId) → final status. Last write wins, dedupping the rare case
  // of a user with both a direct vote and a claim on the same session.
  const cells = new Map<string, { status: "thang" | "vang_lai" }>();
  for (const seat of seats) {
    cells.set(`${seat.userId}|${seat.playSessionId}`, {
      status: seat.status as "thang" | "vang_lai",
    });
  }
  const sessionVoteCount = new Map<string, number>();
  for (const key of cells.keys()) {
    const sid = key.split("|")[1];
    sessionVoteCount.set(sid, (sessionVoteCount.get(sid) ?? 0) + 1);
  }

  const allocsBySession = new Map<string, schema.CourtAllocation[]>();
  for (const a of allocs) {
    const arr = allocsBySession.get(a.playSessionId) ?? [];
    arr.push(a);
    allocsBySession.set(a.playSessionId, arr);
  }

  const matrixSessions: MatrixSession[] = sessions.map((s) => {
    const sessionCourts = allocsBySession.get(s.id) ?? [];
    const voteCount = sessionVoteCount.get(s.id) ?? 0;
    // Use actual booked court hours once any court exists (admin may have
    // tweaked allocations away from the vote-based estimate); fall back to
    // the people→hours estimate while no court is booked yet.
    const totalHours =
      sessionCourts.length > 0
        ? sumCourtHours(sessionCourts)
        : calculateTotalHours(voteCount, peoplePerHour);
    return {
      id: s.id,
      date: s.date,
      weekday: s.weekday,
      voteCount,
      totalHours,
      courts: sessionCourts.map((c) => ({
        id: c.id,
        courtCode: c.courtCode,
        startTime: c.startTime,
        endTime: c.endTime,
      })),
    };
  });

  const matrixRows: MatrixRow[] = users
    .map((u) => {
      const cellsForUser = sessions.map((s) => {
        const c = cells.get(`${u.id}|${s.id}`);
        return { status: c?.status ?? null };
      });
      const totalSlots = cellsForUser.filter((c) => c.status).length;
      const totalFee = cellsForUser.reduce((sum, c) => {
        if (!c.status) return sum;
        const tier = c.status === "vang_lai" ? "vang_lai" : "thang";
        return sum + prices[tier][u.gender];
      }, 0);
      return {
        user: { id: u.id, name: u.name, gender: u.gender },
        cells: cellsForUser,
        totalSlots,
        totalFee,
      };
    })
    // Hide members who didn't vote any session this month — keeps the matrix
    // focused on actual participants instead of a roster dump.
    .filter((r) => r.cells.some((c) => c.status !== null));

  const grandTotal = matrixRows.reduce((sum, r) => sum + r.totalFee, 0);
  return { sessions: matrixSessions, rows: matrixRows, grandTotal };
}
