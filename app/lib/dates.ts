/**
 * Vietnam-timezone helpers. Cloudflare Workers run UTC; we treat VN as UTC+7
 * (no DST). All "VN date" computations construct dates via offset arithmetic
 * so behavior is deterministic without depending on platform tz.
 */

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export function nowVN(): Date {
  return new Date(Date.now() + VN_OFFSET_MS);
}

export function toVN(utc: Date): Date {
  return new Date(utc.getTime() + VN_OFFSET_MS);
}

/** Returns {year, month (1..12)} for a UTC Date interpreted in VN time. */
export function vnYearMonth(utc: Date): { year: number; month: number } {
  const v = toVN(utc);
  return { year: v.getUTCFullYear(), month: v.getUTCMonth() + 1 };
}

export function vnDayOfMonth(utc: Date): number {
  return toVN(utc).getUTCDate();
}

/**
 * Given VN year/month and the configured open/close days, returns the absolute
 * vote-window timestamps (UTC ms). The vote for month N opens at 09:00 VN on
 * `openDay` of month N-1 and closes at 23:59 VN on `closeDay` of month N-1.
 */
export function voteWindow(
  year: number,
  month: number,
  openDay: number,
  closeDay: number,
): { openAt: number; closeAt: number } {
  const prev = previousMonth(year, month);
  const openVN = Date.UTC(prev.year, prev.month - 1, openDay, 9, 0, 0);
  const closeVN = Date.UTC(prev.year, prev.month - 1, closeDay, 23, 59, 0);
  return { openAt: openVN - VN_OFFSET_MS, closeAt: closeVN - VN_OFFSET_MS };
}

export function previousMonth(year: number, month: number): { year: number; month: number } {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

export function nextMonth(year: number, month: number): { year: number; month: number } {
  if (month === 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

/** Group's VN weekday codes — full 7-day set. T2 = Monday … CN = Sunday. */
export type WeekdayCode = "T2" | "T3" | "T4" | "T5" | "T6" | "T7" | "CN";

/** JS Date.getDay() index → our weekday code (Sun = 0 in JS). */
const WEEKDAY_BY_DOW: WeekdayCode[] = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/** Human label for a weekday code — used in UI when the short code is too
 * terse. */
export const WEEKDAY_LABEL: Record<WeekdayCode, string> = {
  T2: "Thứ 2",
  T3: "Thứ 3",
  T4: "Thứ 4",
  T5: "Thứ 5",
  T6: "Thứ 6",
  T7: "Thứ 7",
  CN: "Chủ nhật",
};

/** Every day in given VN month, tagged with weekday code, as 'YYYY-MM-DD'. */
export function daysOfMonth(
  year: number,
  month: number,
): Array<{ date: string; weekday: WeekdayCode }> {
  const out: Array<{ date: string; weekday: WeekdayCode }> = [];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    out.push({ date: fmtDate(year, month, d), weekday: WEEKDAY_BY_DOW[dow] });
  }
  return out;
}

/** Back-compat shim — same shape as old helper but typed against the wider
 * enum. New callers should use `daysOfMonth` directly. */
export function saturdaysAndSundays(
  year: number,
  month: number,
): Array<{ date: string; weekday: WeekdayCode }> {
  return daysOfMonth(year, month).filter((d) => d.weekday === "T7" || d.weekday === "CN");
}

function fmtDate(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatVNDateShort(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-");
  return `${d}-${m}-${y}`;
}

/** "MM-YYYY" — single source of truth for month labels across the UI. */
export function formatMonthYear(year: number, month: number): string {
  return `${pad(month)}-${year}`;
}

// All ms-based formatters interpret `ms` as a UTC timestamp and shift to VN
// (UTC+7) for display.
function toVnParts(ms: number): { dd: string; mm: string; yyyy: string; HH: string; MM: string } {
  const d = new Date(ms + VN_OFFSET_MS);
  return {
    dd: pad(d.getUTCDate()),
    mm: pad(d.getUTCMonth() + 1),
    yyyy: String(d.getUTCFullYear()),
    HH: pad(d.getUTCHours()),
    MM: pad(d.getUTCMinutes()),
  };
}

/** "HH:mm dd-mm-yyyy" — for audit timestamps, payment marks. Time leads
 * because the relative recency is what users scan first. */
export function formatDateTime(ms: number): string {
  const p = toVnParts(ms);
  return `${p.HH}:${p.MM} ${p.dd}-${p.mm}-${p.yyyy}`;
}

/** "dd-mm HH:mm" — compact, for in-card history. */
export function formatDateTimeCompact(ms: number): string {
  const p = toVnParts(ms);
  return `${p.dd}-${p.mm} ${p.HH}:${p.MM}`;
}

/** "dd-mm" — for "vote close" labels. */
export function formatDayMonth(ms: number): string {
  const p = toVnParts(ms);
  return `${p.dd}-${p.mm}`;
}
