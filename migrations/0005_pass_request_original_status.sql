-- Track what the voter's status was before requesting the pass, so cancelling
-- restores it correctly. Without this we always restored to "thang", which is
-- wrong for vang_lai passers.
ALTER TABLE `pass_requests` ADD `original_vote_status` text NOT NULL DEFAULT 'thang';
