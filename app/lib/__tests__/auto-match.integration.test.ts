/**
 * Integration tests for `tryAutoMatch` and `transferSeatToClaimer` (Step 5,
 * sections 4.13–4.14 of plan).
 *
 * Each test ends with `assertInvariants` to catch orphan / drift bugs.
 */
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "~/db/schema";
import { tryAutoMatch } from "~/lib/auto-match.server";
import { transferSeatToClaimer } from "~/lib/seat-transfer.server";
import { assertInvariants } from "./invariants";
import {
  seedCourt,
  seedExtraSlot,
  seedPassRequest,
  seedVote,
  setupScenario,
} from "./fixtures";

/* ============================================================
 * 4.13 tryAutoMatch
 * ============================================================ */

describe("tryAutoMatch", () => {
  it("returns null when no pending vãng lai on the session", async () => {
    const s = await setupScenario();
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    await seedPassRequest(s.env, { voteId: aVote, originalVoteStatus: "thang" });
    expect(await tryAutoMatch(s.env.d1, s.ids.sessionDone)).toBeNull();
  });

  it("returns null when no open pass_request on the session", async () => {
    const s = await setupScenario();
    await seedExtraSlot(s.env, {
      userId: s.ids.userB,
      playSessionId: s.ids.sessionDone,
    });
    expect(await tryAutoMatch(s.env.d1, s.ids.sessionDone)).toBeNull();
  });

  it("returns null after cutoff", async () => {
    const s = await setupScenario();
    await seedCourt(s.env, { playSessionId: s.ids.sessionPast });
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionPast,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    await seedPassRequest(s.env, { voteId: aVote, originalVoteStatus: "thang" });
    await seedExtraSlot(s.env, {
      userId: s.ids.userB,
      playSessionId: s.ids.sessionPast,
    });
    expect(await tryAutoMatch(s.env.d1, s.ids.sessionPast)).toBeNull();
  });

  it("happy match: pass-slot + vãng lai → seat transfer + extra approved (NULL admin) + audit", async () => {
    const s = await setupScenario();
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    const prId = await seedPassRequest(s.env, {
      voteId: aVote,
      originalVoteStatus: "thang",
      createdAt: s.now - 1000,
    });
    const extraId = await seedExtraSlot(s.env, {
      userId: s.ids.userB,
      playSessionId: s.ids.sessionDone,
      createdAt: s.now,
    });

    const result = await tryAutoMatch(s.env.d1, s.ids.sessionDone);
    expect(result).toMatchObject({
      matched: true,
      passRequestId: prId,
      passSlotterUserId: s.ids.userA,
      vangLaiUserId: s.ids.userB,
      playSessionId: s.ids.sessionDone,
    });
    expect(result?.newVoteId).toBeTruthy();

    // Pass-slot claimed (claimedAt set, confirmedAt still NULL — waiting for
    // B to confirm payment).
    const pr = await s.env.db.query.passRequests.findFirst({
      where: eq(schema.passRequests.id, prId),
    });
    expect(pr?.claimedByUserId).toBe(s.ids.userB);
    expect(pr?.claimedAt).not.toBeNull();
    expect(pr?.confirmedAt).toBeNull();

    // A's seat → da_pass.
    const aRow = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, aVote) });
    expect(aRow?.status).toBe("da_pass");

    // B has a new vote thang, originalVoterId = A.
    const bRow = await s.env.db.query.votes.findFirst({
      where: and(
        eq(schema.votes.userId, s.ids.userB),
        eq(schema.votes.playSessionId, s.ids.sessionDone),
      ),
    });
    expect(bRow?.status).toBe("thang");
    expect(bRow?.originalVoterId).toBe(s.ids.userA);

    // B's extra is approved by system (NULL admin).
    const extra = await s.env.db.query.extraSlotRequests.findFirst({
      where: eq(schema.extraSlotRequests.id, extraId),
    });
    expect(extra?.approvedAt).not.toBeNull();
    expect(extra?.approvedByUserId).toBeNull();

    // Audit auto_matched with meta breakdown.
    const auditRow = await s.env.db.query.auditLogs.findFirst({
      where: eq(schema.auditLogs.kind, "auto_matched"),
    });
    expect(auditRow?.actorUserId).toBe(s.ids.userB);
    expect(auditRow?.subjectUserId).toBe(s.ids.userA);
    const meta = JSON.parse(auditRow?.meta ?? "{}") as {
      passRequestId: string;
      toPassSlotter: number;
    };
    expect(meta.passRequestId).toBe(prId);
    expect(meta.toPassSlotter).toBeGreaterThan(0);

    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("skips self-match: only same-user pass-slot exists → null", async () => {
    const s = await setupScenario();
    // A has both a pending vãng lai AND an open pass-slot on the same session
    // (dirty state — current guards prevent this from forming, but we test the
    // auto-match defence-in-depth).
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    await seedPassRequest(s.env, { voteId: aVote, originalVoteStatus: "thang" });
    await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionDone,
    });
    expect(await tryAutoMatch(s.env.d1, s.ids.sessionDone)).toBeNull();
  });

  it("multi-pass: skips self-owned pass, picks next available for the same vãng lai user", async () => {
    const s = await setupScenario();
    // Dirty state: A has pass-slot AND vãng lai. B has pass-slot.
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    await seedPassRequest(s.env, {
      voteId: aVote,
      originalVoteStatus: "thang",
      createdAt: s.now - 2000, // A's pass is OLDER
    });
    const bVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userB,
      status: "cho_pass",
    });
    const bPrId = await seedPassRequest(s.env, {
      voteId: bVote,
      originalVoteStatus: "thang",
      createdAt: s.now - 1000,
    });
    await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionDone,
    });

    const result = await tryAutoMatch(s.env.d1, s.ids.sessionDone);
    expect(result).toMatchObject({
      matched: true,
      passRequestId: bPrId,
      passSlotterUserId: s.ids.userB,
      vangLaiUserId: s.ids.userA,
    });
    // A's own pass-slot is untouched (still open).
    const aPr = await s.env.db.query.passRequests.findFirst({
      where: eq(schema.passRequests.voteId, aVote),
    });
    expect(aPr?.claimedAt).toBeNull();
  });

  it("FIFO vãng lai: oldest pending vãng lai is anchored first", async () => {
    const s = await setupScenario();
    // userC needed since we have 2 vãng lai entries.
    const userC = ulid();
    await s.env.db.insert(schema.users).values({
      id: userC,
      email: "c@x.com",
      name: "C",
      gender: "nam",
      role: "member",
      isActive: true,
      createdAt: s.now,
      updatedAt: s.now,
    });
    // B registered first.
    await seedExtraSlot(s.env, {
      userId: s.ids.userB,
      playSessionId: s.ids.sessionDone,
      createdAt: s.now - 2000,
    });
    await seedExtraSlot(s.env, {
      userId: userC,
      playSessionId: s.ids.sessionDone,
      createdAt: s.now - 1000,
    });
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    await seedPassRequest(s.env, { voteId: aVote, originalVoteStatus: "thang" });

    const result = await tryAutoMatch(s.env.d1, s.ids.sessionDone);
    expect(result?.vangLaiUserId).toBe(s.ids.userB);
  });

  it("computes payment breakdown via current prices (nam ↔ nu cross-gender)", async () => {
    const s = await setupScenario();
    // userA = nam, userB = nu (per setupScenario).
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    await seedPassRequest(s.env, { voteId: aVote, originalVoteStatus: "thang" });
    await seedExtraSlot(s.env, {
      userId: s.ids.userB,
      playSessionId: s.ids.sessionDone,
    });

    const result = await tryAutoMatch(s.env.d1, s.ids.sessionDone);
    // B (nu) pays nu's vang_lai rate to A (nam) → quỹ tops up the difference.
    // Default prices: vang_lai.nam=70k, vang_lai.nu=60k.
    expect(result?.payment.payerTotal).toBe(60000); // B pays nu rate
    expect(result?.payment.payeeTotal).toBe(70000); // A should get nam rate
    expect(result?.payment.toPassSlotter).toBe(60000); // B pays directly to A
    expect(result?.payment.fromQuyShortage).toBe(10000); // quỹ tops up
    expect(result?.payment.toQuyExtra).toBe(0);
  });
});

