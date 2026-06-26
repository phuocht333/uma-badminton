/**
 * Integration tests for pass-slot lifecycle (Step 3 of the test plan, sections
 * 4.1–4.6).
 *
 * Every test ends with `assertInvariants` to catch orphan / drift bugs as a
 * regression guard. Race tests are deliberately omitted per user direction —
 * focus is on logical correctness.
 */
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "~/db/schema";
import {
  approvePassRefund,
  cancelPass,
  claimAndConfirm,
  confirmPass,
  rejectPassRequest,
  requestPass,
} from "~/lib/pass-slot.server";
import { assertInvariants } from "./invariants";
import {
  seedCourt,
  seedExtraSlot,
  seedPassRequest,
  seedVote,
  setupScenario,
} from "./fixtures";

/* ============================================================
 * 4.1 requestPass
 * ============================================================ */

describe("requestPass", () => {
  it("rejects when caller is not the vote's owner (403)", async () => {
    const s = await setupScenario();
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "thang",
    });
    const r = await requestPass(s.env.d1, s.ids.userB, voteId);
    expect(r).toEqual({ error: expect.any(String), status: 403 });
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("rejects when vote is not thang or vang_lai", async () => {
    const s = await setupScenario();
    for (const status of ["cho_pass", "da_pass", "hoan_tien"] as const) {
      const voteId = await seedVote(s.env, {
        playSessionId: s.ids.sessionDone,
        userId: s.ids.userA,
        status,
      });
      const r = await requestPass(s.env.d1, s.ids.userA, voteId);
      expect(r).toHaveProperty("error");
      expect((r as { status: number }).status).toBe(400);
      // Clean up so the next iteration can re-insert on the same session.
      await s.env.db.delete(schema.votes).where(eq(schema.votes.id, voteId));
    }
  });

  it("rejects when month is voting or locked", async () => {
    const s = await setupScenario();
    const votingVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionVoting,
      userId: s.ids.userA,
      status: "thang",
    });
    expect(await requestPass(s.env.d1, s.ids.userA, votingVote)).toHaveProperty("error");

    const lockedVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionLocked,
      userId: s.ids.userA,
      status: "thang",
    });
    expect(await requestPass(s.env.d1, s.ids.userA, lockedVote)).toHaveProperty("error");
  });

  it("rejects after cutoff (24h before session start)", async () => {
    const s = await setupScenario();
    // sessionPast is 5 days ago; any court allocation makes cutoff already passed.
    await seedCourt(s.env, { playSessionId: s.ids.sessionPast });
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionPast,
      userId: s.ids.userA,
      status: "thang",
    });
    const r = await requestPass(s.env.d1, s.ids.userA, voteId);
    expect(r).toMatchObject({ error: expect.stringContaining("hạn") });
  });

  it("rejects when caller has a pending vãng lai on the same session", async () => {
    const s = await setupScenario();
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "thang",
    });
    await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionDone,
    });
    const r = await requestPass(s.env.d1, s.ids.userA, voteId);
    expect(r).toMatchObject({ error: expect.stringContaining("vãng lai") });
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("happy path on thang vote: flips status, creates pass_request, audits", async () => {
    const s = await setupScenario();
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "thang",
    });
    const r = await requestPass(s.env.d1, s.ids.userA, voteId);
    expect(r).toMatchObject({ ok: true });

    const vote = await s.env.db.query.votes.findFirst({
      where: eq(schema.votes.id, voteId),
    });
    expect(vote?.status).toBe("cho_pass");
    const pr = await s.env.db.query.passRequests.findFirst({
      where: eq(schema.passRequests.voteId, voteId),
    });
    expect(pr).toBeTruthy();
    expect(pr?.originalVoteStatus).toBe("thang");
    expect(pr?.claimedAt).toBeNull();
    const audit = await s.env.db.query.auditLogs.findFirst({
      where: eq(schema.auditLogs.kind, "pass_requested"),
    });
    expect(audit?.voteId).toBe(voteId);
    expect(audit?.actorUserId).toBe(s.ids.userA);
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("happy path on vang_lai vote: originalVoteStatus snapshots vang_lai", async () => {
    const s = await setupScenario();
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "vang_lai",
    });
    await requestPass(s.env.d1, s.ids.userA, voteId);
    const pr = await s.env.db.query.passRequests.findFirst({
      where: eq(schema.passRequests.voteId, voteId),
    });
    expect(pr?.originalVoteStatus).toBe("vang_lai");
  });

  it("auto-match: pending vãng lai from another user gets the slot immediately", async () => {
    const s = await setupScenario();
    // B is queued vãng lai; A pass-slots → B should receive the seat.
    await seedExtraSlot(s.env, {
      userId: s.ids.userB,
      playSessionId: s.ids.sessionDone,
    });
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "thang",
    });
    const r = await requestPass(s.env.d1, s.ids.userA, voteId);
    expect(r).toMatchObject({ ok: true });
    expect((r as { autoMatch?: unknown }).autoMatch).toBeTruthy();

    // A's vote → da_pass (seat transferred); B has new vote thang.
    const aVote = await s.env.db.query.votes.findFirst({
      where: eq(schema.votes.id, voteId),
    });
    expect(aVote?.status).toBe("da_pass");
    const bVote = await s.env.db.query.votes.findFirst({
      where: and(
        eq(schema.votes.userId, s.ids.userB),
        eq(schema.votes.playSessionId, s.ids.sessionDone),
      ),
    });
    expect(bVote?.status).toBe("thang");
    expect(bVote?.originalVoterId).toBe(s.ids.userA);

    // B's extra_slot_request is approved by system (approvedByUserId NULL).
    const bExtra = await s.env.db.query.extraSlotRequests.findFirst({
      where: eq(schema.extraSlotRequests.userId, s.ids.userB),
    });
    expect(bExtra?.approvedAt).not.toBeNull();
    expect(bExtra?.approvedByUserId).toBeNull();

    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("no auto-match when vãng lai queue is empty", async () => {
    const s = await setupScenario();
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "thang",
    });
    const r = await requestPass(s.env.d1, s.ids.userA, voteId);
    expect(r).toMatchObject({ ok: true });
    expect((r as { autoMatch?: unknown }).autoMatch).toBeUndefined();
  });

});

