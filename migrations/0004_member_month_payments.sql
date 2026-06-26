CREATE TABLE `member_month_payments` (
	`user_id` text NOT NULL,
	`month_id` text NOT NULL,
	`paid_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `month_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`month_id`) REFERENCES `months`(`id`) ON UPDATE no action ON DELETE cascade
);
