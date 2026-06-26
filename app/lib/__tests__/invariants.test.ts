import { describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { createTestEnv } from "./harness";
import { assertInvariants } from "./invariants";
import * as schema from "~/db/schema";

/**
 * Helper: seed the minimal set of rows needed to write a vote / pass_request /
 * extra_slot_request. Returns ids for follow-up assertions.
 */
function baseFixture(env: ReturnType<typeof createTestEnv>) {
  const { db } = env;
  const now = Date.now();
  const userA = ulid();
  const userB = ulid();
  const monthId = ulid();
  const sessionId = ulid();
  return {
    now,
    userA,
    userB,
    monthId,
    sessionId,
    async seed() {
      await db.insert(schema.users).values([
        {
          id: userA,
          email: "a@x.com",
          name: "A",
          gender: "nam",
          role: "member",
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: userB,
          email: "b@x.com",
          name: "B",
          gender: "nu",
          role: "member",
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      ]);
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
    },
  };
}

describe("assertInvariants", () => {
  it("clean fixture: no violations", async () => {
    const env = createTestEnv();
    const fx = baseFixture(env);
    await fx.seed();
    const violations = await assertInvariants(env.db);
    expect(violations).toEqual([]);
  });

  it("clean valid state with pass_request: cho_pass vote + open pass_request → no violation", async () => {
    const env = createTestEnv();
    const fx = baseFixture(env);
    await fx.seed();
    const voteId = ulid();
    await env.db.insert(schema.votes).values({
      id: voteId,
      playSessionId: fx.sessionId,
      userId: fx.userA,
      status: "cho_pass",
      votedAt: fx.now,
    });
    await env.db.insert(schema.passRequests).values({
      id: ulid(),
      voteId,
      createdAt: fx.now,
      originalVoteStatus: "thang",
    });
    expect(await assertInvariants(env.db)).toEqual([]);
  });

  it("I2 catches orphan: open pass_request on vote with vang_lai status", async () => {
    const env = createTestEnv();
    const fx = baseFixture(env);
    await fx.seed();
    const voteId = ulid();
    // Inject the exact "bug ngày hôm nay" state: vote=vang_lai but
    // pass_request still open.
    await env.db.insert(schema.votes).values({
      id: voteId,
      playSessionId: fx.sessionId,
      userId: fx.userA,
      status: "vang_lai",
      votedAt: fx.now,
    });
    await env.db.insert(schema.passRequests).values({
      id: "pr-orphan",
      voteId,
      createdAt: fx.now,
      originalVoteStatus: "thang",
    });
    const v = await assertInvariants(env.db);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/I2 orphan pass_request/);
    expect(v[0]).toContain("vang_lai");
  });

  it("I3 catches claim drift: claimed pass_request but vote still cho_pass", async () => {
    const env = createTestEnv();
    const fx = baseFixture(env);
    await fx.seed();
    const voteId = ulid();
    await env.db.insert(schema.votes).values({
      id: voteId,
      playSessionId: fx.sessionId,
      userId: fx.userA,
      status: "cho_pass",
      votedAt: fx.now,
    });
    await env.db.insert(schema.passRequests).values({
      id: "pr-claim",
      voteId,
      createdAt: fx.now,
      originalVoteStatus: "thang",
      claimedByUserId: fx.userB,
      claimedAt: fx.now + 1,
    });
    const v = await assertInvariants(env.db);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/I3 claim drift/);
  });

  it("I4 catches approved vãng lai with no vote row", async () => {
    const env = createTestEnv();
    const fx = baseFixture(env);
    await fx.seed();
    await env.db.insert(schema.extraSlotRequests).values({
      id: "esr-noVote",
      userId: fx.userA,
      playSessionId: fx.sessionId,
      createdAt: fx.now,
      approvedAt: fx.now + 1,
      approvedByUserId: fx.userB,
    });
    const v = await assertInvariants(env.db);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/I4 approved vãng lai missing vote/);
  });

  it("multi-hop A→B→C: both A and B in da_pass, C in thang → no violation", async () => {
    const env = createTestEnv();
    const fx = baseFixture(env);
    await fx.seed();
    const userC = ulid();
    await env.db.insert(schema.users).values({
      id: userC,
      email: "c@x.com",
      name: "C",
      gender: "nam",
      role: "member",
      isActive: true,
      createdAt: fx.now,
      updatedAt: fx.now,
    });
    await env.db.insert(schema.votes).values([
      {
        id: "vA",
        playSessionId: fx.sessionId,
        userId: fx.userA,
        status: "da_pass",
        votedAt: fx.now,
      },
      {
        id: "vB",
        playSessionId: fx.sessionId,
        userId: fx.userB,
        status: "da_pass",
        votedAt: fx.now,
        originalVoterId: fx.userA,
      },
      {
        id: "vC",
        playSessionId: fx.sessionId,
        userId: userC,
        status: "thang",
        votedAt: fx.now,
        originalVoterId: fx.userA,
      },
    ]);
    // Both pass_requests are claimed + confirmed (final state).
    await env.db.insert(schema.passRequests).values([
      {
        id: "prA",
        voteId: "vA",
        createdAt: fx.now,
        originalVoteStatus: "thang",
        claimedByUserId: fx.userB,
        claimedAt: fx.now + 1,
        confirmedAt: fx.now + 2,
      },
      {
        id: "prB",
        voteId: "vB",
        createdAt: fx.now + 3,
        originalVoteStatus: "thang",
        claimedByUserId: userC,
        claimedAt: fx.now + 4,
        confirmedAt: fx.now + 5,
      },
    ]);
    expect(await assertInvariants(env.db)).toEqual([]);
  });
});