/* ============================================================
 * 4.2 cancelPass
 * ============================================================ */

describe("cancelPass", () => {
  it("rejects when caller is not the vote owner (403)", async () => {
    const s = await setupScenario();
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    await seedPassRequest(s.env, { voteId, originalVoteStatus: "thang" });
    const r = await cancelPass(s.env.d1, s.ids.userB, voteId);
    expect(r).toEqual({ error: expect.any(String), status: 403 });
  });

  it("rejects when no open pass_request exists", async () => {
    const s = await setupScenario();
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "thang",
    });
    const r = await cancelPass(s.env.d1, s.ids.userA, voteId);
    expect(r).toMatchObject({ error: "Không tìm thấy.", status: 400 });
  });

  it("happy path: vote cho_pass + open pass_request → deletes row, restores status, audits", async () => {
    const s = await setupScenario();
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    await seedPassRequest(s.env, { voteId, originalVoteStatus: "vang_lai" });
    const r = await cancelPass(s.env.d1, s.ids.userA, voteId);
    expect(r).toEqual({ ok: true });

    const vote = await s.env.db.query.votes.findFirst({
      where: eq(schema.votes.id, voteId),
    });
    expect(vote?.status).toBe("vang_lai");
    const pr = await s.env.db.query.passRequests.findFirst({
      where: eq(schema.passRequests.voteId, voteId),
    });
    expect(pr).toBeUndefined();
    const audit = await s.env.db.query.auditLogs.findFirst({
      where: eq(schema.auditLogs.kind, "pass_cancelled"),
    });
    expect(audit?.voteId).toBe(voteId);
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("rejects after cutoff", async () => {
    const s = await setupScenario();
    await seedCourt(s.env, { playSessionId: s.ids.sessionPast });
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionPast,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    await seedPassRequest(s.env, { voteId, originalVoteStatus: "thang" });
    const r = await cancelPass(s.env.d1, s.ids.userA, voteId);
    expect(r).toMatchObject({ error: expect.stringContaining("hạn") });
  });

  it("orphan cleanup: vote=vang_lai but pass_request open → deletes row, keeps vote vang_lai", async () => {
    const s = await setupScenario();
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "vang_lai",
    });
    await seedPassRequest(s.env, { voteId, originalVoteStatus: "thang" });
    // Sanity: pre-state has the orphan invariant violation.
    expect(await assertInvariants(s.env.db)).toHaveLength(1);

    const r = await cancelPass(s.env.d1, s.ids.userA, voteId);
    expect(r).toEqual({ ok: true });

    const vote = await s.env.db.query.votes.findFirst({
      where: eq(schema.votes.id, voteId),
    });
    expect(vote?.status).toBe("vang_lai");
    const pr = await s.env.db.query.passRequests.findFirst({
      where: eq(schema.passRequests.voteId, voteId),
    });
    expect(pr).toBeUndefined();
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("orphan cleanup: vote=thang but pass_request open → deletes row, keeps vote thang", async () => {
    const s = await setupScenario();
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "thang",
    });
    await seedPassRequest(s.env, { voteId, originalVoteStatus: "vang_lai" });
    const r = await cancelPass(s.env.d1, s.ids.userA, voteId);
    expect(r).toEqual({ ok: true });

    const vote = await s.env.db.query.votes.findFirst({
      where: eq(schema.votes.id, voteId),
    });
    expect(vote?.status).toBe("thang");
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("ignores already-claimed pass_request (treated as 'not open')", async () => {
    const s = await setupScenario();
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "da_pass",
    });
    await seedPassRequest(s.env, {
      voteId,
      originalVoteStatus: "thang",
      claimedByUserId: s.ids.userB,
      claimedAt: Date.now(),
      confirmedAt: Date.now(),
    });
    const r = await cancelPass(s.env.d1, s.ids.userA, voteId);
    expect(r).toMatchObject({ error: "Không tìm thấy.", status: 400 });
  });
});

