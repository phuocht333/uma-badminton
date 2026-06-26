-- Snapshot the matrix at lock time so post-lock court edits (made via the
-- admin session detail page) only affect live home cards, not the historic
-- /lich bill matrix.
ALTER TABLE `months` ADD `locked_snapshot` text;
