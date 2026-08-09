/**
 * Integration tests for extra_slot (vãng lai) lifecycle (Step 4, sections
 * 4.7–4.12).
 *
 * Every successful happy-path test ends with `assertInvariants` to catch
 * orphan / drift bugs.
 */
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "~/db/schema";
import {
  approvePendingForSession,
  approveSingleRequest,
  cancelExtraSlotRequest,
  refundPendingPassRequests,
  registerVangLai,
  rejectSingleExtraSlotRequest,
} from "~/lib/extra-slot.server";
import { assertInvariants } from "./invariants";
import {
  seedCourt,
  seedExtraSlot,
  seedPassRequest,
  seedVote,
  setupScenario,
} from "./fixtures";

/* ============================================================
 * 4.7 registerVangLai
 * ============================================================ */

describe("registerVangLai", () => {
  it("rejects when session not found", async () => {
    const s = await setupScenario();
    const r = await registerVangLai(s.env.d1, s.ids.userA, "no-such-session");
    expect(r).toMatchObject({ error: expect.stringContaining("Buổi") });
  });

  it("rejects when month is voting", async () => {
    const s = await setupScenario();
    const r = await registerVangLai(s.env.d1, s.ids.userA, s.ids.sessionVoting);
    expect(r).toMatchObject({ error: expect.stringContaining("Đã đặt sân") });
  });

  it("rejects when month is locked", async () => {
    const s = await setupScenario();
    const r = await registerVangLai(s.env.d1, s.ids.userA, s.ids.sessionLocked);
    expect(r).toMatchObject({ error: expect.stringContaining("Đã đặt sân") });
  });

  it("still allowed after cutoff — vãng lai is not cutoff-gated", async () => {
    const s = await setupScenario();
    await seedCourt(s.env, { playSessionId: s.ids.sessionPast });
    expect(await registerVangLai(s.env.d1, s.ids.userA, s.ids.sessionPast)).toMatchObject({
      ok: true,
    });
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("rejects when user already has thang vote on the session", async () => {
    const s = await setupScenario();
    await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "thang",
    });
    const r = await registerVangLai(s.env.d1, s.ids.userA, s.ids.sessionDone);
    expect(r).toMatchObject({ error: expect.stringContaining("đã có slot") });
  });

  it("rejects when user already has vang_lai vote on the session", async () => {
    const s = await setupScenario();
    await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "vang_lai",
    });
    const r = await registerVangLai(s.env.d1, s.ids.userA, s.ids.sessionDone);
    expect(r).toMatchObject({ error: expect.stringContaining("đã có slot") });
  });

  it("rejects when user has cho_pass vote (new guard — no self-match)", async () => {
    const s = await setupScenario();
    await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    const r = await registerVangLai(s.env.d1, s.ids.userA, s.ids.sessionDone);
    expect(r).toMatchObject({ error: expect.stringContaining("chờ pass slot") });
  });

  it("allows when user has da_pass vote (passed their seat off — can re-enter)", async () => {
    const s = await setupScenario();
    await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "da_pass",
    });
    const r = await registerVangLai(s.env.d1, s.ids.userA, s.ids.sessionDone);
    expect(r).toMatchObject({ ok: true });
  });

  it("allows when user has hoan_tien vote (refunded earlier)", async () => {
    const s = await setupScenario();
    await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "hoan_tien",
    });
    const r = await registerVangLai(s.env.d1, s.ids.userA, s.ids.sessionDone);
    expect(r).toMatchObject({ ok: true });
  });

  it("rejects when a pending extra_slot already exists", async () => {
    const s = await setupScenario();
    await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionDone,
    });
    const r = await registerVangLai(s.env.d1, s.ids.userA, s.ids.sessionDone);
    expect(r).toMatchObject({ error: expect.stringContaining("đã gửi") });
  });

  it("rejects when an approved extra_slot exists for this user+session", async () => {
    const s = await setupScenario();
    await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionDone,
      approvedAt: Date.now() - 1000,
      approvedByUserId: s.ids.userAdmin,
    });
    const r = await registerVangLai(s.env.d1, s.ids.userA, s.ids.sessionDone);
    expect(r).toMatchObject({ error: expect.stringContaining("đã được duyệt") });
  });

  it("resets a previously cancelled row (reuse, not duplicate insert)", async () => {
    const s = await setupScenario();
    const extraId = await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionDone,
      createdAt: Date.now() - 1000_000,
      cancelledAt: Date.now() - 500_000,
    });
    const r = await registerVangLai(s.env.d1, s.ids.userA, s.ids.sessionDone);
    expect(r).toMatchObject({ ok: true });

    const all = await s.env.db.query.extraSlotRequests.findMany({
      where: and(
        eq(schema.extraSlotRequests.userId, s.ids.userA),
        eq(schema.extraSlotRequests.playSessionId, s.ids.sessionDone),
      ),
    });
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(extraId);
    expect(all[0].cancelledAt).toBeNull();
    expect(all[0].rejectedAt).toBeNull();
  });

  it("resets a previously admin-rejected row", async () => {
    const s = await setupScenario();
    const extraId = await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionDone,
      createdAt: Date.now() - 1000_000,
      rejectedAt: Date.now() - 500_000,
      rejectedByUserId: s.ids.userAdmin,
    });
    const r = await registerVangLai(s.env.d1, s.ids.userA, s.ids.sessionDone);
    expect(r).toMatchObject({ ok: true });

    const row = await s.env.db.query.extraSlotRequests.findFirst({
      where: eq(schema.extraSlotRequests.id, extraId),
    });
    expect(row?.rejectedAt).toBeNull();
    expect(row?.rejectedByUserId).toBeNull();
  });

  it("happy first-time: inserts row, audits, returns no autoMatch (empty queue)", async () => {
    const s = await setupScenario();
    const r = await registerVangLai(s.env.d1, s.ids.userA, s.ids.sessionDone);
    expect(r).toMatchObject({ ok: true });
    expect((r as { autoMatch?: unknown }).autoMatch).toBeUndefined();

    const row = await s.env.db.query.extraSlotRequests.findFirst({
      where: and(
        eq(schema.extraSlotRequests.userId, s.ids.userA),
        eq(schema.extraSlotRequests.playSessionId, s.ids.sessionDone),
      ),
    });
    expect(row).toBeTruthy();
    const auditRow = await s.env.db.query.auditLogs.findFirst({
      where: eq(schema.auditLogs.kind, "vang_lai_requested"),
    });
    expect(auditRow?.actorUserId).toBe(s.ids.userA);
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("triggers auto-match when an open pass-slot exists on the session", async () => {
    const s = await setupScenario();
    // B has open pass-slot; A registers vãng lai → A claims B's slot.
    const bVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userB,
      status: "cho_pass",
    });
    await seedPassRequest(s.env, {
      voteId: bVote,
      originalVoteStatus: "thang",
      createdAt: Date.now() - 1000,
    });
    const r = await registerVangLai(s.env.d1, s.ids.userA, s.ids.sessionDone);
    expect(r).toMatchObject({ ok: true });
    expect((r as { autoMatch?: unknown }).autoMatch).toBeTruthy();

    const bRow = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, bVote) });
    expect(bRow?.status).toBe("da_pass");
    const aVote = await s.env.db.query.votes.findFirst({
      where: and(
        eq(schema.votes.userId, s.ids.userA),
        eq(schema.votes.playSessionId, s.ids.sessionDone),
      ),
    });
    expect(aVote?.status).toBe("thang");
    expect(aVote?.originalVoterId).toBe(s.ids.userB);
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("auto-match skip: only self-owned pass-slot exists → no match", async () => {
    const s = await setupScenario();
    // A has a pre-existing pass-slot from before (impossible via normal flow
    // post-guards, but we seed dirty state to verify the skip).
    const aOldVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    await seedPassRequest(s.env, {
      voteId: aOldVote,
      originalVoteStatus: "thang",
    });
    // registerVangLai will reject because A has cho_pass — verify guard.
    const r = await registerVangLai(s.env.d1, s.ids.userA, s.ids.sessionDone);
    expect(r).toMatchObject({ error: expect.stringContaining("chờ pass slot") });
  });
});

