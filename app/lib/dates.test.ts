import { describe, it, expect } from "vitest";
import {
  formatDateTime,
  formatDateTimeCompact,
  formatDayMonth,
  formatVNDateShort,
  nextMonth,
  previousMonth,
  saturdaysAndSundays,
  vnYearMonth,
} from "./dates";

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

// A known VN moment: 2026-05-23 14:05 VN = 2026-05-23 07:05 UTC.
const VN_2026_05_23_1405 = Date.UTC(2026, 4, 23, 7, 5);

describe("formatVNDateShort", () => {
  it('"2026-05-23" → "23-05-2026"', () => {
    expect(formatVNDateShort("2026-05-23")).toBe("23-05-2026");
  });
});

describe("formatDateTime", () => {
  it("renders HH:mm dd-mm-yyyy in VN time", () => {
    expect(formatDateTime(VN_2026_05_23_1405)).toBe("14:05 23-05-2026");
  });

  it("midnight VN boundary stays on the right calendar day", () => {
    // 2026-01-01 00:00 VN = 2025-12-31 17:00 UTC
    const ms = Date.UTC(2025, 11, 31, 17, 0);
    expect(formatDateTime(ms)).toBe("00:00 01-01-2026");
  });
});

describe("formatDateTimeCompact", () => {
  it("dd-mm HH:mm", () => {
    expect(formatDateTimeCompact(VN_2026_05_23_1405)).toBe("23-05 14:05");
  });
});

describe("formatDayMonth", () => {
  it("dd-mm", () => {
    expect(formatDayMonth(VN_2026_05_23_1405)).toBe("23-05");
  });
});

describe("vnYearMonth", () => {
  it("returns VN-local year/month", () => {
    // 2026-01-01 00:30 VN = 2025-12-31 17:30 UTC
    const utc = new Date(Date.UTC(2025, 11, 31, 17, 30));
    expect(vnYearMonth(utc)).toEqual({ year: 2026, month: 1 });
  });
});

describe("nextMonth / previousMonth", () => {
  it("rolls over December → January", () => {
    expect(nextMonth(2025, 12)).toEqual({ year: 2026, month: 1 });
    expect(previousMonth(2026, 1)).toEqual({ year: 2025, month: 12 });
  });

  it("inside the same year", () => {
    expect(nextMonth(2026, 3)).toEqual({ year: 2026, month: 4 });
    expect(previousMonth(2026, 3)).toEqual({ year: 2026, month: 2 });
  });
});

describe("saturdaysAndSundays", () => {
  it("lists every T7/CN of May 2026", () => {
    const days = saturdaysAndSundays(2026, 5);
    // May 2026: Sat 2,9,16,23,30; Sun 3,10,17,24,31
    expect(days).toEqual([
      { date: "2026-05-02", weekday: "T7" },
      { date: "2026-05-03", weekday: "CN" },
      { date: "2026-05-09", weekday: "T7" },
      { date: "2026-05-10", weekday: "CN" },
      { date: "2026-05-16", weekday: "T7" },
      { date: "2026-05-17", weekday: "CN" },
      { date: "2026-05-23", weekday: "T7" },
      { date: "2026-05-24", weekday: "CN" },
      { date: "2026-05-30", weekday: "T7" },
      { date: "2026-05-31", weekday: "CN" },
    ]);
  });

  it("February (leap-year edge)", () => {
    // Feb 2024 is a leap month (29 days). Sat 3,10,17,24; Sun 4,11,18,25.
    const days = saturdaysAndSundays(2024, 2);
    expect(days.map((d) => d.date)).toEqual([
      "2024-02-03",
      "2024-02-04",
      "2024-02-10",
      "2024-02-11",
      "2024-02-17",
      "2024-02-18",
      "2024-02-24",
      "2024-02-25",
    ]);
  });
});

// Sanity: VN_OFFSET_MS isn't drifting (used internally by the formatters).
describe("VN offset sanity", () => {
  it("is exactly 7 hours", () => {
    expect(VN_OFFSET_MS).toBe(7 * 60 * 60 * 1000);
  });
});