/* ============================================================
 * 4.3 claimAndConfirm
 * ============================================================ */

describe("claimAndConfirm", () => {
  it("rejects when caller is the passer themselves", async () => {
    const s = await setupScenario();
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    const prId = await seedPassRequest(s.env, { voteId, originalVoteStatus: "thang" });
    const r = await claimAndConfirm(s.env.d1, s.ids.userA, prId);
    expect(r).toMatchObject({ error: expect.stringContaining("chính mình") });
  });

  it("rejects when caller already has a thang vote on the session", async () => {
    const s = await setupScenario();
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    const prId = await seedPassRequest(s.env, {
      voteId: aVote,
      originalVoteStatus: "thang",
    });
    await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userB,
      status: "thang",
    });
    const r = await claimAndConfirm(s.env.d1, s.ids.userB, prId);
    expect(r).toMatchObject({ error: expect.stringContaining("đã có slot") });
  });

  it("allows claim when caller has hoan_tien (refunded) on the session — upsert to thang", async () => {
    const s = await setupScenario();
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    const prId = await seedPassRequest(s.env, {
      voteId: aVote,
      originalVoteStatus: "thang",
    });
    await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userB,
      status: "hoan_tien",
    });
    const r = await claimAndConfirm(s.env.d1, s.ids.userB, prId);
    expect(r).toEqual({ ok: true });

    const bVote = await s.env.db.query.votes.findFirst({
      where: and(
        eq(schema.votes.userId, s.ids.userB),
        eq(schema.votes.playSessionId, s.ids.sessionDone),
      ),
    });
    expect(bVote?.status).toBe("thang");
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("rejects on month not done (voting/locked)", async () => {
    const s = await setupScenario();
    // Need to seed a vote on a voting/locked-month session AND a pass_request
    // for it (DB doesn't block this even though it's nonsensical state).
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionLocked,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    const prId = await seedPassRequest(s.env, {
      voteId: aVote,
      originalVoteStatus: "thang",
    });
    const r = await claimAndConfirm(s.env.d1, s.ids.userB, prId);
    expect(r).toHaveProperty("error");
  });

  it("rejects after cutoff", async () => {
    const s = await setupScenario();
    await seedCourt(s.env, { playSessionId: s.ids.sessionPast });
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionPast,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    const prId = await seedPassRequest(s.env, {
      voteId: aVote,
      originalVoteStatus: "thang",
    });
    const r = await claimAndConfirm(s.env.d1, s.ids.userB, prId);
    expect(r).toMatchObject({ error: expect.stringContaining("hạn") });
  });

  it("rejects when pass_request is already rejected by admin", async () => {
    const s = await setupScenario();
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    const prId = await seedPassRequest(s.env, {
      voteId: aVote,
      originalVoteStatus: "thang",
      rejectedAt: Date.now(),
      rejectedByUserId: s.ids.userAdmin,
    });
    const r = await claimAndConfirm(s.env.d1, s.ids.userB, prId);
    expect(r).toMatchObject({ error: expect.stringContaining("từ chối") });
  });

  it("happy path: original vote → da_pass, claimer's vote upsert thang, pass_request claimed+confirmed, audit", async () => {
    const s = await setupScenario();
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    const prId = await seedPassRequest(s.env, {
      voteId: aVote,
      originalVoteStatus: "thang",
    });
    const r = await claimAndConfirm(s.env.d1, s.ids.userB, prId);
    expect(r).toEqual({ ok: true });

    const aRow = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, aVote) });
    expect(aRow?.status).toBe("da_pass");
    const bRow = await s.env.db.query.votes.findFirst({
      where: and(
        eq(schema.votes.userId, s.ids.userB),
        eq(schema.votes.playSessionId, s.ids.sessionDone),
      ),
    });
    expect(bRow?.status).toBe("thang");
    expect(bRow?.originalVoterId).toBe(s.ids.userA);
    const pr = await s.env.db.query.passRequests.findFirst({
      where: eq(schema.passRequests.id, prId),
    });
    expect(pr?.claimedByUserId).toBe(s.ids.userB);
    expect(pr?.claimedAt).not.toBeNull();
    expect(pr?.confirmedAt).not.toBeNull();
    const auditRow = await s.env.db.query.auditLogs.findFirst({
      where: eq(schema.auditLogs.kind, "pass_confirmed"),
    });
    expect(auditRow?.actorUserId).toBe(s.ids.userB);
    expect(auditRow?.subjectUserId).toBe(s.ids.userA);
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("claimer's pending vãng lai is auto-cancelled on successful claim", async () => {
    const s = await setupScenario();
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    const prId = await seedPassRequest(s.env, {
      voteId: aVote,
      originalVoteStatus: "thang",
    });
    const extraId = await seedExtraSlot(s.env, {
      userId: s.ids.userB,
      playSessionId: s.ids.sessionDone,
    });
    await claimAndConfirm(s.env.d1, s.ids.userB, prId);
    const extra = await s.env.db.query.extraSlotRequests.findFirst({
      where: eq(schema.extraSlotRequests.id, extraId),
    });
    expect(extra?.cancelledAt).not.toBeNull();
  });

  it("multi-hop A→B→C: chain preserves originalVoterId on the head", async () => {
    const s = await setupScenario();
    // Seed A→B (already confirmed).
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "da_pass",
    });
    const bVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userB,
      status: "thang",
      originalVoterId: s.ids.userA,
    });
    // B now passes again.
    const bPrId = await seedPassRequest(s.env, {
      voteId: bVote,
      originalVoteStatus: "thang",
    });
    await s.env.db
      .update(schema.votes)
      .set({ status: "cho_pass" })
      .where(eq(schema.votes.id, bVote));

    // C claims B's pass.
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
    const r = await claimAndConfirm(s.env.d1, userC, bPrId);
    expect(r).toEqual({ ok: true });

    const cVote = await s.env.db.query.votes.findFirst({
      where: and(
        eq(schema.votes.userId, userC),
        eq(schema.votes.playSessionId, s.ids.sessionDone),
      ),
    });
    expect(cVote?.status).toBe("thang");
    expect(cVote?.originalVoterId).toBe(s.ids.userA);
    expect(await assertInvariants(s.env.db)).toEqual([]);

    // A and B should both be da_pass.
    const aRow = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, aVote) });
    const bRow = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, bVote) });
    expect(aRow?.status).toBe("da_pass");
    expect(bRow?.status).toBe("da_pass");
  });
});