/* ============================================================
 * 4.8 cancelExtraSlotRequest
 * ============================================================ */

describe("cancelExtraSlotRequest", () => {
  it("returns false when caller is not the owner", async () => {
    const s = await setupScenario();
    const extraId = await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionDone,
    });
    expect(await cancelExtraSlotRequest(s.env.d1, s.ids.userB, extraId)).toBe(false);
  });

  it("returns false when already approved", async () => {
    const s = await setupScenario();
    const extraId = await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionDone,
      approvedAt: Date.now(),
      approvedByUserId: s.ids.userAdmin,
    });
    expect(await cancelExtraSlotRequest(s.env.d1, s.ids.userA, extraId)).toBe(false);
  });

  it("returns false when already cancelled or rejected", async () => {
    const s = await setupScenario();
    const extraCancelled = await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionDone,
      cancelledAt: Date.now(),
    });
    expect(await cancelExtraSlotRequest(s.env.d1, s.ids.userA, extraCancelled)).toBe(false);

    const extraRejected = await seedExtraSlot(s.env, {
      userId: s.ids.userB,
      playSessionId: s.ids.sessionDone,
      rejectedAt: Date.now(),
      rejectedByUserId: s.ids.userAdmin,
    });
    expect(await cancelExtraSlotRequest(s.env.d1, s.ids.userB, extraRejected)).toBe(false);
  });

  it("still allowed after cutoff — member keeps control of their own request", async () => {
    const s = await setupScenario();
    await seedCourt(s.env, { playSessionId: s.ids.sessionPast });
    const extraId = await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionPast,
    });
    expect(await cancelExtraSlotRequest(s.env.d1, s.ids.userA, extraId)).toBe(true);
    const row = await s.env.db.query.extraSlotRequests.findFirst({
      where: eq(schema.extraSlotRequests.id, extraId),
    });
    expect(row?.cancelledAt).toBeTruthy();
  });

  it("happy path: stamps cancelledAt + audits", async () => {
    const s = await setupScenario();
    const extraId = await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionDone,
    });
    expect(await cancelExtraSlotRequest(s.env.d1, s.ids.userA, extraId)).toBe(true);

    const row = await s.env.db.query.extraSlotRequests.findFirst({
      where: eq(schema.extraSlotRequests.id, extraId),
    });
    expect(row?.cancelledAt).not.toBeNull();
    const auditRow = await s.env.db.query.auditLogs.findFirst({
      where: eq(schema.auditLogs.kind, "vang_lai_cancelled"),
    });
    expect(auditRow?.actorUserId).toBe(s.ids.userA);
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });
});

