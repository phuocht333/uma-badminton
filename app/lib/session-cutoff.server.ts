/**
 * Session cutoff = `min(courtAllocations.startTime on session) − 24h`.
 *
 * Before cutoff: members can register vãng lai or open pass-slot freely; auto-
 * match runs whenever both pools have a pending entry.
 *
 * At/after cutoff: new vãng lai or pass-slot registrations are rejected;
 * unmatched pending entries become the admin queue for per-person duyệt/reject.
 *
 * Computed lazily on each request — no cron precision needed.
 */
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "~/db/client";
import type { WeekdayCode } from "./dates";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the cutoff unix-ms timestamp for the given session, or null if the
 * session has no court allocations yet (no cutoff while there's nothing to
 * play on).
 *
 * Session date is `YYYY-MM-DD` (Vietnam local). Court startTime is `HH:mm`
 * (same locale). We assemble the earliest absolute start instant as if the
 * session date is in Asia/Ho_Chi_Minh (UTC+7) and subtract 24h.
 */
export async function getSessionCutoffAt(
  d1: D1Database,
  playSessionId: string,
): Promise<number | null> {
  const db = getDb(d1);
  const session = await db.query.playSessions.findFirst({
    where: eq(schema.playSessions.id, playSessionId),
  });
  if (!session) return null;
  const allocs = await db.query.courtAllocations.findMany({
    where: eq(schema.courtAllocations.playSessionId, playSessionId),
  });
  if (allocs.length === 0) return null;
  const earliest = allocs.reduce((min, a) => (a.startTime < min ? a.startTime : min), allocs[0].startTime);
  const earliestStartAt = parseVietnamLocal(session.date, earliest);
  return earliestStartAt - ONE_DAY_MS;
}

export async function isAfterCutoff(
  d1: D1Database,
  playSessionId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const cutoff = await getSessionCutoffAt(d1, playSessionId);
  if (cutoff == null) return false;
  return now >= cutoff;
}

/**
 * Find all sessions whose cutoff is in `[fromMs, toMs)` AND have pending
 * unmatched entries (extra_slot or pass-slot). Used by cron to produce admin
 * digest emails — caller dedupes against the cutoff_locked audit log so each
 * session only triggers a digest once.
 */
export async function findSessionsCrossingCutoff(
  d1: D1Database,
  fromMs: number,
  toMs: number,
): Promise<
  Array<{
    sessionId: string;
    date: string;
    weekday: WeekdayCode;
    cutoffAt: number;
    pendingVangLai: number;
    pendingPassSlot: number;
  }>
> {
  const db = getDb(d1);
  const sessions = await db.query.playSessions.findMany();
  const out: Array<{
    sessionId: string;
    date: string;
    weekday: WeekdayCode;
    cutoffAt: number;
    pendingVangLai: number;
    pendingPassSlot: number;
  }> = [];
  for (const s of sessions) {
    const cutoff = await getSessionCutoffAt(d1, s.id);
    if (cutoff == null) continue;
    if (cutoff < fromMs || cutoff >= toMs) continue;
    const [vangLai, passSlot] = await Promise.all([
      db.query.extraSlotRequests.findMany({
        where: and(
          eq(schema.extraSlotRequests.playSessionId, s.id),
        ),
      }),
      db.query.passRequests.findMany(),
    ]);
    const pendingVangLai = vangLai.filter(
      (r) => r.approvedAt == null && r.cancelledAt == null && r.rejectedAt == null,
    ).length;
    // Pass-slots are session-scoped via vote — need a join. For now compute
    // via votes for accuracy.
    const sessionVotes = await db.query.votes.findMany({
      where: and(eq(schema.votes.playSessionId, s.id), eq(schema.votes.status, "cho_pass")),
    });
    const passOnSession = passSlot.filter((pr) =>
      sessionVotes.some((v) => v.id === pr.voteId),
    );
    const pendingPassSlot = passOnSession.filter(
      (pr) => pr.claimedAt == null && pr.rejectedAt == null,
    ).length;
    if (pendingVangLai === 0 && pendingPassSlot === 0) continue;
    out.push({
      sessionId: s.id,
      date: s.date,
      weekday: s.weekday,
      cutoffAt: cutoff,
      pendingVangLai,
      pendingPassSlot,
    });
  }
  return out;
}

/**
 * Parse "YYYY-MM-DD" + "HH:mm" as Vietnam-local wall time, return UTC unix ms.
 *
 * Vietnam is UTC+7 with no DST. JS Date treats bare "YYYY-MM-DDTHH:mm:ss" as
 * local-to-server time, which on Cloudflare Workers is UTC — so we offset by 7h
 * to land at the actual VN-local instant.
 */
function parseVietnamLocal(date: string, hhmm: string): number {
  const utc = Date.parse(`${date}T${hhmm}:00Z`);
  // Subtract 7h: a wall-clock "08:00" in VN is 01:00 UTC.
  return utc - 7 * 60 * 60 * 1000;
}