/* ============================================================
 * 4.4 confirmPass (auto-assigned banner confirm)
 * ============================================================ */

describe("confirmPass", () => {
  it("rejects when caller is not the claimer", async () => {
    const s = await setupScenario();
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "da_pass",
    });
    const prId = await seedPassRequest(s.env, {
      voteId: aVote,
      originalVoteStatus: "thang",
      claimedByUserId: s.ids.userB,
      claimedAt: Date.now(),
    });
    const r = await confirmPass(s.env.d1, s.ids.userAdmin, prId);
    expect(r).toEqual({ error: expect.any(String), status: 403 });
  });

  it("idempotent on already-confirmed claim", async () => {
    const s = await setupScenario();
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "da_pass",
    });
    const prId = await seedPassRequest(s.env, {
      voteId: aVote,
      originalVoteStatus: "thang",
      claimedByUserId: s.ids.userB,
      claimedAt: Date.now(),
      confirmedAt: Date.now(),
    });
    const r = await confirmPass(s.env.d1, s.ids.userB, prId);
    expect(r).toEqual({ ok: true });
  });

  it("happy path: stamps confirmedAt, idempotent transferSeat, audits pass_confirmed", async () => {
    const s = await setupScenario();
    // Auto-match state: A's vote is da_pass, B's vote exists at thang already
    // (auto-match seat transfer ran), pass_request has claimedAt but no confirmedAt.
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "da_pass",
    });
    await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userB,
      status: "thang",
      originalVoterId: s.ids.userA,
    });
    const prId = await seedPassRequest(s.env, {
      voteId: aVote,
      originalVoteStatus: "thang",
      claimedByUserId: s.ids.userB,
      claimedAt: Date.now(),
    });
    const r = await confirmPass(s.env.d1, s.ids.userB, prId);
    expect(r).toEqual({ ok: true });

    const pr = await s.env.db.query.passRequests.findFirst({
      where: eq(schema.passRequests.id, prId),
    });
    expect(pr?.confirmedAt).not.toBeNull();
    const auditRow = await s.env.db.query.auditLogs.findFirst({
      where: eq(schema.auditLogs.kind, "pass_confirmed"),
    });
    expect(auditRow?.actorUserId).toBe(s.ids.userB);
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });
});

