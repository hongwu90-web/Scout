package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/0x2E/fusion/internal/model"
)

// ListItemsParams specifies filtering and pagination for item queries.
//
// Pointer fields (FeedID, GroupID, Unread) are optional filters - nil means "no filter".
// BeforePubDate/BeforeID form an optional cursor: when both are non-nil, only items
// ordered before that (pub_date, id) position are returned (nil = first page).
// OrderBy accepts "pub_date" (default) or "created_at".
// Limit = 0 means no limit.
type ListItemsParams struct {
	FeedID        *int64
	GroupID       *int64
	Unread        *bool
	Query         string
	Limit         int
	BeforePubDate *int64
	BeforeID      *int64
	OrderBy       string // "pub_date" or "created_at"
}

func (s *Store) ListItems(userID int64, params ListItemsParams) ([]*model.Item, error) {
	query := `
		SELECT items.id, items.feed_id, items.guid, items.title, COALESCE(items.translated_title, ''), items.link, items.content, items.pub_date, items.unread, items.created_at
		FROM items
	`
	args := []any{}

	// Join feeds table if filtering by GroupID
	if params.GroupID != nil {
		query += ` INNER JOIN feeds ON items.feed_id = feeds.id`
	}

	query += ` WHERE items.user_id = :user_id`
	args = append(args, sql.Named("user_id", userID))

	if params.FeedID != nil {
		query += ` AND items.feed_id = :feed_id`
		args = append(args, sql.Named("feed_id", *params.FeedID))
	}
	if params.GroupID != nil {
		query += ` AND feeds.group_id = :group_id`
		args = append(args, sql.Named("group_id", *params.GroupID))
	}
	if params.Unread != nil {
		query += ` AND items.unread = :unread`
		args = append(args, sql.Named("unread", boolToInt(*params.Unread)))
	}
	if strings.TrimSpace(params.Query) != "" {
		query += ` AND (items.title LIKE :query OR items.translated_title LIKE :query OR items.content LIKE :query)`
		args = append(args, sql.Named("query", "%"+strings.TrimSpace(params.Query)+"%"))
	}

	// Cursor pagination: skip items at or before the cursor position, matching
	// the ORDER BY (pub_date DESC, id DESC) tie-break semantics.
	if params.BeforePubDate != nil && params.BeforeID != nil {
		query += ` AND (items.pub_date < :before_pub_date OR (items.pub_date = :before_pub_date AND items.id < :before_id))`
		args = append(args, sql.Named("before_pub_date", *params.BeforePubDate), sql.Named("before_id", *params.BeforeID))
	}

	// ORDER BY cannot use named parameters, validated via allowlist instead
	orderBy := "items.pub_date DESC, items.id DESC"
	if params.OrderBy == "created_at" {
		orderBy = "items.created_at DESC, items.id DESC"
	}
	query += ` ORDER BY ` + orderBy

	if params.Limit > 0 {
		query += ` LIMIT :limit`
		args = append(args, sql.Named("limit", params.Limit))
	}

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []*model.Item{}
	for rows.Next() {
		i := &model.Item{}
		var unread int
		if err := rows.Scan(&i.ID, &i.FeedID, &i.GUID, &i.Title, &i.TranslatedTitle, &i.Link, &i.Content, &i.PubDate, &unread, &i.CreatedAt); err != nil {
			return nil, err
		}
		i.Unread = intToBool(unread)
		items = append(items, i)
	}
	return items, rows.Err()
}

func (s *Store) GetItem(userID int64, id int64) (*model.Item, error) {
	i := &model.Item{}
	var unread int
	err := s.db.QueryRow(`
		SELECT id, feed_id, guid, title, COALESCE(translated_title, ''), link, content, pub_date, unread, created_at
		FROM items
		WHERE id = :id AND user_id = :user_id
	`, sql.Named("id", id), sql.Named("user_id", userID)).Scan(&i.ID, &i.FeedID, &i.GUID, &i.Title, &i.TranslatedTitle, &i.Link, &i.Content, &i.PubDate, &unread, &i.CreatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("%w: item", ErrNotFound)
		}
		return nil, fmt.Errorf("get item: %w", err)
	}

	i.Unread = intToBool(unread)
	return i, nil
}

