ALTER TABLE page_snapshots ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_page_snapshots_user_id ON page_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_page_snapshots_user_page ON page_snapshots(user_id, page_id);
