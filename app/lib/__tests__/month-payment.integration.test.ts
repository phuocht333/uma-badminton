/**
 * Integration tests for monthly payment tracking (`markMonthPaid`,
 * `loadPaidUserIds`). Independent of pass-slot / vãng lai state — payment
 * marker just flips a flag per (user, month) pair.
 */
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import {
  loadPaidUserIds,
  loadPendingMonthPayments,
  markMonthPaid,
} from "~/lib/month-payment.server";
import { assertInvariants } from "./invariants";
import { seedCourt, seedVote, setupScenario } from "./fixtures";

describe("markMonthPaid", () => {
  it("rejects when month not found", async () => {
    const s = await setupScenario();
    const r = await markMonthPaid(s.env.d1, s.ids.userA, "no-such-month");
    expect(r).toMatchObject({ error: expect.stringContaining("Không tìm thấy") });
  });

  it("rejects when month status is voting", async () => {
    const s = await setupScenario();
    const r = await markMonthPaid(s.env.d1, s.ids.userA, s.ids.monthVoting);
    expect(r).toMatchObject({ error: expect.stringContaining("Đã đặt sân") });
  });

  it("rejects when month status is locked", async () => {
    const s = await setupScenario();
    const r = await markMonthPaid(s.env.d1, s.ids.userA, s.ids.monthLocked);
    expect(r).toMatchObject({ error: expect.stringContaining("Đã đặt sân") });
  });

  it("happy path: inserts row + writes payment_marked audit", async () => {
    const s = await setupScenario();
    const r = await markMonthPaid(s.env.d1, s.ids.userA, s.ids.monthDone);
    expect(r).toEqual({ ok: true });

    const row = await s.env.db.query.memberMonthPayments.findFirst({
      where: and(
        eq(schema.memberMonthPayments.userId, s.ids.userA),
        eq(schema.memberMonthPayments.monthId, s.ids.monthDone),
      ),
    });
    expect(row).toBeTruthy();
    expect(row?.paidAt).toBeGreaterThan(0);

    const auditRow = await s.env.db.query.auditLogs.findFirst({
      where: eq(schema.auditLogs.kind, "payment_marked"),
    });
    expect(auditRow?.actorUserId).toBe(s.ids.userA);
    expect(auditRow?.subjectUserId).toBe(s.ids.userA);
    const meta = JSON.parse(auditRow?.meta ?? "{}") as { monthId?: string };
    expect(meta.monthId).toBe(s.ids.monthDone);

    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("idempotent: re-marking returns ok with alreadyPaid flag and no duplicate row", async () => {
    const s = await setupScenario();
    await markMonthPaid(s.env.d1, s.ids.userA, s.ids.monthDone);
    const r2 = await markMonthPaid(s.env.d1, s.ids.userA, s.ids.monthDone);
    expect(r2).toEqual({ ok: true, alreadyPaid: true });

    const all = await s.env.db.query.memberMonthPayments.findMany({
      where: and(
        eq(schema.memberMonthPayments.userId, s.ids.userA),
        eq(schema.memberMonthPayments.monthId, s.ids.monthDone),
      ),
    });
    expect(all).toHaveLength(1);
  });

  it("different users on same month: independent rows", async () => {
    const s = await setupScenario();
    expect(await markMonthPaid(s.env.d1, s.ids.userA, s.ids.monthDone)).toEqual({ ok: true });
    expect(await markMonthPaid(s.env.d1, s.ids.userB, s.ids.monthDone)).toEqual({ ok: true });

    const all = await s.env.db.query.memberMonthPayments.findMany({
      where: eq(schema.memberMonthPayments.monthId, s.ids.monthDone),
    });
    expect(all).toHaveLength(2);
  });
});

describe("loadPaidUserIds", () => {
  it("returns empty set when nothing paid", async () => {
    const s = await setupScenario();
    const ids = await loadPaidUserIds(s.env.d1, s.ids.monthDone);
    expect(ids.size).toBe(0);
  });

  it("returns only user IDs paid on the requested month", async () => {
    const s = await setupScenario();
    await markMonthPaid(s.env.d1, s.ids.userA, s.ids.monthDone);
    await markMonthPaid(s.env.d1, s.ids.userB, s.ids.monthDone);
    // userA also paid a *different* done month (monthDonePast).
    await markMonthPaid(s.env.d1, s.ids.userA, s.ids.monthDonePast);

    const ids = await loadPaidUserIds(s.env.d1, s.ids.monthDone);
    expect(ids.size).toBe(2);
    expect(ids.has(s.ids.userA)).toBe(true);
    expect(ids.has(s.ids.userB)).toBe(true);

    const idsPast = await loadPaidUserIds(s.env.d1, s.ids.monthDonePast);
    expect(idsPast.size).toBe(1);
    expect(idsPast.has(s.ids.userA)).toBe(true);
  });
});

describe("loadPendingMonthPayments", () => {
  it("returns empty when user has no votes on any done month", async () => {
    const s = await setupScenario();
    const pending = await loadPendingMonthPayments(s.env.d1, s.ids.userA);
    expect(pending).toEqual([]);
  });

  it("ignores non-done months even if user voted there", async () => {
    const s = await setupScenario();
    // Vote on a voting-status month → no debt yet.
    await seedVote(s.env, {
      playSessionId: s.ids.sessionVoting,
      userId: s.ids.userA,
      status: "thang",
    });
    const pending = await loadPendingMonthPayments(s.env.d1, s.ids.userA);
    expect(pending).toEqual([]);
  });

  it("returns done months with unpaid debt, computing totalFee from votes", async () => {
    const s = await setupScenario();
    // Done months without court allocations are treated as empty by the
    // bill computation — seed a court so the vote actually counts.
    await seedCourt(s.env, { playSessionId: s.ids.sessionDone });
    await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "thang",
    });
    const pending = await loadPendingMonthPayments(s.env.d1, s.ids.userA);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      monthId: s.ids.monthDone,
      year: 2099,
      month: 3,
    });
    expect(pending[0].totalFee).toBeGreaterThan(0);
  });

  it("excludes months the user has already self-marked paid", async () => {
    const s = await setupScenario();
    await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "thang",
    });
    await markMonthPaid(s.env.d1, s.ids.userA, s.ids.monthDone);
    const pending = await loadPendingMonthPayments(s.env.d1, s.ids.userA);
    expect(pending).toEqual([]);
  });

  it("multiple done months: returns oldest first", async () => {
    const s = await setupScenario();
    // monthDone (year=2099, month=3) and monthDonePast (year=2000) both done.
    await seedCourt(s.env, { playSessionId: s.ids.sessionDone });
    await seedCourt(s.env, { playSessionId: s.ids.sessionPast });
    await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "thang",
    });
    await seedVote(s.env, {
      playSessionId: s.ids.sessionPast,
      userId: s.ids.userA,
      status: "thang",
    });
    const pending = await loadPendingMonthPayments(s.env.d1, s.ids.userA);
    expect(pending.map((m) => m.monthId)).toEqual([
      s.ids.monthDonePast, // older first
      s.ids.monthDone,
    ]);
  });

  it("isolates per user — paying one user doesn't affect another", async () => {
    const s = await setupScenario();
    await seedCourt(s.env, { playSessionId: s.ids.sessionDone });
    await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "thang",
    });
    await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userB,
      status: "thang",
    });
    await markMonthPaid(s.env.d1, s.ids.userA, s.ids.monthDone);
    expect(await loadPendingMonthPayments(s.env.d1, s.ids.userA)).toEqual([]);
    expect(await loadPendingMonthPayments(s.env.d1, s.ids.userB)).toHaveLength(1);
  });
});