/* ============================================================
 * 4.14 transferSeatToClaimer
 * ============================================================ */

describe("transferSeatToClaimer", () => {
  it("flips original vote to da_pass and inserts claimer's vote as thang", async () => {
    const s = await setupScenario();
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    const aRow = await s.env.db.query.votes.findFirst({
      where: eq(schema.votes.id, aVote),
    });
    const { newVoteId } = await transferSeatToClaimer(s.env.d1, s.ids.userB, aRow!, s.now);

    const aAfter = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, aVote) });
    expect(aAfter?.status).toBe("da_pass");
    const bRow = await s.env.db.query.votes.findFirst({
      where: eq(schema.votes.id, newVoteId),
    });
    expect(bRow?.status).toBe("thang");
    expect(bRow?.userId).toBe(s.ids.userB);
    expect(bRow?.originalVoterId).toBe(s.ids.userA);
  });

  it("overwrites claimer's existing vote (any status) to thang", async () => {
    const s = await setupScenario();
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    const bExisting = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userB,
      status: "hoan_tien",
    });
    const aRow = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, aVote) });
    const { newVoteId } = await transferSeatToClaimer(s.env.d1, s.ids.userB, aRow!, s.now);

    expect(newVoteId).toBe(bExisting);
    const bRow = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, bExisting) });
    expect(bRow?.status).toBe("thang");
    expect(bRow?.originalVoterId).toBe(s.ids.userA);

    // Only one row for B/session pair.
    const allB = await s.env.db.query.votes.findMany({
      where: and(
        eq(schema.votes.userId, s.ids.userB),
        eq(schema.votes.playSessionId, s.ids.sessionDone),
      ),
    });
    expect(allB).toHaveLength(1);
  });

  it("multi-hop: preserves head originalVoterId when transferring a chained vote", async () => {
    const s = await setupScenario();
    // A→B already happened: A=da_pass, B=cho_pass with originalVoterId=A.
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "da_pass",
    });
    const bVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userB,
      status: "cho_pass",
      originalVoterId: s.ids.userA,
    });
    const userC = ulid();
    await s.env.db.insert(schema.users).values({
      id: userC,
      email: "c@x.com",
      name: "C",
      gender: "nam",
      role: "member",
      isActive: true,
      createdAt: s.now,
      updatedAt: s.now,
    });

    const bRow = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, bVote) });
    const { newVoteId } = await transferSeatToClaimer(s.env.d1, userC, bRow!, s.now);

    const cRow = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, newVoteId) });
    expect(cRow?.status).toBe("thang");
    expect(cRow?.originalVoterId).toBe(s.ids.userA); // root preserved through chain

    const bAfter = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, bVote) });
    expect(bAfter?.status).toBe("da_pass");
    // A untouched (already da_pass).
    const aAfter = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, aVote) });
    expect(aAfter?.status).toBe("da_pass");
  });

  it("idempotent: calling twice with same args doesn't create duplicate votes", async () => {
    const s = await setupScenario();
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    const aRow = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, aVote) });

    const r1 = await transferSeatToClaimer(s.env.d1, s.ids.userB, aRow!, s.now);
    // After first call, A is da_pass. Re-read for the second call so we pass
    // the current state (mirrors confirmPass's behaviour after auto-match).
    const aRow2 = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, aVote) });
    const r2 = await transferSeatToClaimer(s.env.d1, s.ids.userB, aRow2!, s.now + 1);

    expect(r2.newVoteId).toBe(r1.newVoteId);
    const allB = await s.env.db.query.votes.findMany({
      where: and(
        eq(schema.votes.userId, s.ids.userB),
        eq(schema.votes.playSessionId, s.ids.sessionDone),
      ),
    });
    expect(allB).toHaveLength(1);
    expect(allB[0].status).toBe("thang");
  });
});
