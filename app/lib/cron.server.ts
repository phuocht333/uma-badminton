import type { Env } from "~/../worker";
import { audit, cleanupOldLogs } from "./audit.server";
import { getDb, schema } from "~/db/client";
import { vnDayOfMonth } from "./dates";
import { eq, and } from "drizzle-orm";
import { sendAdminCutoffDigestEmail } from "./email.server";
import { findSessionsCrossingCutoff } from "./session-cutoff.server";
import {
  closeDueVotingMonths,
  ensureUpcomingVotingMonths,
} from "./vote.server";

/**
 * Cron triggers (in wrangler.toml) — daily:
 *   - "0 2 * * *"   (02:00 UTC = 09:00 VN)  → ensure upcoming voting months
 *   - "59 16 * * *" (16:59 UTC = 23:59 VN)  → close any voting months that are due
 *
 * Vote is ALWAYS open for upcoming months (rolling 2-month lookahead). The
 * close cron checks each `voting` month's `voteCloseAt` and locks only the
 * ones whose deadline has passed. Configurable close-day in /admin/config
 * still drives `voteCloseAt` for newly-created months.
 */
export async function handleScheduled(event: ScheduledEvent, env: Env): Promise<void> {
  const now = new Date(event.scheduledTime);
  const vnDay = vnDayOfMonth(now);
  const isMorning = event.cron === "0 2 * * *";
  const isLateNight = event.cron === "59 16 * * *";

  console.log(`[cron] fired cron=${event.cron} utc=${now.toISOString()} vnDay=${vnDay}`);

  if (isMorning) {
    const result = await ensureUpcomingVotingMonths(env, now);
    console.log(`[cron] open: ensured ${result.length} months in voting state`);
    // NOTE: there is no automatic locked → done transition. "Đã đặt sân"
    // is reached only by an admin clicking "Chốt đã đặt sân" on /lich.
    try {
      await sweepCutoffsForAdminDigest(env, now.getTime());
    } catch (e) {
      console.error("[cron] cutoff sweep failed", e);
    }
  } else if (isLateNight) {
    await closeDueVotingMonths(env, now);
    try {
      await cleanupOldLogs(env.DB);
    } catch (e) {
      console.error("[cron] log cleanup failed", e);
    }
  } else {
    console.warn(`[cron] unknown cron expression: ${event.cron}`);
  }
}

/**
 * Sweep sessions whose cutoff fell in the previous 24h. For each session that
 * still has pending pass-slot or vãng lai entries, log `cutoff_locked` (once)
 * and email all admins. Audit log dedupes — re-running this is a no-op.
 *
 * Cutoff itself is enforced lazily at registration time (see session-cutoff
 * helpers), so even if this sweep is delayed, no new entries can sneak in.
 */
export async function sweepCutoffsForAdminDigest(env: Env, now: number): Promise<void> {
  const db = getDb(env.DB);
  const fromMs = now - 24 * 60 * 60 * 1000;
  const sessions = await findSessionsCrossingCutoff(env.DB, fromMs, now);
  if (sessions.length === 0) {
    console.log("[cron] cutoff sweep: no sessions crossing cutoff in the last 24h");
    return;
  }

  const sessionsNeedingDigest: typeof sessions = [];
  for (const s of sessions) {
    const already = await db.query.auditLogs.findFirst({
      where: and(
        eq(schema.auditLogs.kind, "cutoff_locked"),
        eq(schema.auditLogs.playSessionId, s.sessionId),
      ),
    });
    if (already) continue;
    await audit(env.DB, {
      kind: "cutoff_locked",
      playSessionId: s.sessionId,
      meta: {
        pendingVangLai: s.pendingVangLai,
        pendingPassSlot: s.pendingPassSlot,
      },
    });
    sessionsNeedingDigest.push(s);
  }
  if (sessionsNeedingDigest.length === 0) {
    console.log("[cron] cutoff sweep: all crossing sessions already digested");
    return;
  }

  const admins = await db.query.users.findMany({
    where: and(eq(schema.users.role, "admin"), eq(schema.users.isActive, true)),
  });
  for (const admin of admins) {
    try {
      await sendAdminCutoffDigestEmail(
        env,
        { id: admin.id, name: admin.name, email: admin.email },
        sessionsNeedingDigest.map((s) => ({
          date: s.date,
          weekday: s.weekday,
          pendingVangLai: s.pendingVangLai,
          pendingPassSlot: s.pendingPassSlot,
        })),
      );
    } catch (e) {
      console.error(`[cron] cutoff digest email failed for ${admin.email}`, e);
    }
  }
  console.log(
    `[cron] cutoff sweep: digested ${sessionsNeedingDigest.length} sessions to ${admins.length} admins`,
  );
}