func (s *Store) CreateItem(userID int64, feedID int64, guid, title, link, content string, pubDate int64) (*model.Item, error) {
	var purgedCount int
	err := s.db.QueryRow("SELECT COUNT(*) FROM purged_items WHERE user_id = :user_id AND feed_id = :feed_id AND guid = :guid",
		sql.Named("user_id", userID), sql.Named("feed_id", feedID), sql.Named("guid", guid)).Scan(&purgedCount)
	if err == nil && purgedCount > 0 {
		return nil, fmt.Errorf("item was previously purged")
	}

	result, err := s.db.Exec(`
		INSERT INTO items (user_id, feed_id, guid, title, link, content, pub_date)
		VALUES (:user_id, :feed_id, :guid, :title, :link, :content, :pub_date)
	`, sql.Named("user_id", userID), sql.Named("feed_id", feedID), sql.Named("guid", guid), sql.Named("title", title),
		sql.Named("link", link), sql.Named("content", content), sql.Named("pub_date", pubDate))
	if err != nil {
		return nil, err
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}

	return s.GetItem(userID, id)
}

type BatchCreateItemInput struct {
	GUID    string
	Title   string
	Link    string
	Content string
	PubDate int64
}

// BatchCreateItemsIgnore inserts items in one transaction and ignores duplicates by (feed_id, guid)
// as well as items that have been previously purged.
// Returns the number of newly inserted rows.
func (s *Store) BatchCreateItemsIgnore(userID int64, feedID int64, inputs []BatchCreateItemInput) (int, error) {
	if len(inputs) == 0 {
		return 0, nil
	}

	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO items (user_id, feed_id, guid, title, link, content, pub_date)
		SELECT :user_id, :feed_id, :guid, :title, :link, :content, :pub_date
		WHERE NOT EXISTS (
			SELECT 1 FROM purged_items
			WHERE user_id = :user_id AND feed_id = :feed_id AND guid = :guid
		)
		ON CONFLICT(user_id, feed_id, guid) DO NOTHING
	`)
	if err != nil {
		return 0, err
	}
	defer stmt.Close()

	created := 0
	for _, input := range inputs {
		result, err := stmt.Exec(
			sql.Named("user_id", userID),
			sql.Named("feed_id", feedID),
			sql.Named("guid", input.GUID),
			sql.Named("title", input.Title),
			sql.Named("link", input.Link),
			sql.Named("content", input.Content),
			sql.Named("pub_date", input.PubDate),
		)
		if err != nil {
			return 0, err
		}

		affected, err := result.RowsAffected()
		if err != nil {
			return 0, err
		}
		if affected > 0 {
			created++
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}

	return created, nil
}

func (s *Store) UpdateItemUnread(userID int64, id int64, unread bool) error {
	result, err := s.db.Exec(`UPDATE items SET unread = :unread WHERE id = :id AND user_id = :user_id`,
		sql.Named("unread", boolToInt(unread)), sql.Named("id", id), sql.Named("user_id", userID))
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("%w: item", ErrNotFound)
	}
	return nil
}

// BatchUpdateItemsUnread marks multiple items as read/unread.
// IDs are chunked to keep SQL statements bounded and avoid oversized IN clauses.
func (s *Store) BatchUpdateItemsUnread(userID int64, ids []int64, unread bool) error {
	if len(ids) == 0 {
		return nil
	}

	const chunkSize = 500
	for start := 0; start < len(ids); start += chunkSize {
		end := min(start+chunkSize, len(ids))

		if err := s.batchUpdateItemsUnreadChunk(userID, ids[start:end], unread); err != nil {
			return err
		}
	}

	return nil
}

func (s *Store) batchUpdateItemsUnreadChunk(userID int64, ids []int64, unread bool) error {
	if len(ids) == 0 {
		return nil
	}

	placeholders := make([]string, len(ids))
	args := make([]any, 0, len(ids)+2)
	args = append(args, sql.Named("unread", boolToInt(unread)), sql.Named("user_id", userID))
	for i, id := range ids {
		paramName := fmt.Sprintf("id%d", i)
		placeholders[i] = ":" + paramName
		args = append(args, sql.Named(paramName, id))
	}

	query := fmt.Sprintf(`UPDATE items SET unread = :unread WHERE id IN (%s) AND user_id = :user_id`, strings.Join(placeholders, ","))
	_, err := s.db.Exec(query, args...)
	return err
}

// MarkAllAsRead marks items as read. If feedID is nil, marks ALL items across all feeds.
// If feedID is non-nil, only marks items from that specific feed.
func (s *Store) MarkAllAsRead(userID int64, feedID *int64) error {
	if feedID != nil {
		_, err := s.db.Exec(`UPDATE items SET unread = 0 WHERE feed_id = :feed_id AND user_id = :user_id`, sql.Named("feed_id", *feedID), sql.Named("user_id", userID))
		return err
	}
	_, err := s.db.Exec(`UPDATE items SET unread = 0 WHERE user_id = :user_id`, sql.Named("user_id", userID))
	return err
}

func (s *Store) MarkGroupAsRead(userID int64, groupID int64) error {
	_, err := s.db.Exec(`
		UPDATE items
		SET unread = 0
		WHERE feed_id IN (
			SELECT id
			FROM feeds
			WHERE group_id = :group_id AND user_id = :user_id
		) AND user_id = :user_id
	`, sql.Named("group_id", groupID), sql.Named("user_id", userID))
	return err
}

func (s *Store) MarkFeedAsReadBefore(userID int64, feedID, before int64) error {
	_, err := s.db.Exec(`
		UPDATE items
		SET unread = 0
		WHERE feed_id = :feed_id AND user_id = :user_id
		  AND (CASE WHEN pub_date > 0 THEN pub_date ELSE created_at END) <= :before
	`, sql.Named("feed_id", feedID), sql.Named("user_id", userID), sql.Named("before", before))
	return err
}

func (s *Store) MarkGroupAsReadBefore(userID int64, groupID, before int64) error {
	_, err := s.db.Exec(`
		UPDATE items
		SET unread = 0
		WHERE feed_id IN (
			SELECT id
			FROM feeds
			WHERE group_id = :group_id AND user_id = :user_id
		) AND user_id = :user_id
		  AND (CASE WHEN pub_date > 0 THEN pub_date ELSE created_at END) <= :before
	`, sql.Named("group_id", groupID), sql.Named("user_id", userID), sql.Named("before", before))
	return err
}

func (s *Store) MarkAllAsReadBefore(userID int64, before int64) error {
	_, err := s.db.Exec(`
		UPDATE items
		SET unread = 0
		WHERE user_id = :user_id AND (CASE WHEN pub_date > 0 THEN pub_date ELSE created_at END) <= :before
	`, sql.Named("user_id", userID), sql.Named("before", before))
	return err
}

func (s *Store) ListUnreadItemIDs(userID int64) ([]int64, error) {
	rows, err := s.db.Query(`
		SELECT id
		FROM items
		WHERE unread = 1 AND user_id = :user_id
		ORDER BY id
	`, sql.Named("user_id", userID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}

	return ids, rows.Err()
}

type ListFeverItemsParams struct {
	WithIDs []int64
	SinceID *int64
	MaxID   *int64
	Limit   int
	SortAsc bool
}

func (s *Store) ListFeverItems(userID int64, params ListFeverItemsParams) ([]*model.Item, error) {
	query := `
		SELECT id, feed_id, guid, title, COALESCE(translated_title, ''), link, content, pub_date, unread, created_at
		FROM items
		WHERE user_id = :user_id
	`
	args := []any{sql.Named("user_id", userID)}

	if len(params.WithIDs) > 0 {
		placeholders := make([]string, len(params.WithIDs))
		for i, id := range params.WithIDs {
			name := fmt.Sprintf("with_id_%d", i)
			placeholders[i] = ":" + name
			args = append(args, sql.Named(name, id))
		}
		query += fmt.Sprintf(" AND id IN (%s)", strings.Join(placeholders, ","))
	}

	if params.SinceID != nil {
		query += ` AND id > :since_id`
		args = append(args, sql.Named("since_id", *params.SinceID))
	}

	if params.MaxID != nil {
		query += ` AND id <= :max_id`
		args = append(args, sql.Named("max_id", *params.MaxID))
	}

	orderBy := "DESC"
	if params.SortAsc {
		orderBy = "ASC"
	}
	query += ` ORDER BY id ` + orderBy

	if params.Limit > 0 {
		query += ` LIMIT :limit`
		args = append(args, sql.Named("limit", params.Limit))
	}

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []*model.Item{}
	for rows.Next() {
		i := &model.Item{}
		var unread int
		if err := rows.Scan(&i.ID, &i.FeedID, &i.GUID, &i.Title, &i.TranslatedTitle, &i.Link, &i.Content, &i.PubDate, &unread, &i.CreatedAt); err != nil {
			return nil, err
		}
		i.Unread = intToBool(unread)
		items = append(items, i)
	}

	return items, rows.Err()
}

// UpdateItemTranslatedTitle updates the translated title for an item.
func (s *Store) UpdateItemTranslatedTitle(userID int64, id int64, translatedTitle string) error {
	result, err := s.db.Exec(`UPDATE items SET translated_title = :translated_title WHERE id = :id AND user_id = :user_id`,
		sql.Named("translated_title", translatedTitle), sql.Named("id", id), sql.Named("user_id", userID))
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("%w: item", ErrNotFound)
	}
	return nil
}

// GetCachedTranslation retrieves a cached translation by content hash.
func (s *Store) GetCachedTranslation(contentHash string) (string, error) {
	var translated string
	err := s.db.QueryRow(`SELECT translated_text FROM translation_cache WHERE content_hash = :hash`,
		sql.Named("hash", contentHash)).Scan(&translated)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	return translated, nil
}

// SetCachedTranslation persists a translation in the translation_cache table.
func (s *Store) SetCachedTranslation(contentHash, sourceLang, originalText, translatedText string) error {
	_, err := s.db.Exec(`
		INSERT INTO translation_cache (content_hash, source_lang, original_text, translated_text)
		VALUES (:hash, :source_lang, :original_text, :translated_text)
		ON CONFLICT(content_hash) DO UPDATE SET
			translated_text = excluded.translated_text
	`, sql.Named("hash", contentHash), sql.Named("source_lang", sourceLang),
		sql.Named("original_text", originalText), sql.Named("translated_text", translatedText))
	return err
}

func (s *Store) ItemExists(userID int64, feedID int64, guid string) (bool, error) {
	var exists bool
	err := s.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM items WHERE feed_id = :feed_id AND guid = :guid AND user_id = :user_id)`,
		sql.Named("feed_id", feedID), sql.Named("guid", guid), sql.Named("user_id", userID)).Scan(&exists)
	return exists, err
}

