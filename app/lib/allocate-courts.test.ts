import { describe, it, expect } from "vitest";
import { calculateTotalHours, allocateCourts, type AllocateConfig } from "./allocate-courts";

const cfg: AllocateConfig = {
  peoplePerHour: 3,
  minPeoplePerSession: 6,
  courtsByWeekday: {
    CN: [
      { code: "B2", endTime: "10:00", maxHours: 2 },
      { code: "B1", endTime: "10:00", maxHours: 2 },
      { code: "B4", endTime: "10:00", maxHours: 2 },
    ],
    T7: [
      { code: "C3", endTime: "10:00", maxHours: 2 },
      { code: "C4", endTime: "10:00", maxHours: 2 },
      { code: "B4", endTime: "10:00", maxHours: 2 },
    ],
  },
};

describe("calculateTotalHours", () => {
  it("matches spec examples", () => {
    expect(calculateTotalHours(12, 3)).toBe(4);
    expect(calculateTotalHours(13, 3)).toBe(4);
    expect(calculateTotalHours(14, 3)).toBe(4.5);
    expect(calculateTotalHours(15, 3)).toBe(5);
  });

  it("rounds down to 0.5", () => {
    expect(calculateTotalHours(6, 3)).toBe(2);
    expect(calculateTotalHours(7, 3)).toBe(2);
    expect(calculateTotalHours(8, 3)).toBe(2.5);
    expect(calculateTotalHours(9, 3)).toBe(3);
  });
});

describe("allocateCourts", () => {
  it("blocks booking under min voters", () => {
    const r = allocateCourts(5, "CN", cfg);
    expect(r.bookable).toBe(false);
    expect(r.allocations).toHaveLength(0);
  });

  it("CN 8 voters -> 2.5h: B2 full + B1 0.5h", () => {
    const r = allocateCourts(8, "CN", cfg);
    expect(r.bookable).toBe(true);
    expect(r.totalHours).toBe(2.5);
    expect(r.allocations).toEqual([
      { courtCode: "B2", startTime: "08:00", endTime: "10:00", displayOrder: 0 },
      { courtCode: "B1", startTime: "09:30", endTime: "10:00", displayOrder: 1 },
    ]);
    expect(r.overflowHours).toBe(0);
  });

  it("CN 15 voters -> 5h: B2 + B1 + B4 (deterministic priority fill)", () => {
    const r = allocateCourts(15, "CN", cfg);
    expect(r.totalHours).toBe(5);
    expect(r.allocations.map((a) => a.courtCode)).toEqual(["B2", "B1", "B4"]);
    expect(r.allocations[0]).toMatchObject({ startTime: "08:00", endTime: "10:00" });
    expect(r.allocations[1]).toMatchObject({ startTime: "08:00", endTime: "10:00" });
    expect(r.allocations[2]).toMatchObject({ startTime: "09:00", endTime: "10:00" });
  });

  it("CN 14 voters -> 4.5h: B2 full + B1 full + B4 0.5h", () => {
    const r = allocateCourts(14, "CN", cfg);
    expect(r.totalHours).toBe(4.5);
    expect(r.allocations).toEqual([
      { courtCode: "B2", startTime: "08:00", endTime: "10:00", displayOrder: 0 },
      { courtCode: "B1", startTime: "08:00", endTime: "10:00", displayOrder: 1 },
      { courtCode: "B4", startTime: "09:30", endTime: "10:00", displayOrder: 2 },
    ]);
  });

  it("T7 9 voters -> 3h: C3 full + C4 1h", () => {
    const r = allocateCourts(9, "T7", cfg);
    expect(r.totalHours).toBe(3);
    expect(r.allocations.map((a) => a.courtCode)).toEqual(["C3", "C4"]);
    expect(r.allocations[1]).toMatchObject({ startTime: "09:00", endTime: "10:00" });
  });

  it("reports overflow when demand exceeds priority list", () => {
    const r = allocateCourts(30, "CN", cfg); // 30*2/3/2 = 10h, only 6h capacity
    expect(r.totalHours).toBe(10);
    expect(r.overflowHours).toBe(4);
    expect(r.allocations).toHaveLength(3);
  });
});
