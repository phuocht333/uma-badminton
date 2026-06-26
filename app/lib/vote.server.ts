import { and, eq, inArray, lte } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb, schema } from "~/db/client";
import { allocateCourts } from "./allocate-courts";
import {
  getActiveWeekdays,
  getAllocateConfig,
  getPrices,
  getString,
  getVoteWindowConfig,
  CONFIG_KEYS,
} from "./config.server";
import { daysOfMonth, nextMonth, vnYearMonth, voteWindow, type WeekdayCode } from "./dates";
import {
  sendVoteClosedSummaryEmail,
  sendVoteOpenEmail,
  type VoteCloseSummary,
} from "./email.server";
import { attributeSeats } from "./seat-attribution";
import { visibleSessions } from "./sessions";
import { buildMonthMatrixData } from "./month-matrix.server";
import { writeMonthSnapshot, parseMonthSnapshot } from "./month-snapshot.server";

interface CronEnv {
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  EMAIL_FROM_ADDRESS: string;
  EMAIL_FROM_NAME: string;
  APP_BASE_URL: string;
  SENDGRID_API_KEY: string;
}

/**
 * Vote is ALWAYS open for upcoming months. This ensures the next `lookahead`
 * calendar months (relative to the firing time) all exist in `voting` state.
 *
 * Idempotent: re-running creates only what's missing.
 * Called from the morning cron AND lazily on /vote page load (cheap).
 */
const DEFAULT_LOOKAHEAD = 2;

/**
 * Ensures month rows exist (initially `draft`) for the next `lookahead`
 * calendar months. A draft month only flips to `voting` once its configured
 * `voteOpenAt` has actually passed — see `transitionToVoting`. Invite emails
 * are sent at that moment, not at creation.
 *
 * The current calendar month is intentionally NOT auto-created: its vote
 * window belongs to last month's cycle, so cold-creating it as "voting" today
 * would surface a phantom open vote (e.g. seeing "Tháng 05" still open on May
 * 31 just because the DB had nothing for May).
 *
 * Idempotent.
 */
export async function ensureUpcomingVotingMonths(
  env: CronEnv,
  fireTime: Date,
  lookahead = DEFAULT_LOOKAHEAD,
): Promise<Array<{ year: number; month: number; created: boolean }>> {
  const { year: y0, month: m0 } = vnYearMonth(fireTime);
  const out: Array<{ year: number; month: number; created: boolean }> = [];
  let cursor = { year: y0, month: m0 };
  for (let i = 1; i <= lookahead; i++) {
    cursor = nextMonth(cursor.year, cursor.month);
    const existed = await monthExists(env.DB, cursor.year, cursor.month);
    await ensureMonthExists(env, cursor.year, cursor.month);
    const opened = await transitionToVoting(env, cursor.year, cursor.month);
    // Invites go out exactly when the vote actually opens — not at draft
    // creation, otherwise members would get a "vote is open" email for a
    // month whose voteOpenAt is still days away.
    if (opened) {
      await sendInvitesForMonth(env, cursor.year, cursor.month);
    }
    out.push({ ...cursor, created: !existed });
  }
  return out;
}

/**
 * Close ANY voting month whose voteCloseAt has passed. Runs nightly.
 * Idempotent.
 */
export async function closeDueVotingMonths(env: CronEnv, fireTime: Date): Promise<void> {
  const db = getDb(env.DB);
  const now = fireTime.getTime();
  const due = await db.query.months.findMany({
    where: and(eq(schema.months.status, "voting"), lte(schema.months.voteCloseAt, now)),
  });
  for (const m of due) {
    await lockAndAllocate(env, m.year, m.month);
    await sendSummariesForMonth(env, m.year, m.month);
  }
}

/** Convenience wrapper retained for the Admin "open vote next month" button. */
export async function openMonthlyVote(env: CronEnv, fireTime: Date): Promise<void> {
  await ensureUpcomingVotingMonths(env, fireTime);
}

/** Convenience wrapper retained for the Admin "close current vote" button. */
export async function closeMonthlyVote(env: CronEnv, fireTime: Date): Promise<void> {
  const { year: y0, month: m0 } = vnYearMonth(fireTime);
  const target = nextMonth(y0, m0);
  await lockAndAllocate(env, target.year, target.month);
  await sendSummariesForMonth(env, target.year, target.month);
}

