package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/0x2E/fusion/internal/model"
)

func parseKeywords(kwStr string) []string {
	// Split on comma, newline, or semicolon
	f := func(c rune) bool {
		return c == ',' || c == '\n' || c == ';'
	}
	parts := strings.FieldsFunc(kwStr, f)
	var result []string
	for _, p := range parts {
		trimmed := strings.TrimSpace(p)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func parseFeedIDs(feedIDsStr string) []int64 {
	parts := strings.Split(feedIDsStr, ",")
	var result []int64
	for _, p := range parts {
		trimmed := strings.TrimSpace(p)
		if id, err := strconv.ParseInt(trimmed, 10, 64); err == nil && id > 0 {
			result = append(result, id)
		}
	}
	return result
}

func buildFocusFeedKeywordClause(keywords []string) (string, []any) {
	if len(keywords) == 0 {
		return "", nil
	}

	var clauses []string
	var args []any
	for idx, kw := range keywords {
		paramName := fmt.Sprintf("ff_kw_%d", idx)
		clauses = append(clauses, fmt.Sprintf(
			"(items.title LIKE :%s OR items.translated_title LIKE :%s OR items.content LIKE :%s)",
			paramName, paramName, paramName,
		))
		args = append(args, sql.Named(paramName, "%"+kw+"%"))
	}

	return " AND (" + strings.Join(clauses, " OR ") + ")", args
}

// CreateFocusFeed creates a new keyword focus feed.
func (s *Store) CreateFocusFeed(userID, groupID int64, name, keywords, feedIDs, icon string) (*model.FocusFeed, error) {
	if strings.TrimSpace(icon) == "" {
		icon = "target"
	}
	result, err := s.db.Exec(`
		INSERT INTO focus_feeds (user_id, group_id, name, keywords, feed_ids, icon)
		VALUES (:user_id, :group_id, :name, :keywords, :feed_ids, :icon)
	`, sql.Named("user_id", userID), sql.Named("group_id", groupID), sql.Named("name", strings.TrimSpace(name)),
		sql.Named("keywords", strings.TrimSpace(keywords)), sql.Named("feed_ids", strings.TrimSpace(feedIDs)),
		sql.Named("icon", icon))
	if err != nil {
		return nil, err
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}

	return s.GetFocusFeed(userID, id)
}

// GetFocusFeed retrieves a focus feed by ID.
func (s *Store) GetFocusFeed(userID, id int64) (*model.FocusFeed, error) {
	ff := &model.FocusFeed{}
	err := s.db.QueryRow(`
		SELECT id, user_id, group_id, name, keywords, feed_ids, icon, created_at, updated_at
		FROM focus_feeds
		WHERE id = :id AND user_id = :user_id
	`, sql.Named("id", id), sql.Named("user_id", userID)).Scan(
		&ff.ID, &ff.UserID, &ff.GroupID, &ff.Name, &ff.Keywords, &ff.FeedIDs, &ff.Icon, &ff.CreatedAt, &ff.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("%w: focus feed", ErrNotFound)
		}
		return nil, err
	}

	// Compute unread and total items count
	unreadCount, _ := s.CountFocusFeedItems(userID, ff, boolPtr(true))
	totalCount, _ := s.CountFocusFeedItems(userID, ff, nil)
	ff.UnreadCount = unreadCount
	ff.ItemCount = totalCount

	return ff, nil
}

// ListFocusFeeds lists all focus feeds for a user with unread counts.
func (s *Store) ListFocusFeeds(userID int64) ([]*model.FocusFeed, error) {
	rows, err := s.db.Query(`
		SELECT id, user_id, group_id, name, keywords, feed_ids, icon, created_at, updated_at
		FROM focus_feeds
		WHERE user_id = :user_id
		ORDER BY name ASC, id ASC
	`, sql.Named("user_id", userID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*model.FocusFeed{}
	for rows.Next() {
		ff := &model.FocusFeed{}
		if err := rows.Scan(
			&ff.ID, &ff.UserID, &ff.GroupID, &ff.Name, &ff.Keywords, &ff.FeedIDs, &ff.Icon, &ff.CreatedAt, &ff.UpdatedAt,
		); err != nil {
			return nil, err
		}

		unreadCount, _ := s.CountFocusFeedItems(userID, ff, boolPtr(true))
		totalCount, _ := s.CountFocusFeedItems(userID, ff, nil)
		ff.UnreadCount = unreadCount
		ff.ItemCount = totalCount

		list = append(list, ff)
	}

	return list, rows.Err()
}

// UpdateFocusFeed updates an existing focus feed.
func (s *Store) UpdateFocusFeed(userID, id int64, name, keywords, feedIDs, icon *string, groupID *int64) (*model.FocusFeed, error) {
	existing, err := s.GetFocusFeed(userID, id)
	if err != nil {
		return nil, err
	}

	if name != nil {
		existing.Name = strings.TrimSpace(*name)
	}
	if keywords != nil {
		existing.Keywords = strings.TrimSpace(*keywords)
	}
	if feedIDs != nil {
		existing.FeedIDs = strings.TrimSpace(*feedIDs)
	}
	if icon != nil {
		existing.Icon = strings.TrimSpace(*icon)
	}
	if groupID != nil {
		existing.GroupID = *groupID
	}

	_, err = s.db.Exec(`
		UPDATE focus_feeds
		SET name = :name, keywords = :keywords, feed_ids = :feed_ids, icon = :icon, group_id = :group_id, updated_at = unixepoch()
		WHERE id = :id AND user_id = :user_id
	`, sql.Named("name", existing.Name), sql.Named("keywords", existing.Keywords),
		sql.Named("feed_ids", existing.FeedIDs), sql.Named("icon", existing.Icon),
		sql.Named("group_id", existing.GroupID), sql.Named("id", id), sql.Named("user_id", userID))
	if err != nil {
		return nil, err
	}

	return s.GetFocusFeed(userID, id)
}

// DeleteFocusFeed deletes a focus feed.
func (s *Store) DeleteFocusFeed(userID, id int64) error {
	res, err := s.db.Exec(`DELETE FROM focus_feeds WHERE id = :id AND user_id = :user_id`,
		sql.Named("id", id), sql.Named("user_id", userID))
	if err != nil {
		return err
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("%w: focus feed", ErrNotFound)
	}
	return nil
}

// ListFocusFeedItems retrieves matching paginated items for a given focus feed.
func (s *Store) ListFocusFeedItems(userID int64, ff *model.FocusFeed, params ListItemsParams) ([]*model.Item, error) {
	query := `
		SELECT items.id, items.feed_id, items.guid, items.title, COALESCE(items.translated_title, ''), items.link, items.content, items.pub_date, items.unread, items.created_at
		FROM items
		WHERE items.user_id = :user_id
	`
	args := []any{sql.Named("user_id", userID)}

	keywords := parseKeywords(ff.Keywords)
	kwClause, kwArgs := buildFocusFeedKeywordClause(keywords)
	query += kwClause
	args = append(args, kwArgs...)

	feedIDs := parseFeedIDs(ff.FeedIDs)
	if len(feedIDs) > 0 {
		var placeholders []string
		for idx, fid := range feedIDs {
			name := fmt.Sprintf("ff_feed_%d", idx)
			placeholders = append(placeholders, ":"+name)
			args = append(args, sql.Named(name, fid))
		}
		query += fmt.Sprintf(" AND items.feed_id IN (%s)", strings.Join(placeholders, ","))
	}

	if params.Unread != nil {
		query += ` AND items.unread = :unread`
		args = append(args, sql.Named("unread", boolToInt(*params.Unread)))
	}

	if strings.TrimSpace(params.Query) != "" {
		query += ` AND (items.title LIKE :query OR items.translated_title LIKE :query OR items.content LIKE :query)`
		args = append(args, sql.Named("query", "%"+strings.TrimSpace(params.Query)+"%"))
	}

	// Cursor pagination
	if params.BeforePubDate != nil && params.BeforeID != nil {
		query += ` AND (items.pub_date < :before_pub_date OR (items.pub_date = :before_pub_date AND items.id < :before_id))`
		args = append(args, sql.Named("before_pub_date", *params.BeforePubDate), sql.Named("before_id", *params.BeforeID))
	}

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

// CountFocusFeedItems counts items matching the focus feed.
func (s *Store) CountFocusFeedItems(userID int64, ff *model.FocusFeed, unread *bool) (int64, error) {
	query := `SELECT COUNT(*) FROM items WHERE items.user_id = :user_id`
	args := []any{sql.Named("user_id", userID)}

	keywords := parseKeywords(ff.Keywords)
	kwClause, kwArgs := buildFocusFeedKeywordClause(keywords)
	query += kwClause
	args = append(args, kwArgs...)

	feedIDs := parseFeedIDs(ff.FeedIDs)
	if len(feedIDs) > 0 {
		var placeholders []string
		for idx, fid := range feedIDs {
			name := fmt.Sprintf("ff_cnt_feed_%d", idx)
			placeholders = append(placeholders, ":"+name)
			args = append(args, sql.Named(name, fid))
		}
		query += fmt.Sprintf(" AND items.feed_id IN (%s)", strings.Join(placeholders, ","))
	}

	if unread != nil {
		query += ` AND items.unread = :unread`
		args = append(args, sql.Named("unread", boolToInt(*unread)))
	}

	var count int64
	err := s.db.QueryRow(query, args...).Scan(&count)
	return count, err
}

func boolPtr(b bool) *bool {
	return &b
}
