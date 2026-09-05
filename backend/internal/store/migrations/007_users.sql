CREATE TABLE IF NOT EXISTS users (
	id INTEGER PRIMARY KEY,
	username TEXT NOT NULL UNIQUE,
	password_hash TEXT NOT NULL,
	fever_api_key TEXT DEFAULT '',
	created_at INTEGER NOT NULL DEFAULT (unixepoch()),
	updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Default admin user for migration (username: admin, password: admin)
INSERT OR IGNORE INTO users (id, username, password_hash)
VALUES (1, 'admin', '$2a$10$Pbr6UbVSpfXS6mSFk5/fIeLm1kDwpIcP8FyJiUmqK4P1ekJW.hp9u');

ALTER TABLE groups ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE feeds ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE items ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bookmarks ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE monitored_groups ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE monitored_pages ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_groups_user_id ON groups(user_id);
CREATE INDEX IF NOT EXISTS idx_feeds_user_id ON feeds(user_id);
CREATE INDEX IF NOT EXISTS idx_items_user_id ON items(user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id ON bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_monitored_groups_user_id ON monitored_groups(user_id);
CREATE INDEX IF NOT EXISTS idx_monitored_pages_user_id ON monitored_pages(user_id);

DROP INDEX IF EXISTS idx_items_feed_guid;
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_user_feed_guid ON items(user_id, feed_id, guid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feeds_user_link ON feeds(user_id, link);
