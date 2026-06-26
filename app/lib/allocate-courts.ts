/**
 * Court allocation algorithm.
 *
 * Given the number of confirmed voters for a session and the venue config,
 * compute (a) total hours to book, (b) which courts to book in what time slots.
 *
 * Rules (Vietnamese spec):
 *   - "3 người 1 giờ sân" => totalHours = floor(people * 2 / peoplePerHour) / 2
 *     (rounds down to nearest 0.5h; default peoplePerHour=3)
 *   - Courts are tried in priority order per weekday.
 *   - Each court has an end time and a max duration; start = end - take.
 *   - If all priority courts are exhausted with remaining hours, that overflow
 *     is surfaced so Admin can adjust manually.
 *
 * NOTE: This is intentionally deterministic. The Admin UI allows manual
 * override of the generated allocations before locking.
 */

export interface CourtPrio {
  /** Court code, e.g. "B2", "C3". */
  code: string;
  /** End time as "HH:mm" (e.g. "10:00"). */
  endTime: string;
  /** Maximum bookable duration (hours) for this court in this weekday. */
  maxHours: number;
}

export interface AllocateConfig {
  /** Number of players that share one hour of court time. */
  peoplePerHour: number;
  /** Priority list per weekday. Only T7 / CN keys are seeded by default;
   * other weekdays return empty (admin must manually add courts via the
   * "Sửa sân" dialog). */
  courtsByWeekday: Partial<Record<string, CourtPrio[]>>;
  /** Minimum voters required to book a session at all. */
  minPeoplePerSession: number;
}

export interface CourtAllocation {
  courtCode: string;
  startTime: string;
  endTime: string;
  displayOrder: number;
}

export interface AllocationResult {
  totalHours: number;
  allocations: CourtAllocation[];
  /** Hours that couldn't be placed in any priority court. > 0 = warning. */
  overflowHours: number;
  /** If false, the session can't be booked (< minPeoplePerSession voters). */
  bookable: boolean;
}

export function calculateTotalHours(people: number, peoplePerHour: number): number {
  if (people <= 0 || peoplePerHour <= 0) return 0;
  // floor to nearest 0.5
  return Math.floor((people * 2) / peoplePerHour) / 2;
}

/** Parse "HH:mm" → "HH:mm" duration in decimal hours. Returns 0 on invalid. */
export function hoursFromHM(start: string, end: string): number {
  const [sh, sm] = start.split(":").map((n) => parseInt(n, 10));
  const [eh, em] = end.split(":").map((n) => parseInt(n, 10));
  if (Number.isNaN(sh) || Number.isNaN(eh) || Number.isNaN(sm) || Number.isNaN(em)) return 0;
  return Math.max(0, (eh * 60 + em - sh * 60 - sm) / 60);
}

/** Sum durations of a list of court allocations (decimal hours). */
export function sumCourtHours(
  courts: Array<{ startTime: string; endTime: string }>,
): number {
  return courts.reduce((sum, c) => sum + hoursFromHM(c.startTime, c.endTime), 0);
}

export function allocateCourts(
  numPeople: number,
  weekday: string,
  cfg: AllocateConfig,
): AllocationResult {
  if (numPeople < cfg.minPeoplePerSession) {
    return { totalHours: 0, allocations: [], overflowHours: 0, bookable: false };
  }

  const totalHours = calculateTotalHours(numPeople, cfg.peoplePerHour);
  const priorities = cfg.courtsByWeekday[weekday] ?? [];
  let remaining = totalHours;
  const out: CourtAllocation[] = [];

  for (let i = 0; i < priorities.length && remaining > 0.0001; i++) {
    const c = priorities[i];
    const take = Math.min(remaining, c.maxHours);
    if (take <= 0) continue;
    const endMins = toMinutes(c.endTime);
    const startMins = endMins - take * 60;
    out.push({
      courtCode: c.code,
      startTime: fromMinutes(startMins),
      endTime: c.endTime,
      displayOrder: i,
    });
    remaining = roundHalfHour(remaining - take);
  }

  return {
    totalHours,
    allocations: out,
    overflowHours: Math.max(0, roundHalfHour(remaining)),
    bookable: true,
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

function fromMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function roundHalfHour(x: number): number {
  return Math.round(x * 2) / 2;
}
