import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "~/db/schema";
import { setActiveWeekdays } from "~/lib/config.server";
import { ensureMonthExists, reconcileMonthSessions } from "~/lib/vote.server";
import { createTestEnv, type TestEnv } from "./harness";

async function seedMonth(
  env: TestEnv,
  opts: { year: number; month: number; status: schema.Month["status"] },
): Promise<string> {
  const id = ulid();
  const now = Date.now();
  await env.db.insert(schema.months).values({
    id,
    year: opts.year,
    month: opts.month,
    status: opts.status,
    voteOpenAt: now,
    voteCloseAt: now + 1000,
    createdAt: now,
  });
  return id;
}

async function seedUser(env: TestEnv): Promise<string> {
  const id = ulid();
  const now = Date.now();
  await env.db.insert(schema.users).values({
    id,
    email: `${id}@x.com`,
    name: "U",
    gender: "nam",
    role: "member",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function seedSession(
  env: TestEnv,
  monthId: string,
  date: string,
  weekday: schema.PlaySession["weekday"],
): Promise<string> {
  const id = ulid();
  await env.db.insert(schema.playSessions).values({ id, monthId, date, weekday });
  return id;
}

async function listSessions(env: TestEnv, monthId: string) {
  return env.db.query.playSessions.findMany({
    where: eq(schema.playSessions.monthId, monthId),
  });
}

/* July 2026 has these weekdays:
 *   T7 (Sat): 04, 11, 18, 25  (4 sessions)
 *   CN (Sun): 05, 12, 19, 26  (4 sessions)
 */
describe("reconcileMonthSessions", () => {
  it("adds CN sessions when month has no sessions yet", async () => {
    const env = createTestEnv();
    const monthId = await seedMonth(env, { year: 2026, month: 7, status: "voting" });

    const result = await reconcileMonthSessions(env.d1, monthId, ["CN"]);

    expect(result).toEqual({ added: 4, removed: 0, kept: 0 });
    const sessions = await listSessions(env, monthId);
    expect(sessions).toHaveLength(4);
    expect(sessions.every((s) => s.weekday === "CN")).toBe(true);
    expect(sessions.map((s) => s.date).sort()).toEqual([
      "2026-07-05",
      "2026-07-12",
      "2026-07-19",
      "2026-07-26",
    ]);
  });

  it("removes inactive-weekday sessions when they have zero votes and zero courts", async () => {
    const env = createTestEnv();
    const monthId = await seedMonth(env, { year: 2026, month: 7, status: "voting" });
    await seedSession(env, monthId, "2026-07-04", "T7");
    await seedSession(env, monthId, "2026-07-05", "CN");

    const result = await reconcileMonthSessions(env.d1, monthId, ["CN"]);

    expect(result).toEqual({ added: 3, removed: 1, kept: 1 });
    const sessions = await listSessions(env, monthId);
    expect(sessions).toHaveLength(4);
    expect(sessions.every((s) => s.weekday === "CN")).toBe(true);
  });

  it("keeps inactive-weekday sessions that already have a vote (safety)", async () => {
    const env = createTestEnv();
    const monthId = await seedMonth(env, { year: 2026, month: 7, status: "voting" });
    const userId = await seedUser(env);
    const t7SessionId = await seedSession(env, monthId, "2026-07-04", "T7");
    await env.db.insert(schema.votes).values({
      id: ulid(),
      playSessionId: t7SessionId,
      userId,
      status: "thang",
      votedAt: Date.now(),
    });

    const result = await reconcileMonthSessions(env.d1, monthId, ["CN"]);

    expect(result).toEqual({ added: 4, removed: 0, kept: 1 });
    const sessions = await listSessions(env, monthId);
    const survivingT7 = sessions.filter((s) => s.weekday === "T7");
    expect(survivingT7).toHaveLength(1);
    expect(survivingT7[0].date).toBe("2026-07-04");
  });

  it("keeps inactive-weekday sessions that have court_allocations (safety)", async () => {
    const env = createTestEnv();
    const monthId = await seedMonth(env, { year: 2026, month: 7, status: "voting" });
    const t7SessionId = await seedSession(env, monthId, "2026-07-04", "T7");
    await env.db.insert(schema.courtAllocations).values({
      id: ulid(),
      playSessionId: t7SessionId,
      courtCode: "B1",
      startTime: "08:00",
      endTime: "10:00",
      displayOrder: 0,
    });

    const result = await reconcileMonthSessions(env.d1, monthId, ["CN"]);

    expect(result).toEqual({ added: 4, removed: 0, kept: 1 });
    const sessions = await listSessions(env, monthId);
    expect(sessions.filter((s) => s.weekday === "T7")).toHaveLength(1);
  });

  it("skips locked months entirely (no add, no remove)", async () => {
    const env = createTestEnv();
    const monthId = await seedMonth(env, { year: 2026, month: 7, status: "locked" });
    await seedSession(env, monthId, "2026-07-04", "T7");

    const result = await reconcileMonthSessions(env.d1, monthId, ["CN"]);

    expect(result).toEqual({ added: 0, removed: 0, kept: 0, skipped: true });
    const sessions = await listSessions(env, monthId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].weekday).toBe("T7");
  });

  it("skips done months entirely (no add, no remove)", async () => {
    const env = createTestEnv();
    const monthId = await seedMonth(env, { year: 2026, month: 7, status: "done" });
    await seedSession(env, monthId, "2026-07-04", "T7");

    const result = await reconcileMonthSessions(env.d1, monthId, ["CN"]);

    expect(result).toEqual({ added: 0, removed: 0, kept: 0, skipped: true });
    const sessions = await listSessions(env, monthId);
    expect(sessions).toHaveLength(1);
  });

  it("is idempotent when config matches existing sessions", async () => {
    const env = createTestEnv();
    const monthId = await seedMonth(env, { year: 2026, month: 7, status: "voting" });

    await reconcileMonthSessions(env.d1, monthId, ["CN"]);
    const result2 = await reconcileMonthSessions(env.d1, monthId, ["CN"]);

    expect(result2).toEqual({ added: 0, removed: 0, kept: 4 });
  });

  it("operates on draft months too (not yet flipped to voting)", async () => {
    const env = createTestEnv();
    const monthId = await seedMonth(env, { year: 2026, month: 7, status: "draft" });

    const result = await reconcileMonthSessions(env.d1, monthId, ["CN"]);

    expect(result).toEqual({ added: 4, removed: 0, kept: 0 });
  });
});

/* Locks in the cron / page-load path: when a future month is created or
 * re-visited, sessions must reflect the current admin config — no manual
 * "Lưu" click required.
 */
describe("ensureMonthExists × active_weekdays config", () => {
  it("seeds sessions matching the active_weekdays config when creating a new month", async () => {
    const env = createTestEnv();
    await setActiveWeekdays(env.d1, ["CN"]);

    await ensureMonthExists({ DB: env.d1 }, 2026, 8);

    const m = await env.db.query.months.findFirst({
      where: and(eq(schema.months.year, 2026), eq(schema.months.month, 8)),
    });
    expect(m).toBeTruthy();
    const sessions = await listSessions(env, m!.id);
    // August 2026: Sundays fall on 02, 09, 16, 23, 30 → 5 sessions.
    expect(sessions).toHaveLength(5);
    expect(sessions.every((s) => s.weekday === "CN")).toBe(true);
  });

  it("self-heals an existing month whose play_sessions are out of sync with config", async () => {
    const env = createTestEnv();
    // Simulate a prior partial write: month row exists, no sessions.
    const monthId = await seedMonth(env, { year: 2026, month: 7, status: "voting" });
    await setActiveWeekdays(env.d1, ["CN"]);

    // Cron firing (or /trang-chu loader) calls ensureMonthExists for the
    // already-existing month — the self-heal branch should fill it in.
    await ensureMonthExists({ DB: env.d1 }, 2026, 7);

    const sessions = await listSessions(env, monthId);
    expect(sessions).toHaveLength(4);
    expect(sessions.every((s) => s.weekday === "CN")).toBe(true);
  });

  it("on subsequent runs, picks up an updated config without manual admin save", async () => {
    const env = createTestEnv();
    // First pass: admin had only CN selected.
    await setActiveWeekdays(env.d1, ["CN"]);
    await ensureMonthExists({ DB: env.d1 }, 2026, 9);

    // Admin then expands to T7 + CN. Next cron firing visits the same month.
    await setActiveWeekdays(env.d1, ["T7", "CN"]);
    await ensureMonthExists({ DB: env.d1 }, 2026, 9);

    const m = await env.db.query.months.findFirst({
      where: and(eq(schema.months.year, 2026), eq(schema.months.month, 9)),
    });
    const sessions = await listSessions(env, m!.id);
    // September 2026: T7 on 05,12,19,26 + CN on 06,13,20,27 → 8 sessions.
    expect(sessions).toHaveLength(8);
  });
});
