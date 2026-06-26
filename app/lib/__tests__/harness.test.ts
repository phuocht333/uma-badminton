import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { createTestEnv } from "./harness";
import * as schema from "~/db/schema";

describe("test harness", () => {
  it("applies all migrations and exposes a working drizzle instance", () => {
    const { sqlite } = createTestEnv();
    // Every table the app touches should exist after migrations.
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    for (const expected of [
      "users",
      "months",
      "play_sessions",
      "court_allocations",
      "votes",
      "pass_requests",
      "extra_slot_requests",
      "audit_logs",
      "config",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("insert + select via drizzle round-trips", async () => {
    const { db } = createTestEnv();
    const now = Date.now();
    const userId = ulid();
    await db.insert(schema.users).values({
      id: userId,
      email: "test@example.com",
      name: "Test User",
      gender: "nam",
      role: "member",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const found = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });
    expect(found?.name).toBe("Test User");
    expect(found?.gender).toBe("nam");
  });

  it("update + returning works (drizzle calls .all on RETURNING)", async () => {
    const { db } = createTestEnv();
    const now = Date.now();
    const id = ulid();
    await db.insert(schema.users).values({
      id,
      email: "u@example.com",
      name: "Old",
      gender: "nu",
      role: "member",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const updated = await db
      .update(schema.users)
      .set({ name: "New" })
      .where(eq(schema.users.id, id))
      .returning({ id: schema.users.id, name: schema.users.name });
    expect(updated).toEqual([{ id, name: "New" }]);
  });

  it("foreign-key cascade fires (votes drop when play_session removed)", async () => {
    const { db, sqlite } = createTestEnv();
    const now = Date.now();
    const monthId = ulid();
    const sessionId = ulid();
    const userId = ulid();
    await db.insert(schema.users).values({
      id: userId,
      email: "fk@example.com",
      name: "FK",
      gender: "nam",
      role: "member",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.months).values({
      id: monthId,
      year: 2026,
      month: 6,
      status: "done",
      voteOpenAt: now,
      voteCloseAt: now,
      createdAt: now,
    });
    await db.insert(schema.playSessions).values({
      id: sessionId,
      monthId,
      date: "2026-06-06",
      weekday: "T7",
    });
    await db.insert(schema.votes).values({
      id: ulid(),
      playSessionId: sessionId,
      userId,
      status: "thang",
      votedAt: now,
    });
    expect(sqlite.prepare("SELECT COUNT(*) as c FROM votes").get()).toEqual({ c: 1 });
    await db.delete(schema.playSessions).where(eq(schema.playSessions.id, sessionId));
    expect(sqlite.prepare("SELECT COUNT(*) as c FROM votes").get()).toEqual({ c: 0 });
  });
});
