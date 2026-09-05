package store

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/0x2E/fusion/internal/model"
)

// ListBookmarksParams specifies filtering and pagination for bookmark queries.
//
// Pointer fields (FeedID, GroupID) are optional filters - nil means "no filter".
// BeforeCreatedAt/BeforeID form an optional cursor: when both are non-nil, only
// bookmarks ordered before that (created_at, id) position are returned
// (nil = first page). Limit = 0 means no limit.
type ListBookmarksParams struct {
	FeedID          *int64
	GroupID         *int64
	Limit           int
	BeforeCreatedAt *int64
	BeforeID        *int64
}

func (s *Store) ListBookmarks(userID int64, params ListBookmarksParams) ([]*model.Bookmark, error) {
	query := `
		SELECT b.id, b.item_id, b.link, b.title, b.content, b.pub_date, b.feed_name, b.feed_id, b.created_at,
		       COALESCE(i.unread, 0) AS unread
		FROM bookmarks b
	`
	args := []any{}

	// Join feeds table only when filtering by GroupID.
	if params.GroupID != nil {
		query += ` INNER JOIN feeds ON feeds.id = b.feed_id`
	}
	// Unread state comes from the linked item; orphaned bookmarks read as 0.
	query += ` LEFT JOIN items i ON i.id = b.item_id`

	query += ` WHERE b.user_id = :user_id`
	args = append(args, sql.Named("user_id", userID))

	if params.FeedID != nil {
		query += ` AND b.feed_id = :feed_id`
		args = append(args, sql.Named("feed_id", *params.FeedID))
	}
	if params.GroupID != nil {
		query += ` AND feeds.group_id = :group_id`
		args = append(args, sql.Named("group_id", *params.GroupID))
	}

	// Cursor pagination: skip bookmarks at or before the cursor position, matching
	// the ORDER BY (created_at DESC, id DESC) tie-break semantics.
	if params.BeforeCreatedAt != nil && params.BeforeID != nil {
		query += ` AND (b.created_at < :before_created_at OR (b.created_at = :before_created_at AND b.id < :before_id))`
		args = append(args, sql.Named("before_created_at", *params.BeforeCreatedAt), sql.Named("before_id", *params.BeforeID))
	}

	query += ` ORDER BY b.created_at DESC, b.id DESC`

	if params.Limit > 0 {
		query += ` LIMIT :limit`
		args = append(args, sql.Named("limit", params.Limit))
	}

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	bookmarks := []*model.Bookmark{}
	for rows.Next() {
		b := &model.Bookmark{}
		var unread int
		if err := rows.Scan(&b.ID, &b.ItemID, &b.Link, &b.Title, &b.Content, &b.PubDate, &b.FeedName, &b.FeedID, &b.CreatedAt, &unread); err != nil {
			return nil, err
		}
		b.Unread = intToBool(unread)
		bookmarks = append(bookmarks, b)
	}
	return bookmarks, rows.Err()
}

func (s *Store) GetBookmark(userID int64, id int64) (*model.Bookmark, error) {
	b := &model.Bookmark{}
	var unread int
	err := s.db.QueryRow(`
		SELECT b.id, b.item_id, b.link, b.title, b.content, b.pub_date, b.feed_name, b.feed_id, b.created_at,
		       COALESCE(i.unread, 0) AS unread
		FROM bookmarks b
		LEFT JOIN items i ON i.id = b.item_id
		WHERE b.id = :id AND b.user_id = :user_id
	`, sql.Named("id", id), sql.Named("user_id", userID)).Scan(&b.ID, &b.ItemID, &b.Link, &b.Title, &b.Content, &b.PubDate, &b.FeedName, &b.FeedID, &b.CreatedAt, &unread)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("%w: bookmark", ErrNotFound)
		}
		return nil, fmt.Errorf("get bookmark: %w", err)
	}
	b.Unread = intToBool(unread)
	return b, nil
}

// CreateBookmark saves a snapshot of content. itemID/feedID may be nil if the
// original item/feed is gone, in which case the bookmark preserves the content.
func (s *Store) CreateBookmark(userID int64, itemID *int64, feedID *int64, link, title, content string, pubDate int64, feedName string) (*model.Bookmark, error) {
	result, err := s.db.Exec(`
		INSERT INTO bookmarks (user_id, item_id, feed_id, link, title, content, pub_date, feed_name)
		VALUES (:user_id, :item_id, :feed_id, :link, :title, :content, :pub_date, :feed_name)
	`, sql.Named("user_id", userID), sql.Named("item_id", itemID), sql.Named("feed_id", feedID), sql.Named("link", link), sql.Named("title", title),
		sql.Named("content", content), sql.Named("pub_date", pubDate), sql.Named("feed_name", feedName))
	if err != nil {
		return nil, err
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}

	return s.GetBookmark(userID, id)
}