async function monthExists(d1: D1Database, year: number, month: number): Promise<boolean> {
  const db = getDb(d1);
  const m = await db.query.months.findFirst({
    where: and(eq(schema.months.year, year), eq(schema.months.month, month)),
  });
  return !!m;
}

/* ------------------------------ helpers ------------------------------ */

export interface ReconcileResult {
  added: number;
  removed: number;
  kept: number;
  skipped?: true;
}

/**
 * Sync `play_sessions` for a month against the given active-weekday set.
 *
 * - Locked / done months are immutable: returns `{skipped: true}` and leaves
 *   the existing rows alone — their schedule is part of the frozen record.
 * - Adds sessions for active weekdays whose date has no session yet.
 * - Removes existing sessions whose weekday is no longer active, but ONLY
 *   when they hold zero votes AND zero court_allocations. Anything with
 *   member intent or admin-set courts is preserved so we never silently
 *   drop their work — admin can clean up manually if truly unwanted.
 */
export async function reconcileMonthSessions(
  d1: D1Database,
  monthId: string,
  activeWeekdays: WeekdayCode[],
): Promise<ReconcileResult> {
  const db = getDb(d1);
  const m = await db.query.months.findFirst({
    where: eq(schema.months.id, monthId),
  });
  if (!m) return { added: 0, removed: 0, kept: 0, skipped: true };
  if (m.status === "locked" || m.status === "done") {
    return { added: 0, removed: 0, kept: 0, skipped: true };
  }

  const activeSet = new Set<WeekdayCode>(activeWeekdays);
  const desired = daysOfMonth(m.year, m.month).filter((d) => activeSet.has(d.weekday));
  const existing = await db.query.playSessions.findMany({
    where: eq(schema.playSessions.monthId, monthId),
  });
  const existingByDate = new Map(existing.map((s) => [s.date, s] as const));

  const toAdd = desired.filter((d) => !existingByDate.has(d.date));
  const removeCandidates = existing.filter((s) => !activeSet.has(s.weekday));

  let removed = 0;
  for (const s of removeCandidates) {
    const [voteRow, courtRow] = await Promise.all([
      db.query.votes.findFirst({ where: eq(schema.votes.playSessionId, s.id) }),
      db.query.courtAllocations.findFirst({
        where: eq(schema.courtAllocations.playSessionId, s.id),
      }),
    ]);
    if (voteRow || courtRow) continue;
    await db.delete(schema.playSessions).where(eq(schema.playSessions.id, s.id));
    removed++;
  }

  if (toAdd.length > 0) {
    await db.insert(schema.playSessions).values(
      toAdd.map((d) => ({
        id: ulid(),
        monthId,
        date: d.date,
        weekday: d.weekday,
      })),
    );
  }

  return { added: toAdd.length, removed, kept: existing.length - removed };
}

export async function ensureMonthExists(
  env: { DB: D1Database },
  year: number,
  month: number,
): Promise<schema.Month> {
  const db = getDb(env.DB);
  const existing = await db.query.months.findFirst({
    where: and(eq(schema.months.year, year), eq(schema.months.month, month)),
  });
  if (existing) {
    // Self-heal: a prior partial write (or a config change since creation)
    // can leave play_sessions out of sync with the active-weekday config.
    // Reconcile here so every page-load / cron firing converges.
    const activeWeekdays = await getActiveWeekdays(env.DB);
    await reconcileMonthSessions(env.DB, existing.id, activeWeekdays);
    return existing;
  }

  const { openDay, closeDay } = await getVoteWindowConfig(env.DB);
  const { openAt, closeAt } = voteWindow(year, month, openDay, closeDay);
  const id = ulid();
  const now = Date.now();
  await db.insert(schema.months).values({
    id,
    year,
    month,
    status: "draft",
    voteOpenAt: openAt,
    voteCloseAt: closeAt,
    createdAt: now,
  });

  // Create play sessions only for weekdays admin configured as active.
  // Filters every calendar day in the month to the active set; empty config
  // would skip session creation entirely (validator above prevents save).
  const activeWeekdays = await getActiveWeekdays(env.DB);
  const activeSet = new Set<string>(activeWeekdays);
  const sessions = daysOfMonth(year, month).filter((s) => activeSet.has(s.weekday));
  if (sessions.length > 0) {
    await db.insert(schema.playSessions).values(
      sessions.map((s) => ({
        id: ulid(),
        monthId: id,
        date: s.date,
        weekday: s.weekday,
      })),
    );
  }

  return (await db.query.months.findFirst({
    where: eq(schema.months.id, id),
  }))!;
}