/* ============================================================
 * 4.9 approveSingleRequest
 * ============================================================ */

describe("approveSingleRequest", () => {
  it("returns false when request not found", async () => {
    const s = await setupScenario();
    expect(await approveSingleRequest(s.env.d1, "no-such-id", s.ids.userAdmin)).toBe(false);
  });

  it("returns false when already approved", async () => {
    const s = await setupScenario();
    const extraId = await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionDone,
      approvedAt: Date.now(),
      approvedByUserId: s.ids.userAdmin,
    });
    expect(await approveSingleRequest(s.env.d1, extraId, s.ids.userAdmin)).toBe(false);
  });

  it("returns false when already cancelled", async () => {
    const s = await setupScenario();
    const extraId = await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionDone,
      cancelledAt: Date.now(),
    });
    expect(await approveSingleRequest(s.env.d1, extraId, s.ids.userAdmin)).toBe(false);
  });

  it("happy path: user has no vote → inserts vang_lai vote, sets approvedAt, audits", async () => {
    const s = await setupScenario();
    const extraId = await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionDone,
    });
    expect(await approveSingleRequest(s.env.d1, extraId, s.ids.userAdmin)).toBe(true);

    const row = await s.env.db.query.extraSlotRequests.findFirst({
      where: eq(schema.extraSlotRequests.id, extraId),
    });
    expect(row?.approvedAt).not.toBeNull();
    expect(row?.approvedByUserId).toBe(s.ids.userAdmin);
    const vote = await s.env.db.query.votes.findFirst({
      where: and(
        eq(schema.votes.userId, s.ids.userA),
        eq(schema.votes.playSessionId, s.ids.sessionDone),
      ),
    });
    expect(vote?.status).toBe("vang_lai");
    const auditRow = await s.env.db.query.auditLogs.findFirst({
      where: eq(schema.auditLogs.kind, "vang_lai_approved"),
    });
    expect(auditRow?.subjectUserId).toBe(s.ids.userA);
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("user has hoan_tien vote → overwrite to vang_lai (no new row)", async () => {
    const s = await setupScenario();
    const oldVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "hoan_tien",
    });
    const extraId = await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionDone,
    });
    expect(await approveSingleRequest(s.env.d1, extraId, s.ids.userAdmin)).toBe(true);

    const vote = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, oldVote) });
    expect(vote?.status).toBe("vang_lai");
    // Only one vote row for the user/session pair.
    const allVotes = await s.env.db.query.votes.findMany({
      where: and(
        eq(schema.votes.userId, s.ids.userA),
        eq(schema.votes.playSessionId, s.ids.sessionDone),
      ),
    });
    expect(allVotes).toHaveLength(1);
  });

  it("CRITICAL regression: user has cho_pass vote + open pass_request → deletes pass_request, sets vote to vang_lai (no orphan)", async () => {
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
      userId: s.ids.userA,
      playSessionId: s.ids.sessionDone,
    });
    expect(await approveSingleRequest(s.env.d1, extraId, s.ids.userAdmin)).toBe(true);

    const vote = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, aVote) });
    expect(vote?.status).toBe("vang_lai");
    const pr = await s.env.db.query.passRequests.findFirst({
      where: eq(schema.passRequests.id, prId),
    });
    expect(pr).toBeUndefined();
    // No orphan = clean invariants.
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });
});