func (s *Store) DeleteBookmark(userID int64, id int64) error {
	result, err := s.db.Exec(`DELETE FROM bookmarks WHERE id = :id AND user_id = :user_id`, sql.Named("id", id), sql.Named("user_id", userID))
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("%w: bookmark", ErrNotFound)
	}
	return nil
}

func (s *Store) DeleteBookmarkByLink(userID int64, link string) error {
	_, err := s.db.Exec(`DELETE FROM bookmarks WHERE link = :link AND user_id = :user_id`, sql.Named("link", link), sql.Named("user_id", userID))
	return err
}

func (s *Store) UpdateBookmarkItemIDByLink(userID int64, itemID int64, link string) error {
	_, err := s.db.Exec(`
		UPDATE bookmarks
		SET item_id = :item_id
		WHERE link = :link AND user_id = :user_id
	`, sql.Named("item_id", itemID), sql.Named("link", link), sql.Named("user_id", userID))
	return err
}

func (s *Store) BookmarkExists(userID int64, link string) (bool, error) {
	var exists bool
	err := s.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM bookmarks WHERE link = :link AND user_id = :user_id)`, sql.Named("link", link), sql.Named("user_id", userID)).Scan(&exists)
	return exists, err
}

func (s *Store) CountBookmarks(userID int64, params ListBookmarksParams) (int, error) {
	query := `SELECT COUNT(*) FROM bookmarks b`
	args := []any{}

	if params.GroupID != nil {
		query += ` INNER JOIN feeds ON feeds.id = b.feed_id`
	}

	query += ` WHERE b.user_id = :user_id`
	args = append(args, sql.Named("user_id", userID))

	if params.FeedID != nil {
		query += ` AND b.feed_id = :feed_id`
		args = append(args, sql.Named("feed_id", *params.FeedID))
	}
	if params.GroupID != nil {
		query += ` AND feeds.group_id = :group_id`
		args = append(args, sql.Named("group_id", *params.GroupID))
	}

	var count int
	err := s.db.QueryRow(query, args...).Scan(&count)
	return count, err
}

func (s *Store) ListSavedItemIDs(userID int64) ([]int64, error) {
	rows, err := s.db.Query(`
		SELECT item_id
		FROM bookmarks
		WHERE item_id IS NOT NULL AND user_id = :user_id
		ORDER BY item_id
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

func (s *Store) DeleteAllBookmarks(userID int64, feedID, groupID *int64) error {
	query := `DELETE FROM bookmarks WHERE user_id = :user_id`
	args := []any{sql.Named("user_id", userID)}

	if groupID != nil {
		query += ` AND feed_id IN (SELECT id FROM feeds WHERE group_id = :group_id AND user_id = :user_id)`
		args = append(args, sql.Named("group_id", *groupID))
	}
	if feedID != nil {
		query += ` AND feed_id = :feed_id`
		args = append(args, sql.Named("feed_id", *feedID))
	}

	_, err := s.db.Exec(query, args...)
	return err
}

func (s *Store) BatchCreateBookmarks(userID int64, itemIDs []int64) error {
	if len(itemIDs) == 0 {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT OR IGNORE INTO bookmarks (user_id, item_id, feed_id, link, title, content, pub_date, feed_name)
		SELECT :user_id, i.id, i.feed_id, i.link, i.title, i.content, i.pub_date, f.name
		FROM items i
		JOIN feeds f ON f.id = i.feed_id
		WHERE i.id = :item_id AND (i.user_id = :user_id OR i.user_id = 1)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, itemID := range itemIDs {
		if _, err := stmt.Exec(sql.Named("user_id", userID), sql.Named("item_id", itemID)); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *Store) BatchDeleteBookmarksByItemIDs(userID int64, itemIDs []int64) error {
	if len(itemIDs) == 0 {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`DELETE FROM bookmarks WHERE user_id = :user_id AND item_id = :item_id`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, itemID := range itemIDs {
		if _, err := stmt.Exec(sql.Named("user_id", userID), sql.Named("item_id", itemID)); err != nil {
			return err
		}
	}

	return tx.Commit()
}
