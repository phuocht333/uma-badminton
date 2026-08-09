/**
 * Home-card session view: head count and the past-session lock.
 *
 * `playerCount` drives the admin "đủ giờ sân chưa?" check in the duyệt-vãng-lai
 * dialog, so it must equal the number of members actually holding a seat —
 * `thang` / `vang_lai` / `cho_pass`, deduped per member. A completed pass
 * leaves two vote rows for one seat (`da_pass` on the passer, `thang` on the
 * claimer); counting rows instead of seats used to double it.
 *
 * `isLocked` marks a session that already happened. Today's session must stay
 * unlocked (B35) so people can still pass / nhận / duyệt on the day itself.
 */
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { buildHomeMonthSummary } from "~/lib/home-summary.server";
import { claimAndConfirm, requestPass } from "~/lib/pass-slot.server";
import { ulid } from "ulid";
import { seedCourt, seedVote, setupScenario, type Scenario } from "./fixtures";

/** VN-local (UTC+7) date string, same rule as home-summary's `todayVNDateString`. */
function todayVN(): string {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

/** Build the home summary for `monthDone` as seen by `userId`. */
async function homeSessionView(s: Scenario, userId: string) {
  const monthRow = await s.env.db.query.months.findFirst({
    where: eq(schema.months.id, s.ids.monthDone),
  });
  const users = await s.env.db.query.users.findMany();
  const memberById = new Map(users.map((u) => [u.id, u] as const));
  const summary = await buildHomeMonthSummary(s.env.d1, monthRow!, memberById, userId);
  return summary.sessions.find((x) => x.id === s.ids.sessionDone);
}

describe("SessionView.playerCount", () => {
  it("counts one body per seat after a completed pass (A → B)", async () => {
    const s = await setupScenario();
    // Closed months only show sessions that have courts.
    await seedCourt(s.env, { playSessionId: s.ids.sessionDone });
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "thang",
    });
    expect(await requestPass(s.env.d1, s.ids.userA, voteId)).toMatchObject({ ok: true });
    const pr = await s.env.db.query.passRequests.findFirst({
      where: eq(schema.passRequests.voteId, voteId),
    });
    expect(await claimAndConfirm(s.env.d1, s.ids.userB, pr!.id)).toMatchObject({ ok: true });

    // Two vote rows now exist (A: da_pass, B: thang) but only one seat.
    const view = await homeSessionView(s, s.ids.userA);
    expect(view?.playerCount).toBe(1);
    expect(view?.players.map((p) => p.name)).toEqual(["B"]);
  });

  it("counts an unclaimed cho_pass seat — the passer is still on the bill", async () => {
    const s = await setupScenario();
    await seedCourt(s.env, { playSessionId: s.ids.sessionDone });
    const voteId = await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userA,
      status: "thang",
    });
    await requestPass(s.env.d1, s.ids.userA, voteId);

    const view = await homeSessionView(s, s.ids.userA);
    expect(view?.playerCount).toBe(1);
    expect(view?.players).toMatchObject([{ name: "A", status: "cho_pass" }]);
  });

  it("counts thang + vang_lai seats once each", async () => {
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
      status: "vang_lai",
    });
    await seedVote(s.env, {
      playSessionId: s.ids.sessionDone,
      userId: s.ids.userAdmin,
      status: "hoan_tien",
    });

    const view = await homeSessionView(s, s.ids.userA);
    // hoan_tien is not a seat.
    expect(view?.playerCount).toBe(2);
  });
});

/* ============================================================
 * Today's session stays actionable (B35)
 * ============================================================ */

describe("SessionView.isLocked", () => {
  /** Insert a session dated `date` into the done month, with a court. */
  async function seedSessionOn(s: Scenario, date: string): Promise<string> {
    const id = ulid();
    await s.env.db.insert(schema.playSessions).values({
      id,
      monthId: s.ids.monthDone,
      date,
      weekday: "T7",
    });
    await seedCourt(s.env, { playSessionId: id });
    return id;
  }

  async function viewFor(s: Scenario, sessionId: string) {
    const monthRow = await s.env.db.query.months.findFirst({
      where: eq(schema.months.id, s.ids.monthDone),
    });
    const users = await s.env.db.query.users.findMany();
    const memberById = new Map(users.map((u) => [u.id, u] as const));
    const summary = await buildHomeMonthSummary(
      s.env.d1,
      monthRow!,
      memberById,
      s.ids.userA,
    );
    return summary.sessions.find((x) => x.id === sessionId);
  }

  it("session dated today is visible and NOT locked — actions stay live", async () => {
    const s = await setupScenario();
    const todaySession = await seedSessionOn(s, todayVN());
    const view = await viewFor(s, todaySession);
    expect(view).toBeDefined();
    expect(view?.isLocked).toBe(false);
  });

  it("future session is not locked either", async () => {
    const s = await setupScenario();
    await seedCourt(s.env, { playSessionId: s.ids.sessionDone });
    const view = await viewFor(s, s.ids.sessionDone);
    expect(view?.isLocked).toBe(false);
  });

  it("yesterday's session is filtered out of the home cards entirely", async () => {
    const s = await setupScenario();
    const y = new Date(Date.now() + 7 * 60 * 60 * 1000 - 86_400_000);
    const yesterday = `${y.getUTCFullYear()}-${String(y.getUTCMonth() + 1).padStart(2, "0")}-${String(y.getUTCDate()).padStart(2, "0")}`;
    const pastSession = await seedSessionOn(s, yesterday);
    expect(await viewFor(s, pastSession)).toBeUndefined();
  });
});
