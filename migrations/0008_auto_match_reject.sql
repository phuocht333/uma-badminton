-- Auto-match feature: admin can reject pending pass-slot or vãng lai requests
-- when no match could be made by the cutoff (24h before earliest court start).
-- See decisions B29 (pass-slot reject -> vote revert thang) and B30 (vãng lai
-- reject -> no vote created). rejectedAt distinguishes admin-initiated reject
-- from user-initiated cancel (cancelledAt).
ALTER TABLE `pass_requests` ADD `rejected_at` integer;--> statement-breakpoint
ALTER TABLE `pass_requests` ADD `rejected_by_user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `extra_slot_requests` ADD `rejected_at` integer;--> statement-breakpoint
ALTER TABLE `extra_slot_requests` ADD `rejected_by_user_id` text REFERENCES users(id);