type SearchItemResult struct {
	ID      int64  `json:"id"`
	FeedID  int64  `json:"feed_id"`
	Title   string `json:"title"`
	PubDate int64  `json:"pub_date"`
}

func (s *Store) SearchItems(userID int64, query string, limit int) ([]*SearchItemResult, error) {
	ftsQuery := buildFTSQuery(query)
	if ftsQuery == "" {
		return s.searchItemsLike(userID, query, limit)
	}

	rows, err := s.db.Query(`
		SELECT i.id, i.feed_id, i.title, i.pub_date
		FROM items_fts
		INNER JOIN items i ON i.id = items_fts.rowid
		WHERE items_fts MATCH :query AND i.user_id = :user_id
		ORDER BY i.pub_date DESC, i.id DESC
		LIMIT :limit
	`, sql.Named("query", ftsQuery), sql.Named("user_id", userID), sql.Named("limit", limit))
	if err != nil {
		return s.searchItemsLike(userID, query, limit)
	}
	defer rows.Close()

	items := []*SearchItemResult{}
	for rows.Next() {
		i := &SearchItemResult{}
		if err := rows.Scan(&i.ID, &i.FeedID, &i.Title, &i.PubDate); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	return items, rows.Err()
}

func buildFTSQuery(query string) string {
	parts := strings.Fields(strings.TrimSpace(query))
	if len(parts) == 0 {
		return ""
	}

	terms := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		part = strings.ReplaceAll(part, `"`, `""`)
		terms = append(terms, `"`+part+`"*`)
	}

	return strings.Join(terms, " AND ")
}

