import { describe, it, expect } from "vitest";
import {
  attributeSeats,
  attributeSeatsBySession,
  isAttendingSeat,
} from "./seat-attribution";

const v = (
  id: string,
  userId: string,
  status: "thang" | "vang_lai" | "cho_pass" | "da_pass" | "hoan_tien",
  playSessionId = "s1",
) => ({ id, userId, status, playSessionId });

describe("attributeSeats", () => {
  it("emits a seat for each attending vote", () => {
    const seats = attributeSeats([v("v1", "u1", "thang"), v("v2", "u2", "vang_lai")]);
    expect(seats).toEqual([
      { playSessionId: "s1", userId: "u1", status: "thang", sourceVoteId: "v1" },
      { playSessionId: "s1", userId: "u2", status: "vang_lai", sourceVoteId: "v2" },
    ]);
  });

  it("keeps cho_pass on the voter (still on bill until claimed/refunded)", () => {
    const seats = attributeSeats([v("v1", "u1", "cho_pass")]);
    expect(seats).toHaveLength(1);
    expect(seats[0]).toMatchObject({ userId: "u1", status: "cho_pass" });
  });

  it("drops da_pass (ownership moved via new vote)", () => {
    const seats = attributeSeats([v("v1", "u1", "da_pass")]);
    expect(seats).toEqual([]);
  });

  it("drops hoan_tien (refunded)", () => {
    const seats = attributeSeats([v("v1", "u1", "hoan_tien")]);
    expect(seats).toEqual([]);
  });

  it("multi-hop A→B→C: original A's da_pass drops; B's da_pass drops; C's thang remains", () => {
    const seats = attributeSeats([
      v("vA", "A", "da_pass"),
      v("vB", "B", "da_pass"),
      v("vC", "C", "thang"),
    ]);
    expect(seats).toEqual([
      { playSessionId: "s1", userId: "C", status: "thang", sourceVoteId: "vC" },
    ]);
  });
});

describe("attributeSeatsBySession", () => {
  it("buckets per session", () => {
    const map = attributeSeatsBySession([
      v("v1", "u1", "thang", "s1"),
      v("v2", "u2", "thang", "s2"),
      v("v3", "u3", "thang", "s1"),
    ]);
    expect(map.get("s1")).toHaveLength(2);
    expect(map.get("s2")).toHaveLength(1);
  });
});

describe("isAttendingSeat", () => {
  it("only counts thang + vang_lai", () => {
    expect(isAttendingSeat({ status: "thang" } as never)).toBe(true);
    expect(isAttendingSeat({ status: "vang_lai" } as never)).toBe(true);
    expect(isAttendingSeat({ status: "cho_pass" } as never)).toBe(false);
  });
});