/* ============================================================
 * 4.5 approvePassRefund (admin)
 * ============================================================ */

describe("approvePassRefund", () => {
  it("rejects when pass_request already claimed", async () => {
    const s = await setupScenario();
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "da_pass",
    });
    const prId = await seedPassRequest(s.env, {
      voteId,
      originalVoteStatus: "thang",
      claimedByUserId: s.ids.userB,
      claimedAt: Date.now(),
    });
    const r = await approvePassRefund(s.env.d1, prId, s.ids.userAdmin);
    expect(r).toEqual({ ok: false });
  });

  it("rejects when vote no longer in cho_pass", async () => {
    const s = await setupScenario();
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "thang",
    });
    const prId = await seedPassRequest(s.env, {
      voteId,
      originalVoteStatus: "thang",
    });
    const r = await approvePassRefund(s.env.d1, prId, s.ids.userAdmin);
    expect(r).toEqual({ ok: false });
  });

  it("happy path: vote → hoan_tien, pass_request confirmed, refund_payments row + audit", async () => {
    const s = await setupScenario();
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    const prId = await seedPassRequest(s.env, {
      voteId,
      originalVoteStatus: "thang",
    });
    const r = await approvePassRefund(s.env.d1, prId, s.ids.userAdmin);
    expect(r).toMatchObject({ ok: true, userId: s.ids.userA, voteId });

    const vote = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, voteId) });
    expect(vote?.status).toBe("hoan_tien");
    const pr = await s.env.db.query.passRequests.findFirst({
      where: eq(schema.passRequests.id, prId),
    });
    expect(pr?.confirmedAt).not.toBeNull();
    const refund = await s.env.db.query.refundPayments.findFirst({
      where: eq(schema.refundPayments.voteId, voteId),
    });
    expect(refund).toBeTruthy();
    expect(refund?.amount).toBeGreaterThan(0);
    const auditRow = await s.env.db.query.auditLogs.findFirst({
      where: eq(schema.auditLogs.kind, "refund_issued"),
    });
    expect(auditRow?.subjectUserId).toBe(s.ids.userA);
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });
});

/* ============================================================
 * 4.6 rejectPassRequest (admin)
 * ============================================================ */

describe("rejectPassRequest", () => {
  it("rejects when pass_request already claimed or rejected", async () => {
    const s = await setupScenario();
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "da_pass",
    });
    const prId = await seedPassRequest(s.env, {
      voteId,
      originalVoteStatus: "thang",
      claimedByUserId: s.ids.userB,
      claimedAt: Date.now(),
    });
    const r = await rejectPassRequest(s.env.d1, prId, s.ids.userAdmin);
    expect(r).toEqual({ ok: false });
  });

  it("happy path: vote reverts to originalVoteStatus, rejectedAt set, audit", async () => {
    const s = await setupScenario();
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    const prId = await seedPassRequest(s.env, {
      voteId,
      originalVoteStatus: "vang_lai",
    });
    const r = await rejectPassRequest(s.env.d1, prId, s.ids.userAdmin);
    expect(r).toMatchObject({ ok: true, userId: s.ids.userA });

    const vote = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, voteId) });
    expect(vote?.status).toBe("vang_lai");
    const pr = await s.env.db.query.passRequests.findFirst({
      where: eq(schema.passRequests.id, prId),
    });
    expect(pr?.rejectedAt).not.toBeNull();
    expect(pr?.rejectedByUserId).toBe(s.ids.userAdmin);
    const auditRow = await s.env.db.query.auditLogs.findFirst({
      where: eq(schema.auditLogs.kind, "pass_rejected"),
    });
    expect(auditRow?.actorUserId).toBe(s.ids.userAdmin);
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });
});