/**
 * Flip a draft month to voting — but only once its configured `voteOpenAt`
 * has actually passed. Returns true if the transition happened so callers can
 * gate side-effects (invite emails) on it.
 */
export async function transitionToVoting(
  env: { DB: D1Database },
  year: number,
  month: number,
): Promise<boolean> {
  const db = getDb(env.DB);
  const m = await db.query.months.findFirst({
    where: and(eq(schema.months.year, year), eq(schema.months.month, month)),
  });
  if (!m) return false;
  if (m.status !== "draft") return false;
  if (Date.now() < m.voteOpenAt) return false;
  await db.update(schema.months).set({ status: "voting" }).where(eq(schema.months.id, m.id));
  return true;
}

export async function sendInvitesForMonth(
  env: CronEnv,
  year: number,
  month: number,
): Promise<void> {
  const db = getDb(env.DB);
  const m = await db.query.months.findFirst({
    where: and(eq(schema.months.year, year), eq(schema.months.month, month)),
  });
  if (!m) return;
  const members = await db.query.users.findMany({
    where: eq(schema.users.isActive, true),
  });
  const closeAt = new Date(m.voteCloseAt);
  for (const u of members) {
    try {
      await sendVoteOpenEmail(env, { id: u.id, name: u.name, email: u.email }, {
        year,
        month,
        closeAt,
      });
    } catch (e) {
      console.error(`[vote-open-email] failed for ${u.email}`, e);
    }
  }
}

/**
 * Vote closes → "Đã khoá" (DB `locked`). Auto-allocate courts from current
 * vote counts. NO snapshot here — "Đã khoá" still lets admin reshape the
 * matrix; /lich shows live data while the month is in this state. Snapshot
 * happens at `freezeMonthAsBooked` (admin clicks "Chốt đã đặt sân").
 */
export async function lockAndAllocate(
  env: { DB: D1Database },
  year: number,
  month: number,
): Promise<void> {
  const db = getDb(env.DB);
  const m = await db.query.months.findFirst({
    where: and(eq(schema.months.year, year), eq(schema.months.month, month)),
  });
  if (!m || m.status === "done") return;

  const cfg = await getAllocateConfig(env.DB);
  const sessions = await db.query.playSessions.findMany({ where: eq(schema.playSessions.monthId, m.id) });

  if (sessions.length > 0) {
    const sessionIds = sessions.map((s) => s.id);
    await db
      .delete(schema.courtAllocations)
      .where(inArray(schema.courtAllocations.playSessionId, sessionIds));
  }

  for (const s of sessions) {
    const voteRows = await db.query.votes.findMany({
      where: and(
        eq(schema.votes.playSessionId, s.id),
        // count only confirmed-attending statuses
        inArray(schema.votes.status, ["thang", "vang_lai"]),
      ),
    });
    const numPeople = voteRows.length;
    const result = allocateCourts(numPeople, s.weekday, cfg);
    if (!result.bookable) continue;
    if (result.allocations.length === 0) continue;
    await db.insert(schema.courtAllocations).values(
      result.allocations.map((a) => ({
        id: ulid(),
        playSessionId: s.id,
        courtCode: a.courtCode,
        startTime: a.startTime,
        endTime: a.endTime,
        displayOrder: a.displayOrder,
      })),
    );
  }

  await db.update(schema.months).set({ status: "locked" }).where(eq(schema.months.id, m.id));
}

/**
 * Admin clicks "Chốt đã đặt sân" on a locked month. Snapshot the current
 * matrix (becomes the immutable bill), flip status to `done`, and auto-open
 * the next calendar month for voting.
 */
