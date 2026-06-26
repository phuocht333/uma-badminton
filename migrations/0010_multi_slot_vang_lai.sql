CREATE TABLE `extra_attendees` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`play_session_id` text NOT NULL,
	`source_request_id` text,
	`source_pass_request_id` text,
	`paid_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`play_session_id`) REFERENCES `play_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_request_id`) REFERENCES `extra_slot_requests`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_pass_request_id`) REFERENCES `pass_requests`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `extra_attendees_user_session_idx` ON `extra_attendees` (`user_id`,`play_session_id`);--> statement-breakpoint
CREATE INDEX `extra_attendees_session_idx` ON `extra_attendees` (`play_session_id`);--> statement-breakpoint
DROP INDEX IF EXISTS `extra_slot_user_session_idx`;--> statement-breakpoint
CREATE INDEX `extra_slot_user_session_idx` ON `extra_slot_requests` (`user_id`,`play_session_id`);