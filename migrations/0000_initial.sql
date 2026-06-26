CREATE TABLE `config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `court_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`play_session_id` text NOT NULL,
	`court_code` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`display_order` integer NOT NULL,
	FOREIGN KEY (`play_session_id`) REFERENCES `play_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `court_alloc_session_idx` ON `court_allocations` (`play_session_id`);--> statement-breakpoint
CREATE TABLE `months` (
	`id` text PRIMARY KEY NOT NULL,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`status` text NOT NULL,
	`vote_open_at` integer NOT NULL,
	`vote_close_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `months_year_month_idx` ON `months` (`year`,`month`);--> statement-breakpoint
CREATE TABLE `pass_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`vote_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`claimed_by_user_id` text,
	`claimed_at` integer,
	FOREIGN KEY (`vote_id`) REFERENCES `votes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claimed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pass_req_vote_idx` ON `pass_requests` (`vote_id`);--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `play_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`month_id` text NOT NULL,
	`date` text NOT NULL,
	`weekday` text NOT NULL,
	FOREIGN KEY (`month_id`) REFERENCES `months`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `play_sessions_month_idx` ON `play_sessions` (`month_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `play_sessions_date_idx` ON `play_sessions` (`date`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`gender` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`password_hash` text,
	`qr_image_key` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `votes` (
	`id` text PRIMARY KEY NOT NULL,
	`play_session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`voted_at` integer NOT NULL,
	`original_voter_id` text,
	FOREIGN KEY (`play_session_id`) REFERENCES `play_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`original_voter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `votes_session_user_idx` ON `votes` (`play_session_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `votes_user_idx` ON `votes` (`user_id`);