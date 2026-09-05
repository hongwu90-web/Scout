-- Monitored Groups
CREATE TABLE IF NOT EXISTS monitored_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Monitored Pages
CREATE TABLE IF NOT EXISTS monitored_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER REFERENCES monitored_groups(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    css_selector TEXT NOT NULL DEFAULT '',
    strip_selectors TEXT NOT NULL DEFAULT '',
    check_interval INTEGER NOT NULL DEFAULT 3600,
    last_hash TEXT NOT NULL DEFAULT '',
    last_checked_at INTEGER NOT NULL DEFAULT 0,
    next_check_at INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    last_status INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    unread INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_monitored_pages_next_check ON monitored_pages (next_check_at) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_monitored_pages_group_id ON monitored_pages (group_id);

-- Page Snapshots
CREATE TABLE IF NOT EXISTS page_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id INTEGER NOT NULL REFERENCES monitored_pages(id) ON DELETE CASCADE,
    hash TEXT NOT NULL,
    content_text TEXT NOT NULL,
    diff_html TEXT NOT NULL DEFAULT '',
    has_change INTEGER NOT NULL DEFAULT 0,
    added_count INTEGER NOT NULL DEFAULT 0,
    removed_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_page_snapshots_page_id ON page_snapshots (page_id);
CREATE INDEX IF NOT EXISTS idx_page_snapshots_created_at ON page_snapshots (created_at);
