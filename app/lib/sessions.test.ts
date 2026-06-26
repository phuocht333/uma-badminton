import { describe, it, expect } from "vitest";
import { visibleSessions } from "./sessions";

const s = (id: string) => ({ id });

describe("visibleSessions", () => {
  it("keeps all sessions for voting + draft months", () => {
    const sessions = [s("a"), s("b"), s("c")];
    const allocs = [{ playSessionId: "a" }]; // only a has a court
    expect(visibleSessions(sessions, allocs, "voting")).toEqual(sessions);
    expect(visibleSessions(sessions, allocs, "draft")).toEqual(sessions);
  });

  it("drops empty-court sessions when month is locked", () => {
    const sessions = [s("a"), s("b"), s("c")];
    const allocs = [{ playSessionId: "a" }, { playSessionId: "c" }];
    expect(visibleSessions(sessions, allocs, "locked")).toEqual([s("a"), s("c")]);
  });

  it("drops empty-court sessions when month is done", () => {
    const sessions = [s("a"), s("b")];
    const allocs = [{ playSessionId: "b" }];
    expect(visibleSessions(sessions, allocs, "done")).toEqual([s("b")]);
  });

  it("returns empty when no session has a court (closed)", () => {
    expect(visibleSessions([s("a")], [], "locked")).toEqual([]);
  });
});