/* ============================================================
 * 4.10 approvePendingForSession
 * ============================================================ */

describe("approvePendingForSession", () => {
  it("returns 0 when no pending requests", async () => {
    const s = await setupScenario();
    const n = await approvePendingForSession(
      s.env.d1,
      s.ids.sessionDone,
      s.ids.userAdmin,
    );
    expect(n).toBe(0);
  });

  it("approves all pending requests in FIFO order", async () => {
    const s = await setupScenario();
    // Earlier-created request first.
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
    await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionDone,
      createdAt: s.now - 2000,
    });
    await seedExtraSlot(s.env, {
      userId: s.ids.userB,
      playSessionId: s.ids.sessionDone,
      createdAt: s.now - 1000,
    });
    await seedExtraSlot(s.env, {
      userId: userC,
      playSessionId: s.ids.sessionDone,
      createdAt: s.now,
    });

    const n = await approvePendingForSession(
      s.env.d1,
      s.ids.sessionDone,
      s.ids.userAdmin,
    );
    expect(n).toBe(3);

    // All three users now have vang_lai votes.
    for (const uid of [s.ids.userA, s.ids.userB, userC]) {
      const v = await s.env.db.query.votes.findFirst({
        where: and(
          eq(schema.votes.userId, uid),
          eq(schema.votes.playSessionId, s.ids.sessionDone),
        ),
      });
      expect(v?.status).toBe("vang_lai");
    }
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("skips already-approved or cancelled rows; approves only the remaining pending", async () => {
    const s = await setupScenario();
    await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionDone,
      approvedAt: s.now - 1000,
      approvedByUserId: s.ids.userAdmin,
    });
    // A already has a vang_lai vote from earlier approval.
    await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "vang_lai",
    });
    await seedExtraSlot(s.env, {
      userId: s.ids.userB,
      playSessionId: s.ids.sessionDone,
      cancelledAt: s.now - 1000,
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
    await seedExtraSlot(s.env, {
      userId: userC,
      playSessionId: s.ids.sessionDone,
      createdAt: s.now,
    });

    const n = await approvePendingForSession(
      s.env.d1,
      s.ids.sessionDone,
      s.ids.userAdmin,
    );
    expect(n).toBe(1);

    const cVote = await s.env.db.query.votes.findFirst({
      where: and(
        eq(schema.votes.userId, userC),
        eq(schema.votes.playSessionId, s.ids.sessionDone),
      ),
    });
    expect(cVote?.status).toBe("vang_lai");
  });
});

