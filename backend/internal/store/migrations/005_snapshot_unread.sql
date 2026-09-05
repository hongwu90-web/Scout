-- Add unread column to page_snapshots
ALTER TABLE page_snapshots ADD COLUMN unread INTEGER NOT NULL DEFAULT 0;

-- Update existing changed snapshots to be unread if their page is unread
UPDATE page_snapshots SET unread = 1 WHERE has_change = 1 AND page_id IN (SELECT id FROM monitored_pages WHERE unread = 1);
