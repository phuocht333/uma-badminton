/**
 * Cross-flow end-to-end tests (Step 6, section 4.15 of plan).
 *
 * Each test walks a full member-visible scenario from start to finish,
 * asserting both the final state and that invariants hold throughout (intermediate
 * `assertInvariants` checks where the state could plausibly drift).
 */
import { describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "~/db/schema";
import {
  cancelPass,
  claimAndConfirm,
  confirmPass,
  requestPass,
} from "~/lib/pass-slot.server";
import {
  approveSingleRequest,
  cancelExtraSlotRequest,
  refundPendingPassRequests,
  registerVangLai,
} from "~/lib/extra-slot.server";
import { attributeSeats } from "~/lib/seat-attribution";
import { assertInvariants } from "./invariants";
import {
  seedExtraSlot,
  seedPassRequest,
  seedVote,
  setupScenario,
} from "./fixtures";

describe("end-to-end pass-slot ↔ vãng lai flows", () => {
  it("full lifecycle: A thang → A requestPass → B registerVangLai → auto-match → B confirmPass", async () => {
    const s = await setupScenario();
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "thang",
    });

    // Step 1: A pass-slots (no vãng lai queue yet → just opens pass).
    const r1 = await requestPass(s.env.d1, s.ids.userA, aVote);
    expect(r1).toMatchObject({ ok: true });
    expect((r1 as { autoMatch?: unknown }).autoMatch).toBeUndefined();
    expect(await assertInvariants(s.env.db)).toEqual([]);

    // Step 2: B registers vãng lai → auto-match fires inside registerVangLai.
    const r2 = await registerVangLai(s.env.d1, s.ids.userB, s.ids.sessionDone);
    expect(r2).toMatchObject({ ok: true });
    expect((r2 as { autoMatch?: unknown }).autoMatch).toBeTruthy();
    expect(await assertInvariants(s.env.db)).toEqual([]);

    // State after auto-match: A=da_pass, B=thang(originalVoterId=A),
    // pass_request claimedBy=B (confirmedAt null), B's extra approved (NULL admin).
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
      where: eq(schema.passRequests.voteId, aVote),
    });
    expect(pr?.claimedByUserId).toBe(s.ids.userB);
    expect(pr?.confirmedAt).toBeNull();

    // Step 3: B clicks "Đã thanh toán" — confirmPass stamps confirmedAt.
    const r3 = await confirmPass(s.env.d1, s.ids.userB, pr!.id);
    expect(r3).toEqual({ ok: true });

    const prFinal = await s.env.db.query.passRequests.findFirst({
      where: eq(schema.passRequests.id, pr!.id),
    });
    expect(prFinal?.confirmedAt).not.toBeNull();

    // Audit trail (in chronological order via createdAt):
    const audits = await s.env.db.query.auditLogs.findMany();
    const kinds = audits
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((a) => a.kind);
    expect(kinds).toEqual([
      "pass_requested",
      "vang_lai_requested",
      "auto_matched",
      "pass_confirmed",
    ]);
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("A passes then cancels before any claim → vote restores to original status", async () => {
    const s = await setupScenario();
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "vang_lai",
    });
    await requestPass(s.env.d1, s.ids.userA, aVote);
    expect(await assertInvariants(s.env.db)).toEqual([]);

    const r = await cancelPass(s.env.d1, s.ids.userA, aVote);
    expect(r).toEqual({ ok: true });

    const aRow = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, aVote) });
    expect(aRow?.status).toBe("vang_lai"); // restored from originalVoteStatus
    const pr = await s.env.db.query.passRequests.findFirst({
      where: eq(schema.passRequests.voteId, aVote),
    });
    expect(pr).toBeUndefined();
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("B cancels vãng lai before any pass exists → A can still pass later", async () => {
    const s = await setupScenario();
    // B queued first.
    const r1 = await registerVangLai(s.env.d1, s.ids.userB, s.ids.sessionDone);
    expect(r1).toMatchObject({ ok: true });
    const bExtra = await s.env.db.query.extraSlotRequests.findFirst({
      where: eq(schema.extraSlotRequests.userId, s.ids.userB),
    });

    // B changes mind.
    expect(await cancelExtraSlotRequest(s.env.d1, s.ids.userB, bExtra!.id)).toBe(true);

    // A pass-slots — no queue to absorb it.
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "thang",
    });
    const r2 = await requestPass(s.env.d1, s.ids.userA, aVote);
    expect(r2).toMatchObject({ ok: true });
    expect((r2 as { autoMatch?: unknown }).autoMatch).toBeUndefined();

    const aRow = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, aVote) });
    expect(aRow?.status).toBe("cho_pass");
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("ngày hôm nay's bug: admin approves vãng lai for user with cho_pass vote — no orphan left behind", async () => {
    const s = await setupScenario();
    // Set up the historic dirty-state path: A had thang → requestPass → vote
    // now cho_pass with open pass_request. Then A's vãng lai request comes
    // through (seeded directly to simulate the data shape from before guards).
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

    // Admin approves the vãng lai. The fix: pass_request must be cleaned up.
    expect(await approveSingleRequest(s.env.d1, extraId, s.ids.userAdmin)).toBe(true);

    const aRow = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, aVote) });
    expect(aRow?.status).toBe("vang_lai");
    const pr = await s.env.db.query.passRequests.findFirst({
      where: eq(schema.passRequests.id, prId),
    });
    expect(pr).toBeUndefined(); // cleaned up
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("orphan recovery: legacy data with vote=vang_lai + open pass_request can be cleared via cancelPass", async () => {
    const s = await setupScenario();
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "vang_lai",
    });
    await seedPassRequest(s.env, { voteId: aVote, originalVoteStatus: "thang" });
    // Sanity: invariants flag this as I2 violation pre-fix.
    expect(await assertInvariants(s.env.db)).toHaveLength(1);

    expect(await cancelPass(s.env.d1, s.ids.userA, aVote)).toEqual({ ok: true });

    const aRow = await s.env.db.query.votes.findFirst({ where: eq(schema.votes.id, aVote) });
    expect(aRow?.status).toBe("vang_lai"); // preserved (no restore on orphan)
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("multi-hop A→B→C through real entry points, seat attribution yields just C", async () => {
    const s = await setupScenario();
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

    // A thang → A pass → B claims.
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "thang",
    });
    await requestPass(s.env.d1, s.ids.userA, aVote);
    const aPr = await s.env.db.query.passRequests.findFirst({
      where: eq(schema.passRequests.voteId, aVote),
    });
    expect(await claimAndConfirm(s.env.d1, s.ids.userB, aPr!.id)).toEqual({ ok: true });

    // B now owns a thang vote (with originalVoterId=A). B pass-slots.
    const bVote = await s.env.db.query.votes.findFirst({
      where: and(
        eq(schema.votes.userId, s.ids.userB),
        eq(schema.votes.playSessionId, s.ids.sessionDone),
      ),
    });
    expect(bVote?.status).toBe("thang");
    expect(bVote?.originalVoterId).toBe(s.ids.userA);

    await requestPass(s.env.d1, s.ids.userB, bVote!.id);
    const bPr = await s.env.db.query.passRequests.findFirst({
      where: and(
        eq(schema.passRequests.voteId, bVote!.id),
        isNull(schema.passRequests.claimedAt),
      ),
    });
    // C claims B's pass.
    expect(await claimAndConfirm(s.env.d1, userC, bPr!.id)).toEqual({ ok: true });

    // Final state: A=da_pass, B=da_pass, C=thang(originalVoterId=A).
    const allVotes = await s.env.db.query.votes.findMany({
      where: eq(schema.votes.playSessionId, s.ids.sessionDone),
    });
    const byUser = new Map(allVotes.map((v) => [v.userId, v]));
    expect(byUser.get(s.ids.userA)?.status).toBe("da_pass");
    expect(byUser.get(s.ids.userB)?.status).toBe("da_pass");
    expect(byUser.get(userC)?.status).toBe("thang");
    expect(byUser.get(userC)?.originalVoterId).toBe(s.ids.userA);

    // Seat attribution surfaces only C.
    const seats = attributeSeats(
      allVotes.map((v) => ({
        id: v.id,
        userId: v.userId,
        status: v.status,
        playSessionId: v.playSessionId,
      })),
    );
    expect(seats).toHaveLength(1);
    expect(seats[0].userId).toBe(userC);

    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("court removed: refundPendingPassRequests clears all open pass-slots on the session", async () => {
    const s = await setupScenario();
    // A and B both pass-slotting; nobody to absorb.
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "thang",
    });
    const bVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userB,
      status: "thang",
    });
    await requestPass(s.env.d1, s.ids.userA, aVote);
    await requestPass(s.env.d1, s.ids.userB, bVote);
    expect(await assertInvariants(s.env.db)).toEqual([]);

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
    expect(await assertInvariants(s.env.db)).toEqual([]);
  });

  it("dual-queue prevention: A cho_pass blocks A from also registering vãng lai (defensive)", async () => {
    const s = await setupScenario();
    const aVote = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "thang",
    });
    await requestPass(s.env.d1, s.ids.userA, aVote);

    const r = await registerVangLai(s.env.d1, s.ids.userA, s.ids.sessionDone);
    expect(r).toMatchObject({ error: expect.stringContaining("chờ pass slot") });

    // And the reverse: A's pre-existing vãng lai blocks requestPass.
    const s2 = await setupScenario();
    const a2Vote = await seedVote(s2.env, {
      playSessionId: s2.ids.sessionDone,
      userId: s2.ids.userA,
      status: "thang",
    });
    await seedExtraSlot(s2.env, {
      userId: s2.ids.userA,
      playSessionId: s2.ids.sessionDone,
    });
    const r2 = await requestPass(s2.env.d1, s2.ids.userA, a2Vote);
    expect(r2).toMatchObject({ error: expect.stringContaining("vãng lai") });
  });
});
