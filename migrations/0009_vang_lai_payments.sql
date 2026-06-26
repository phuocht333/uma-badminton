CREATE TABLE `vang_lai_payments` (
	`vote_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`paid_at` integer NOT NULL,
	FOREIGN KEY (`vote_id`) REFERENCES `votes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vang_lai_pay_user_idx` ON `vang_lai_payments` (`user_id`);