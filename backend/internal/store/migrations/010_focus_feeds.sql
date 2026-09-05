CREATE TABLE IF NOT EXISTS focus_feeds (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    keywords TEXT NOT NULL,
    feed_ids TEXT NOT NULL DEFAULT '',
    group_id INTEGER NOT NULL DEFAULT 1 REFERENCES groups(id) ON DELETE RESTRICT,
    icon TEXT NOT NULL DEFAULT 'target',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_focus_feeds_user ON focus_feeds(user_id);
CREATE INDEX IF NOT EXISTS idx_focus_feeds_group ON focus_feeds(group_id);
