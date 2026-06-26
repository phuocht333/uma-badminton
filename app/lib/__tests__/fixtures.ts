/**
 * Shared seed helpers for integration tests. Bare minimum needed to exercise
 * pass-slot / vãng lai flows: 3 users, 4 months in different statuses, 4
 * sessions (3 future + 1 past).
 *
 * Date handling: real `Date.now()` for `now`, session dates computed relative
 * to it. Cutoff-24h: `sessionPast` is far enough in the past that any court
 * allocation on it puts the cutoff behind us; `sessionDone` is far enough in
 * the future that cutoff hasn't arrived yet. No `Date.now()` mocking — tests
 * exercise the real `isAfterCutoff` implementation.
 */
import { ulid } from "ulid";
import * as schema from "~/db/schema";
import type { TestEnv } from "./harness";
import { createTestEnv } from "./harness";

export interface Scenario {
  env: TestEnv;
  now: number;
  futureDate: string;
  pastDate: string;
  ids: {
    monthVoting: string;
    monthLocked: string;
    monthDone: string;
    monthDonePast: string;
    sessionVoting: string;
    sessionLocked: string;
    sessionDone: string;
    sessionPast: string;
    userA: string;
    userB: string;
    userAdmin: string;
  };
}

function dateInDays(now: number, days: number): string {
  const ms = now + days * 24 * 3600 * 1000;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Build a baseline scenario.
 *
 * Sessions and their cutoff-test affordances:
 *   - `sessionVoting` (in `monthVoting`)  — month status "voting", no courts
 *   - `sessionLocked` (in `monthLocked`)  — month status "locked", no courts
 *   - `sessionDone`   (in `monthDone`)    — month "done", far future, no courts
 *                                           seedCourt to enable cutoff math
 *   - `sessionPast`   (in `monthDonePast`)— month "done", far past, no courts
 *                                           seedCourt → isAfterCutoff returns true
 */
export async function setupScenario(): Promise<Scenario> {
  const env = createTestEnv();
  const now = Date.now();
  const futureDate = dateInDays(now, 30);
  const pastDate = dateInDays(now, -5);
  const ids = {
    monthVoting: ulid(),
    monthLocked: ulid(),
    monthDone: ulid(),
    monthDonePast: ulid(),
    sessionVoting: ulid(),
    sessionLocked: ulid(),
    sessionDone: ulid(),
    sessionPast: ulid(),
    userA: ulid(),
    userB: ulid(),
    userAdmin: ulid(),
  };

  await env.db.insert(schema.users).values([
    {
      id: ids.userA,
      email: "a@x.com",
      name: "A",
      gender: "nam",
      role: "member",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: ids.userB,
      email: "b@x.com",
      name: "B",
      gender: "nu",
      role: "member",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: ids.userAdmin,
      email: "admin@x.com",
      name: "Admin",
      gender: "nam",
      role: "admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await env.db.insert(schema.months).values([
    {
      id: ids.monthVoting,
      year: 2099,
      month: 1,
      status: "voting",
      voteOpenAt: now,
      voteCloseAt: now + 1000,
      createdAt: now,
    },
    {
      id: ids.monthLocked,
      year: 2099,
      month: 2,
      status: "locked",
      voteOpenAt: now,
      voteCloseAt: now + 1000,
      createdAt: now,
    },
    {
      id: ids.monthDone,
      year: 2099,
      month: 3,
      status: "done",
      voteOpenAt: now,
      voteCloseAt: now + 1000,
      createdAt: now,
    },
    {
      id: ids.monthDonePast,
      year: 2000,
      month: 1,
      status: "done",
      voteOpenAt: now,
      voteCloseAt: now + 1000,
      createdAt: now,
    },
  ]);

  await env.db.insert(schema.playSessions).values([
    {
      id: ids.sessionVoting,
      monthId: ids.monthVoting,
      date: dateInDays(now, 60),
      weekday: "T7",
    },
    {
      id: ids.sessionLocked,
      monthId: ids.monthLocked,
      date: dateInDays(now, 45),
      weekday: "T7",
    },
    {
      id: ids.sessionDone,
      monthId: ids.monthDone,
      date: futureDate,
      weekday: "T7",
    },
    {
      id: ids.sessionPast,
      monthId: ids.monthDonePast,
      date: pastDate,
      weekday: "T7",
    },
  ]);

  return { env, now, futureDate, pastDate, ids };
}

/* ---------------- Single-row helpers ---------------- */

export interface SeedVoteArgs {
  id?: string;
  playSessionId: string;
  userId: string;
  status: schema.Vote["status"];
  votedAt?: number;
  originalVoterId?: string;
}

export async function seedVote(env: TestEnv, args: SeedVoteArgs): Promise<string> {
  const id = args.id ?? ulid();
  await env.db.insert(schema.votes).values({
    id,
    playSessionId: args.playSessionId,
    userId: args.userId,
    status: args.status,
    votedAt: args.votedAt ?? Date.now(),
    originalVoterId: args.originalVoterId,
  });
  return id;
}

export interface SeedPassRequestArgs {
  id?: string;
  voteId: string;
  createdAt?: number;
  originalVoteStatus: "thang" | "vang_lai";
  claimedByUserId?: string;
  claimedAt?: number;
  confirmedAt?: number;
  rejectedAt?: number;
  rejectedByUserId?: string;
}

export async function seedPassRequest(
  env: TestEnv,
  args: SeedPassRequestArgs,
): Promise<string> {
  const id = args.id ?? ulid();
  await env.db.insert(schema.passRequests).values({
    id,
    voteId: args.voteId,
    createdAt: args.createdAt ?? Date.now(),
    originalVoteStatus: args.originalVoteStatus,
    claimedByUserId: args.claimedByUserId,
    claimedAt: args.claimedAt,
    confirmedAt: args.confirmedAt,
    rejectedAt: args.rejectedAt,
    rejectedByUserId: args.rejectedByUserId,
  });
  return id;
}

export interface SeedExtraSlotArgs {
  id?: string;
  userId: string;
  playSessionId: string;
  createdAt?: number;
  approvedAt?: number;
  approvedByUserId?: string;
  cancelledAt?: number;
  rejectedAt?: number;
  rejectedByUserId?: string;
}

export async function seedExtraSlot(
  env: TestEnv,
  args: SeedExtraSlotArgs,
): Promise<string> {
  const id = args.id ?? ulid();
  await env.db.insert(schema.extraSlotRequests).values({
    id,
    userId: args.userId,
    playSessionId: args.playSessionId,
    createdAt: args.createdAt ?? Date.now(),
    approvedAt: args.approvedAt,
    approvedByUserId: args.approvedByUserId,
    cancelledAt: args.cancelledAt,
    rejectedAt: args.rejectedAt,
    rejectedByUserId: args.rejectedByUserId,
  });
  return id;
}

export interface SeedCourtArgs {
  playSessionId: string;
  courtCode?: string;
  startTime?: string;
  endTime?: string;
}

export async function seedCourt(env: TestEnv, args: SeedCourtArgs): Promise<void> {
  await env.db.insert(schema.courtAllocations).values({
    id: ulid(),
    playSessionId: args.playSessionId,
    courtCode: args.courtCode ?? "C1",
    startTime: args.startTime ?? "08:00",
    endTime: args.endTime ?? "10:00",
    displayOrder: 0,
  });
}
