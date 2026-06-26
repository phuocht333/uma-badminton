-- Revert multi-slot vãng lai: keep oldest extra_slot_request per (user, session)
-- so the next CREATE UNIQUE INDEX doesn't choke on duplicates introduced by
-- the multi-slot feature. Tiebreaker = lowest rowid when created_at matches.
DELETE FROM `extra_slot_requests`
WHERE `rowid` NOT IN (
  SELECT MIN(`rowid`) FROM `extra_slot_requests`
  GROUP BY `user_id`, `play_session_id`
);
--> statement-breakpoint
DROP TABLE `extra_attendees`;--> statement-breakpoint
DROP INDEX IF EXISTS `extra_slot_user_session_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `extra_slot_user_session_idx` ON `extra_slot_requests` (`user_id`,`play_session_id`);
