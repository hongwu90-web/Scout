CREATE TABLE IF NOT EXISTS purged_items (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    guid TEXT NOT NULL,
    purged_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, feed_id, guid)
);

CREATE INDEX IF NOT EXISTS idx_purged_items_feed ON purged_items(user_id, feed_id);
CREATE INDEX IF NOT EXISTS idx_purged_items_purged_at ON purged_items(purged_at);
