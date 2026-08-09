import type { Env } from "~/../worker";
import { cleanupOldLogs } from "./audit.server";
import { vnDayOfMonth } from "./dates";
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