func (s *Store) searchItemsLike(userID int64, query string, limit int) ([]*SearchItemResult, error) {
	rows, err := s.db.Query(`
		SELECT id, feed_id, title, pub_date
		FROM items
		WHERE user_id = :user_id AND (title LIKE :query OR content LIKE :query)
		ORDER BY pub_date DESC, id DESC
		LIMIT :limit
	`, sql.Named("user_id", userID), sql.Named("query", "%"+query+"%"), sql.Named("limit", limit))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []*SearchItemResult{}
	for rows.Next() {
		i := &SearchItemResult{}
		if err := rows.Scan(&i.ID, &i.FeedID, &i.Title, &i.PubDate); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	return items, rows.Err()
}

// CountItems returns the total count of items matching the filter criteria.
func (s *Store) CountItems(userID int64, params ListItemsParams) (int, error) {
	query := `SELECT COUNT(*) FROM items`
	args := []any{}

	if params.GroupID != nil {
		query += ` INNER JOIN feeds ON items.feed_id = feeds.id`
	}

	query += ` WHERE items.user_id = :user_id`
	args = append(args, sql.Named("user_id", userID))

	if params.FeedID != nil {
		query += ` AND items.feed_id = :feed_id`
		args = append(args, sql.Named("feed_id", *params.FeedID))
	}
	if params.GroupID != nil {
		query += ` AND feeds.group_id = :group_id`
		args = append(args, sql.Named("group_id", *params.GroupID))
	}
	if params.Unread != nil {
		query += ` AND items.unread = :unread`
		args = append(args, sql.Named("unread", boolToInt(*params.Unread)))
	}
	if strings.TrimSpace(params.Query) != "" {
		query += ` AND (items.title LIKE :query OR items.translated_title LIKE :query OR items.content LIKE :query)`
		args = append(args, sql.Named("query", "%"+strings.TrimSpace(params.Query)+"%"))
	}

	var count int
	err := s.db.QueryRow(query, args...).Scan(&count)
	return count, err
}

// MarkItemsReadByDate marks items as read based on feed/group and publication date.
func (s *Store) MarkItemsReadByDate(userID int64, feedID, groupID *int64, beforePubDate *int64) error {
	query := `UPDATE items SET unread = 0 WHERE unread = 1 AND user_id = :user_id`
	args := []any{sql.Named("user_id", userID)}

	if groupID != nil {
		query += ` AND feed_id IN (SELECT id FROM feeds WHERE group_id = :group_id AND user_id = :user_id)`
		args = append(args, sql.Named("group_id", *groupID))
	}

	if feedID != nil {
		query += ` AND feed_id = :feed_id`
		args = append(args, sql.Named("feed_id", *feedID))
	}

	if beforePubDate != nil {
		query += ` AND (CASE WHEN pub_date > 0 THEN pub_date ELSE created_at END) <= :before_date`
		args = append(args, sql.Named("before_date", *beforePubDate))
	}

	_, err := s.db.Exec(query, args...)
	return err
}

type PurgedItemRecord struct {
	FeedID int64  `json:"feed_id"`
	GUID   string `json:"guid"`
}

// DeleteReadItems deletes all read items matching the given feed or group criteria
// and records tombstones in purged_items so they are never re-ingested.
func (s *Store) DeleteReadItems(userID int64, feedID, groupID *int64) (int64, []PurgedItemRecord, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return 0, nil, err
	}
	defer tx.Rollback()

	whereClause := "WHERE i.unread = 0 AND i.user_id = :user_id AND i.id NOT IN (SELECT item_id FROM bookmarks WHERE item_id IS NOT NULL AND user_id = :user_id)"
	args := []any{sql.Named("user_id", userID)}

	if groupID != nil {
		whereClause += " AND i.feed_id IN (SELECT id FROM feeds WHERE group_id = :group_id AND user_id = :user_id)"
		args = append(args, sql.Named("group_id", *groupID))
	}

	if feedID != nil {
		whereClause += " AND i.feed_id = :feed_id"
		args = append(args, sql.Named("feed_id", *feedID))
	}

	// 1. Collect items to be purged
	rows, err := tx.Query("SELECT i.feed_id, i.guid FROM items i "+whereClause, args...)
	if err != nil {
		return 0, nil, fmt.Errorf("query items to purge: %w", err)
	}
	var purged []PurgedItemRecord
	for rows.Next() {
		var rec PurgedItemRecord
		if err := rows.Scan(&rec.FeedID, &rec.GUID); err != nil {
			rows.Close()
			return 0, nil, err
		}
		purged = append(purged, rec)
	}
	rows.Close()

	if len(purged) == 0 {
		return 0, nil, nil
	}

	// 2. Insert tombstones into purged_items
	now := time.Now().Unix()
	insertTombstoneStmt, err := tx.Prepare(`
		INSERT OR IGNORE INTO purged_items (user_id, feed_id, guid, purged_at)
		VALUES (:user_id, :feed_id, :guid, :purged_at)
	`)
	if err != nil {
		return 0, nil, fmt.Errorf("prepare tombstone statement: %w", err)
	}
	defer insertTombstoneStmt.Close()

	for _, rec := range purged {
		if _, err := insertTombstoneStmt.Exec(
			sql.Named("user_id", userID),
			sql.Named("feed_id", rec.FeedID),
			sql.Named("guid", rec.GUID),
			sql.Named("purged_at", now),
		); err != nil {
			return 0, nil, fmt.Errorf("insert tombstone: %w", err)
		}
	}

	// 3. Delete matching read items from items table
	deleteQuery := "DELETE FROM items WHERE id IN (SELECT i.id FROM items i " + whereClause + ")"
	delRes, err := tx.Exec(deleteQuery, args...)
	if err != nil {
		return 0, nil, fmt.Errorf("delete items: %w", err)
	}

	affected, err := delRes.RowsAffected()
	if err != nil {
		return 0, nil, err
	}

	// 4. Prune very old tombstones (> 90 days) during purge
	cutoff := now - 90*86400
	_, _ = tx.Exec("DELETE FROM purged_items WHERE user_id = :user_id AND purged_at < :cutoff",
		sql.Named("user_id", userID), sql.Named("cutoff", cutoff))

	if err := tx.Commit(); err != nil {
		return 0, nil, err
	}

	return affected, purged, nil
}
