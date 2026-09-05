ALTER TABLE items ADD COLUMN translated_title TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS translation_cache (
    content_hash TEXT PRIMARY KEY,
    source_lang TEXT NOT NULL DEFAULT '',
    original_text TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_translation_cache_hash ON translation_cache(content_hash);