/* ============================================================
 * 4.11 rejectSingleExtraSlotRequest
 * ============================================================ */

describe("rejectSingleExtraSlotRequest", () => {
  it("returns ok: false when request not found or already terminal", async () => {
    const s = await setupScenario();
    expect(await rejectSingleExtraSlotRequest(s.env.d1, "no-id", s.ids.userAdmin))
      .toEqual({ ok: false });

    const approved = await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionDone,
      approvedAt: Date.now(),
      approvedByUserId: s.ids.userAdmin,
    });
    expect(await rejectSingleExtraSlotRequest(s.env.d1, approved, s.ids.userAdmin))
      .toEqual({ ok: false });
  });

  it("happy path: sets rejectedAt + rejectedByUserId, audits, returns user info", async () => {
    const s = await setupScenario();
    const extraId = await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionDone,
    });
    const r = await rejectSingleExtraSlotRequest(s.env.d1, extraId, s.ids.userAdmin);
    expect(r).toMatchObject({
      ok: true,
      userId: s.ids.userA,
      playSessionId: s.ids.sessionDone,
    });

    const row = await s.env.db.query.extraSlotRequests.findFirst({
      where: eq(schema.extraSlotRequests.id, extraId),
    });
    expect(row?.rejectedAt).not.toBeNull();
    expect(row?.rejectedByUserId).toBe(s.ids.userAdmin);
    const auditRow = await s.env.db.query.auditLogs.findFirst({
      where: eq(schema.auditLogs.kind, "vang_lai_rejected"),
    });
    expect(auditRow?.actorUserId).toBe(s.ids.userAdmin);
    expect(auditRow?.subjectUserId).toBe(s.ids.userA);
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });
});

/* ============================================================
 * 4.12 refundPendingPassRequests (court removed)
 * ============================================================ */

describe("refundPendingPassRequests", () => {
  it("returns 0 when no open pass_requests exist", async () => {
    const s = await setupScenario();
    const n = await refundPendingPassRequests(
      s.env.d1,
      s.ids.sessionDone,
      s.ids.userAdmin,
    );
    expect(n).toBe(0);
  });

  it("returns 0 when pass_requests are on a different session", async () => {
    const s = await setupScenario();
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    await seedPassRequest(s.env, { voteId: aVote, originalVoteStatus: "thang" });

    // Refund called for a different session.
    const n = await refundPendingPassRequests(
      s.env.d1,
      s.ids.sessionPast,
      s.ids.userAdmin,
    );
    expect(n).toBe(0);

    // A's vote is untouched.
    const aRow = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, aVote) });
    expect(aRow?.status).toBe("cho_pass");
  });

  it("happy path: refunds all cho_pass votes for the session, audits with reason court_removed", async () => {
    const s = await setupScenario();
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "cho_pass",
    });
    const bVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userB,
      status: "cho_pass",
    });
    await seedPassRequest(s.env, {
      voteId: aVote,
      originalVoteStatus: "thang",
      createdAt: s.now - 2000,
    });
    await seedPassRequest(s.env, {
      voteId: bVote,
      originalVoteStatus: "vang_lai",
      createdAt: s.now - 1000,
    });

    const n = await refundPendingPassRequests(
      s.env.d1,
      s.ids.sessionDone,
      s.ids.userAdmin,
    );
    expect(n).toBe(2);

    const aRow = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, aVote) });
    const bRow = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, bVote) });
    expect(aRow?.status).toBe("hoan_tien");
    expect(bRow?.status).toBe("hoan_tien");

    // Two audit entries with reason court_removed.
    const audits = await s.env.db.query.auditLogs.findMany({
      where: eq(schema.auditLogs.kind, "refund_issued"),
    });
    expect(audits).toHaveLength(2);
    for (const a of audits) {
      const meta = JSON.parse(a.meta ?? "{}") as { reason?: string };
      expect(meta.reason).toBe("court_removed");
    }
  });

  it("ignores already-claimed pass_requests (doesn't refund the claimer)", async () => {
    const s = await setupScenario();
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "da_pass",
    });
    await seedPassRequest(s.env, {
      voteId: aVote,
      originalVoteStatus: "thang",
      claimedByUserId: s.ids.userB,
      claimedAt: s.now,
      confirmedAt: s.now,
    });
    const n = await refundPendingPassRequests(
      s.env.d1,
      s.ids.sessionDone,
      s.ids.userAdmin,
    );
    expect(n).toBe(0);
  });
});