export async function freezeMonthAsBooked(
  env: CronEnv,
  year: number,
  month: number,
): Promise<{ ok: true } | { error: string }> {
  const db = getDb(env.DB);
  const m = await db.query.months.findFirst({
    where: and(eq(schema.months.year, year), eq(schema.months.month, month)),
  });
  if (!m) return { error: "Không tìm thấy tháng." };
  if (m.status !== "locked") return { error: "Tháng chưa ở trạng thái 'Đã khoá'." };

  // Snapshot the matrix as it stands right now — admin's edits before
  // freezing have been live on /lich; from this moment they're frozen.
  const matrix = await buildMonthMatrixData(env.DB, m.id, "locked", { skipSnapshot: true });
  await writeMonthSnapshot(env.DB, m.id, { matrix });

  await db.update(schema.months).set({ status: "done" }).where(eq(schema.months.id, m.id));

  // Auto-open the next month's vote — there should always be a "Đang mở vote"
  // available once a month is frozen.
  const next = nextMonth(year, month);
  await ensureMonthExists(env, next.year, next.month);
  await transitionToVoting(env, next.year, next.month);

  return { ok: true };
}

/**
 * Reverse Khoá → Vote (admin override). Only flips month status so members can
 * keep voting — existing court allocations, pass requests, vãng lai requests,
 * and the lock-time snapshot are preserved.
 */
export async function unlockMonthForVoting(
  env: { DB: D1Database },
  year: number,
  month: number,
): Promise<{ ok: true } | { error: string }> {
  const db = getDb(env.DB);
  const m = await db.query.months.findFirst({
    where: and(eq(schema.months.year, year), eq(schema.months.month, month)),
  });
  if (!m) return { error: "Không tìm thấy tháng." };
  if (m.status !== "locked") return { error: "Tháng không ở trạng thái 'Đã khoá'." };

  await db
    .update(schema.months)
    .set({ status: "voting" })
    .where(eq(schema.months.id, m.id));
  return { ok: true };
}

/**
 * Admin override: force-close a voting month without waiting for cron. Same
 * effect as `lockAndAllocate` — votes get locked + courts allocated.
 */
export async function forceLockMonth(
  env: { DB: D1Database },
  year: number,
  month: number,
): Promise<{ ok: true } | { error: string }> {
  const db = getDb(env.DB);
  const m = await db.query.months.findFirst({
    where: and(eq(schema.months.year, year), eq(schema.months.month, month)),
  });
  if (!m) return { error: "Không tìm thấy tháng." };
  if (m.status !== "voting") return { error: "Tháng không ở trạng thái 'Đang mở vote'." };
  await lockAndAllocate(env, year, month);
  return { ok: true };
}

/**
 * Compute totals per user for a given month: list of sessions joined, total fee.
 * Used for the post-close summary email and for the member dashboard.
 */
