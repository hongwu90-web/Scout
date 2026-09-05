-- Add sections_json and prev_content_text columns to page_snapshots
ALTER TABLE page_snapshots ADD COLUMN sections_json TEXT NOT NULL DEFAULT '';
ALTER TABLE page_snapshots ADD COLUMN prev_content_text TEXT NOT NULL DEFAULT '';