/* ============================================================
 * Pending vãng lai on a session that already happened (B34)
 *
 * Nothing expires it: the request stays pending, creates no vote (so no
 * bill), and both the member and the admin can still act on it.
 * ============================================================ */

describe("pending vãng lai never expires (B34)", () => {
  it("stays pending with no vote created after the session passed", async () => {
    const s = await setupScenario();
    await seedCourt(s.env, { playSessionId: s.ids.sessionPast });
    expect(await registerVangLai(s.env.d1, s.ids.userA, s.ids.sessionPast)).toMatchObject({
      ok: true,
    });

    const row = await s.env.db.query.extraSlotRequests.findFirst({
      where: eq(schema.extraSlotRequests.userId, s.ids.userA),
    });
    expect(row?.approvedAt).toBeNull();
    expect(row?.rejectedAt).toBeNull();
    expect(row?.cancelledAt).toBeNull();
    // No vote → nothing on the bill until an admin duyệt.
    const vote = await s.env.db.query.votes.findFirst({
      where: and(
        eq(schema.votes.userId, s.ids.userA),
        eq(schema.votes.playSessionId, s.ids.sessionPast),
      ),
    });
    expect(vote).toBeUndefined();
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("admin can still duyệt it after the session passed → vang_lai vote", async () => {
    const s = await setupScenario();
    await seedCourt(s.env, { playSessionId: s.ids.sessionPast });
    const extraId = await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionPast,
    });
    expect(await approveSingleRequest(s.env.d1, extraId, s.ids.userAdmin)).toBeTruthy();
    const vote = await s.env.db.query.votes.findFirst({
      where: and(
        eq(schema.votes.userId, s.ids.userA),
        eq(schema.votes.playSessionId, s.ids.sessionPast),
      ),
    });
    expect(vote?.status).toBe("vang_lai");
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("admin can still từ chối it after the session passed → no vote", async () => {
    const s = await setupScenario();
    await seedCourt(s.env, { playSessionId: s.ids.sessionPast });
    const extraId = await seedExtraSlot(s.env, {
      userId: s.ids.userA,
      playSessionId: s.ids.sessionPast,
    });
    expect(
      await rejectSingleExtraSlotRequest(s.env.d1, extraId, s.ids.userAdmin),
    ).toBeTruthy();
    const row = await s.env.db.query.extraSlotRequests.findFirst({
      where: eq(schema.extraSlotRequests.id, extraId),
    });
    expect(row?.rejectedAt).toBeTruthy();
    expect(row?.rejectedByUserId).toBe(s.ids.userAdmin);
    const vote = await s.env.db.query.votes.findFirst({
      where: and(
        eq(schema.votes.userId, s.ids.userA),
        eq(schema.votes.playSessionId, s.ids.sessionPast),
      ),
    });
    expect(vote).toBeUndefined();
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });
});