export async function computeMemberTotals(
  d1: D1Database,
  year: number,
  month: number,
): Promise<Map<string, { totalSlots: number; totalFee: number; sessions: Array<{ date: string; weekday: WeekdayCode; status: schema.Vote["status"] }> }>> {
  const db = getDb(d1);
  const m = await db.query.months.findFirst({
    where: and(eq(schema.months.year, year), eq(schema.months.month, month)),
  });
  if (!m) return new Map();

  // "Đã đặt sân" derives totals from the frozen matrix. "Đã khoá" computes
  // live — admin tweaks on a not-yet-frozen month still flow into the bill.
  if (m.status === "done") {
    const snap = parseMonthSnapshot(m.lockedSnapshot);
    if (snap) return totalsFromSnapshot(snap.matrix);
  }

  const prices = await getPrices(d1);

  const allSessions = await db.query.playSessions.findMany({
    where: eq(schema.playSessions.monthId, m.id),
  });
  if (allSessions.length === 0) return new Map();

  // Seat attribution is vote-centric (a claim writes a new vote for the
  // claimer); shared with the matrix view so the bill never drifts.
  const [allVotes, allocs] = await Promise.all([
    db.query.votes.findMany({
      where: inArray(
        schema.votes.playSessionId,
        allSessions.map((s) => s.id),
      ),
    }),
    db.query.courtAllocations.findMany({
      where: inArray(
        schema.courtAllocations.playSessionId,
        allSessions.map((s) => s.id),
      ),
    }),
  ]);

  const sessions = visibleSessions(allSessions, allocs, m.status);
  const sessionsById = new Map(sessions.map((s) => [s.id, s] as const));
  const users = await db.query.users.findMany();
  const userById = new Map(users.map((u) => [u.id, u] as const));

  // Dedup by (user, session): one person fills at most one seat per session,
  // even if anomalous data shows both a direct vote and a claim. Matches the
  // matrix view, which keys cells by user|session.
  const seatByUserSession = new Map<string, ReturnType<typeof attributeSeats>[number]>();
  for (const seat of attributeSeats(allVotes)) {
    const key = `${seat.userId}|${seat.playSessionId}`;
    const prev = seatByUserSession.get(key);
    // Prefer attending seats (thang/vang_lai) over unclaimed cho_pass placeholders.
    if (!prev || prev.status === "cho_pass") {
      seatByUserSession.set(key, seat);
    }
  }

  const totals = new Map<string, { totalSlots: number; totalFee: number; sessions: Array<{ date: string; weekday: WeekdayCode; status: schema.Vote["status"] }> }>();
  for (const seat of seatByUserSession.values()) {
    const u = userById.get(seat.userId);
    const s = sessionsById.get(seat.playSessionId);
    if (!u || !s) continue;
    // Unclaimed cho_pass / da_pass voters remain on the bill at thang rate
    // until the pass is claimed or the seat is refunded.
    const tier = seat.status === "vang_lai" ? "vang_lai" : "thang";
    const fee = prices[tier][u.gender];
    const cur = totals.get(seat.userId) ?? { totalSlots: 0, totalFee: 0, sessions: [] };
    cur.totalSlots += 1;
    cur.totalFee += fee;
    cur.sessions.push({ date: s.date, weekday: s.weekday, status: seat.status });
    totals.set(seat.userId, cur);
  }
  return totals;
}


/**
 * Re-derive per-member totals from a frozen matrix snapshot. The matrix
 * already holds totalSlots/totalFee per user and a list of session statuses
 * per cell — we just need to pivot them back into `Map<userId, totals>`.
 */
function totalsFromSnapshot(
  matrix: import("./month-matrix.server").MonthMatrixData,
): Map<string, { totalSlots: number; totalFee: number; sessions: Array<{ date: string; weekday: WeekdayCode; status: schema.Vote["status"] }> }> {
  const out = new Map<
    string,
    { totalSlots: number; totalFee: number; sessions: Array<{ date: string; weekday: WeekdayCode; status: schema.Vote["status"] }> }
  >();
  for (const row of matrix.rows) {
    const sessionsForUser: Array<{ date: string; weekday: WeekdayCode; status: schema.Vote["status"] }> = [];
    matrix.sessions.forEach((sess, i) => {
      const cell = row.cells[i];
      if (cell?.status === "thang" || cell?.status === "vang_lai") {
        sessionsForUser.push({ date: sess.date, weekday: sess.weekday, status: cell.status });
      }
    });
    out.set(row.user.id, {
      totalSlots: row.totalSlots,
      totalFee: row.totalFee,
      sessions: sessionsForUser,
    });
  }
  return out;
}

export async function sendSummariesForMonth(env: CronEnv, year: number, month: number): Promise<void> {
  const db = getDb(env.DB);
  const totals = await computeMemberTotals(env.DB, year, month);
  const users = await db.query.users.findMany({ where: eq(schema.users.isActive, true) });
  const adminQrKey = await getString(env.DB, CONFIG_KEYS.ADMIN_QR_IMAGE_KEY, "");
  const adminQrUrl = adminQrKey ? `${env.APP_BASE_URL}/qr/${encodeURIComponent(adminQrKey)}` : undefined;

  for (const u of users) {
    const t = totals.get(u.id);
    if (!t || t.totalSlots === 0) continue;
    const summary: VoteCloseSummary = {
      year,
      month,
      totalSlots: t.totalSlots,
      totalFee: t.totalFee,
      adminQrUrl,
      sessions: t.sessions.sort((a, b) => a.date.localeCompare(b.date)).map((s) => ({
        date: s.date,
        weekday: s.weekday,
      })),
    };
    try {
      await sendVoteClosedSummaryEmail(env, { id: u.id, name: u.name, email: u.email }, summary);
    } catch (e) {
      console.error(`[vote-close-email] failed for ${u.email}`, e);
    }
  }
}
