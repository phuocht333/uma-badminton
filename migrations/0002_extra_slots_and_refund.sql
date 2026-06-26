CREATE TABLE `extra_slot_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`play_session_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`approved_at` integer,
	`approved_by_user_id` text,
	`cancelled_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`play_session_id`) REFERENCES `play_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `extra_slot_user_session_idx` ON `extra_slot_requests` (`user_id`,`play_session_id`);--> statement-breakpoint
CREATE INDEX `extra_slot_session_idx` ON `extra_slot_requests` (`play_session_id`);