-- Cloudflare D1 Schema for Scout Cloud Monitor

CREATE TABLE IF NOT EXISTS monitored_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    css_selector TEXT NOT NULL DEFAULT '',
    strip_selectors TEXT NOT NULL DEFAULT '',
    check_interval INTEGER NOT NULL DEFAULT 3600,
    last_hash TEXT NOT NULL DEFAULT '',
    last_status INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    next_check_at INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloud_monitored_pages_due 
ON monitored_pages(is_active, next_check_at);

CREATE TABLE IF NOT EXISTS page_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    page_id INTEGER NOT NULL,
    hash TEXT NOT NULL,
    content_text TEXT NOT NULL,
    prev_content_text TEXT NOT NULL DEFAULT '',
    diff_html TEXT NOT NULL DEFAULT '',
    sections TEXT NOT NULL DEFAULT '[]',
    has_change INTEGER NOT NULL DEFAULT 1,
    added_count INTEGER NOT NULL DEFAULT 0,
    removed_count INTEGER NOT NULL DEFAULT 0,
    unread INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloud_snapshots_page_created 
ON page_snapshots(page_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cloud_snapshots_sync 
ON page_snapshots(created_at ASC);

-- 24/7 Cloud Feed Archiving Tables

CREATE TABLE IF NOT EXISTS cloud_feeds (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    link TEXT NOT NULL UNIQUE,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_checked_at INTEGER NOT NULL DEFAULT 0,
    last_etag TEXT NOT NULL DEFAULT '',
    last_modified TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloud_feeds_active 
ON cloud_feeds(is_active);

CREATE TABLE IF NOT EXISTS cloud_feed_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    feed_id INTEGER NOT NULL,
    guid TEXT NOT NULL,
    title TEXT NOT NULL,
    link TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    pub_date INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, feed_id, guid)
);

CREATE INDEX IF NOT EXISTS idx_cloud_feed_items_sync 
ON cloud_feed_items(created_at ASC);

CREATE INDEX IF NOT EXISTS idx_cloud_feed_items_feed 
ON cloud_feed_items(feed_id, pub_date DESC);

