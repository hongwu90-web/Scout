package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/0x2E/fusion/internal/model"
)

// Monitored Group Operations

func (s *Store) CreateMonitoredGroup(userID int64, name string) (*model.MonitoredGroup, error) {
	now := time.Now().Unix()
	query := `
		INSERT INTO monitored_groups (user_id, name, created_at, updated_at)
		VALUES (:user_id, :name, :created_at, :updated_at)
		RETURNING id, name, created_at, updated_at
	`
	group := &model.MonitoredGroup{}
	err := s.db.QueryRow(query,
		sql.Named("user_id", userID),
		sql.Named("name", name),
		sql.Named("created_at", now),
		sql.Named("updated_at", now),
	).Scan(&group.ID, &group.Name, &group.CreatedAt, &group.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create monitored group: %w", err)
	}
	return group, nil
}

func (s *Store) ListMonitoredGroups(userID int64) ([]*model.MonitoredGroup, error) {
	query := `SELECT id, name, created_at, updated_at FROM monitored_groups WHERE user_id = :user_id ORDER BY name ASC`
	rows, err := s.db.Query(query, sql.Named("user_id", userID))
	if err != nil {
		return nil, fmt.Errorf("list monitored groups: %w", err)
	}
	defer rows.Close()

	var groups []*model.MonitoredGroup
	for rows.Next() {
		g := &model.MonitoredGroup{}
		if err := rows.Scan(&g.ID, &g.Name, &g.CreatedAt, &g.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan monitored group: %w", err)
		}
		groups = append(groups, g)
	}
	return groups, nil
}

func (s *Store) UpdateMonitoredGroup(userID int64, id int64, name string) (*model.MonitoredGroup, error) {
	now := time.Now().Unix()
	query := `
		UPDATE monitored_groups
		SET name = :name, updated_at = :updated_at
		WHERE id = :id AND user_id = :user_id
		RETURNING id, name, created_at, updated_at
	`
	g := &model.MonitoredGroup{}
	err := s.db.QueryRow(query,
		sql.Named("id", id),
		sql.Named("user_id", userID),
		sql.Named("name", name),
		sql.Named("updated_at", now),
	).Scan(&g.ID, &g.Name, &g.CreatedAt, &g.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("update monitored group: %w", err)
	}
	return g, nil
}

func (s *Store) DeleteMonitoredGroup(userID int64, id int64) error {
	res, err := s.db.Exec(`DELETE FROM monitored_groups WHERE id = :id AND user_id = :user_id`, sql.Named("id", id), sql.Named("user_id", userID))
	if err != nil {
		return fmt.Errorf("delete monitored group: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// Monitored Page Operations

func (s *Store) CreateMonitoredPage(userID int64, req *model.CreateMonitoredPageRequest) (*model.MonitoredPage, error) {
	now := time.Now().Unix()
	checkInterval := req.CheckInterval
	if checkInterval <= 0 {
		checkInterval = 3600 // Default 1 hour
	}
	query := `
		INSERT INTO monitored_pages (
			user_id, group_id, name, url, css_selector, strip_selectors,
			check_interval, last_hash, last_checked_at, next_check_at,
			active, last_status, last_error, unread, created_at, updated_at
		) VALUES (
			:user_id, :group_id, :name, :url, :css_selector, :strip_selectors,
			:check_interval, '', 0, :next_check_at,
			1, 0, '', 0, :created_at, :updated_at
		)
		RETURNING id, group_id, name, url, css_selector, strip_selectors,
			check_interval, last_hash, last_checked_at, next_check_at,
			active, last_status, last_error, unread, created_at, updated_at
	`
	p := &model.MonitoredPage{}
	var groupID sql.NullInt64
	if req.GroupID != nil {
		groupID = sql.NullInt64{Int64: *req.GroupID, Valid: true}
	}

	var activeInt int
	var unreadInt int
	err := s.db.QueryRow(query,
		sql.Named("user_id", userID),
		sql.Named("group_id", groupID),
		sql.Named("name", req.Name),
		sql.Named("url", req.URL),
		sql.Named("css_selector", req.CSSSelector),
		sql.Named("strip_selectors", req.StripSelectors),
		sql.Named("check_interval", checkInterval),
		sql.Named("next_check_at", now),
		sql.Named("created_at", now),
		sql.Named("updated_at", now),
	).Scan(
		&p.ID, &groupID, &p.Name, &p.URL, &p.CSSSelector, &p.StripSelectors,
		&p.CheckInterval, &p.LastHash, &p.LastCheckedAt, &p.NextCheckAt,
		&activeInt, &p.LastStatus, &p.LastError, &unreadInt, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("create monitored page: %w", err)
	}
	if groupID.Valid {
		p.GroupID = &groupID.Int64
	}
	p.Active = activeInt == 1
	p.Unread = unreadInt == 1
	return p, nil
}

func (s *Store) GetMonitoredPage(userID int64, id int64) (*model.MonitoredPage, error) {
	query := `
		SELECT id, group_id, name, url, css_selector, strip_selectors,
			check_interval, last_hash, last_checked_at, next_check_at,
			active, last_status, last_error, unread, created_at, updated_at
		FROM monitored_pages WHERE id = :id AND user_id = :user_id
	`
	p := &model.MonitoredPage{}
	var groupID sql.NullInt64
	var activeInt, unreadInt int
	err := s.db.QueryRow(query, sql.Named("id", id), sql.Named("user_id", userID)).Scan(
		&p.ID, &groupID, &p.Name, &p.URL, &p.CSSSelector, &p.StripSelectors,
		&p.CheckInterval, &p.LastHash, &p.LastCheckedAt, &p.NextCheckAt,
		&activeInt, &p.LastStatus, &p.LastError, &unreadInt, &p.CreatedAt, &p.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get monitored page: %w", err)
	}
	if groupID.Valid {
		p.GroupID = &groupID.Int64
	}
	p.Active = activeInt == 1
	p.Unread = unreadInt == 1
	return p, nil
}

func (s *Store) ListMonitoredPages(userID int64, groupID *int64) ([]*model.MonitoredPage, error) {
	var query string
	var rows *sql.Rows
	var err error

	if groupID != nil {
		query = `
			SELECT id, group_id, name, url, css_selector, strip_selectors,
				check_interval, last_hash, last_checked_at, next_check_at,
				active, last_status, last_error, unread, created_at, updated_at
			FROM monitored_pages WHERE group_id = :group_id AND user_id = :user_id ORDER BY name ASC
		`
		rows, err = s.db.Query(query, sql.Named("group_id", *groupID), sql.Named("user_id", userID))
	} else {
		query = `
			SELECT id, group_id, name, url, css_selector, strip_selectors,
				check_interval, last_hash, last_checked_at, next_check_at,
				active, last_status, last_error, unread, created_at, updated_at
			FROM monitored_pages WHERE user_id = :user_id ORDER BY name ASC
		`
		rows, err = s.db.Query(query, sql.Named("user_id", userID))
	}

	if err != nil {
		return nil, fmt.Errorf("list monitored pages: %w", err)
	}
	defer rows.Close()

	var pages []*model.MonitoredPage
	for rows.Next() {
		p := &model.MonitoredPage{}
		var gID sql.NullInt64
		var activeInt, unreadInt int
		if err := rows.Scan(
			&p.ID, &gID, &p.Name, &p.URL, &p.CSSSelector, &p.StripSelectors,
			&p.CheckInterval, &p.LastHash, &p.LastCheckedAt, &p.NextCheckAt,
			&activeInt, &p.LastStatus, &p.LastError, &unreadInt, &p.CreatedAt, &p.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan monitored page: %w", err)
		}
		if gID.Valid {
			p.GroupID = &gID.Int64
		}
		p.Active = activeInt == 1
		p.Unread = unreadInt == 1
		pages = append(pages, p)
	}
	return pages, nil
}

func (s *Store) UpdateMonitoredPage(userID int64, id int64, req *model.UpdateMonitoredPageRequest) (*model.MonitoredPage, error) {
	page, err := s.GetMonitoredPage(userID, id)
	if err != nil {
		return nil, err
	}

	if req.GroupID != nil {
		if *req.GroupID == 0 {
			page.GroupID = nil
		} else {
			page.GroupID = req.GroupID
		}
	}
	if req.Name != nil {
		page.Name = *req.Name
	}
	if req.URL != nil {
		page.URL = *req.URL
	}
	if req.CSSSelector != nil {
		page.CSSSelector = *req.CSSSelector
	}
	if req.StripSelectors != nil {
		page.StripSelectors = *req.StripSelectors
	}
	if req.CheckInterval != nil {
		page.CheckInterval = *req.CheckInterval
	}
	if req.Active != nil {
		page.Active = *req.Active
	}

	now := time.Now().Unix()
	query := `
		UPDATE monitored_pages SET
			group_id = :group_id, name = :name, url = :url,
			css_selector = :css_selector, strip_selectors = :strip_selectors,
			check_interval = :check_interval, active = :active, updated_at = :updated_at
		WHERE id = :id AND user_id = :user_id
	`
	var groupID sql.NullInt64
	if page.GroupID != nil {
		groupID = sql.NullInt64{Int64: *page.GroupID, Valid: true}
	}
	activeInt := 0
	if page.Active {
		activeInt = 1
	}

	_, err = s.db.Exec(query,
		sql.Named("id", id),
		sql.Named("user_id", userID),
		sql.Named("group_id", groupID),
		sql.Named("name", page.Name),
		sql.Named("url", page.URL),
		sql.Named("css_selector", page.CSSSelector),
		sql.Named("strip_selectors", page.StripSelectors),
		sql.Named("check_interval", page.CheckInterval),
		sql.Named("active", activeInt),
		sql.Named("updated_at", now),
	)
	if err != nil {
		return nil, fmt.Errorf("update monitored page: %w", err)
	}

	return s.GetMonitoredPage(userID, id)
}

func (s *Store) DeleteMonitoredPage(userID int64, id int64) error {
	res, err := s.db.Exec(`DELETE FROM monitored_pages WHERE id = :id AND user_id = :user_id`, sql.Named("id", id), sql.Named("user_id", userID))
	if err != nil {
		return fmt.Errorf("delete monitored page: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) MarkMonitoredPageRead(userID int64, id int64, unread bool) error {
	unreadInt := 0
	if unread {
		unreadInt = 1
	}
	_, err := s.db.Exec(`UPDATE monitored_pages SET unread = :unread WHERE id = :id AND user_id = :user_id`,
		sql.Named("id", id),
		sql.Named("user_id", userID),
		sql.Named("unread", unreadInt),
	)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE page_snapshots SET unread = :unread WHERE page_id = :id AND user_id = :user_id`,
		sql.Named("id", id),
		sql.Named("user_id", userID),
		sql.Named("unread", unreadInt),
	)
	return err
}

func (s *Store) MarkPageSnapshotRead(userID int64, pageID int64, snapshotID int64, unread bool) error {
	unreadInt := 0
	if unread {
		unreadInt = 1
	}
	_, err := s.db.Exec(`UPDATE page_snapshots SET unread = :unread WHERE id = :snapshot_id AND page_id = :page_id AND user_id = :user_id`,
		sql.Named("snapshot_id", snapshotID),
		sql.Named("page_id", pageID),
		sql.Named("user_id", userID),
		sql.Named("unread", unreadInt),
	)
	if err != nil {
		return err
	}

	var unreadCount int
	err = s.db.QueryRow(`SELECT COUNT(*) FROM page_snapshots WHERE page_id = :page_id AND unread = 1 AND user_id = :user_id`,
		sql.Named("page_id", pageID),
		sql.Named("user_id", userID),
	).Scan(&unreadCount)
	if err != nil {
		return err
	}

	pageUnread := 0
	if unreadCount > 0 {
		pageUnread = 1
	}
	_, err = s.db.Exec(`UPDATE monitored_pages SET unread = :unread WHERE id = :page_id AND user_id = :user_id`,
		sql.Named("page_id", pageID),
		sql.Named("user_id", userID),
		sql.Named("unread", pageUnread),
	)
	return err
}

func (s *Store) ListAllDueMonitoredPages(now int64, limit int) ([]*model.MonitoredPage, error) {
	query := `
		SELECT id, user_id, group_id, name, url, css_selector, strip_selectors,
			check_interval, last_hash, last_checked_at, next_check_at,
			active, last_status, last_error, unread, created_at, updated_at
		FROM monitored_pages
		WHERE active = 1 AND next_check_at <= :now
		ORDER BY next_check_at ASC
		LIMIT :limit
	`
	rows, err := s.db.Query(query, sql.Named("now", now), sql.Named("limit", limit))
	if err != nil {
		return nil, fmt.Errorf("list all due monitored pages: %w", err)
	}
	defer rows.Close()

	var pages []*model.MonitoredPage
	for rows.Next() {
		p := &model.MonitoredPage{}
		var gID sql.NullInt64
		var activeInt, unreadInt int
		if err := rows.Scan(
			&p.ID, &p.UserID, &gID, &p.Name, &p.URL, &p.CSSSelector, &p.StripSelectors,
			&p.CheckInterval, &p.LastHash, &p.LastCheckedAt, &p.NextCheckAt,
			&activeInt, &p.LastStatus, &p.LastError, &unreadInt, &p.CreatedAt, &p.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan all due monitored page: %w", err)
		}
		if gID.Valid {
			p.GroupID = &gID.Int64
		}
		p.Active = activeInt == 1
		p.Unread = unreadInt == 1
		pages = append(pages, p)
	}
	return pages, nil
}

func (s *Store) ListDueMonitoredPages(userID int64, now int64, limit int) ([]*model.MonitoredPage, error) {
	query := `
		SELECT id, group_id, name, url, css_selector, strip_selectors,
			check_interval, last_hash, last_checked_at, next_check_at,
			active, last_status, last_error, unread, created_at, updated_at
		FROM monitored_pages
		WHERE active = 1 AND next_check_at <= :now AND user_id = :user_id
		ORDER BY next_check_at ASC
		LIMIT :limit
	`
	rows, err := s.db.Query(query, sql.Named("now", now), sql.Named("limit", limit), sql.Named("user_id", userID))
	if err != nil {
		return nil, fmt.Errorf("list due monitored pages: %w", err)
	}
	defer rows.Close()

	var pages []*model.MonitoredPage
	for rows.Next() {
		p := &model.MonitoredPage{}
		var gID sql.NullInt64
		var activeInt, unreadInt int
		if err := rows.Scan(
			&p.ID, &gID, &p.Name, &p.URL, &p.CSSSelector, &p.StripSelectors,
			&p.CheckInterval, &p.LastHash, &p.LastCheckedAt, &p.NextCheckAt,
			&activeInt, &p.LastStatus, &p.LastError, &unreadInt, &p.CreatedAt, &p.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan due monitored page: %w", err)
		}
		if gID.Valid {
			p.GroupID = &gID.Int64
		}
		p.Active = activeInt == 1
		p.Unread = unreadInt == 1
		pages = append(pages, p)
	}
	return pages, nil
}

func (s *Store) UpdateMonitoredPageCheckResult(userID int64, id int64, lastHash string, status int, lastErr string, hasChange bool) error {
	now := time.Now().Unix()
	page, err := s.GetMonitoredPage(userID, id)
	if err != nil {
		return err
	}

	nextCheck := now + int64(page.CheckInterval)
	unreadInt := 0
	if page.Unread || hasChange {
		unreadInt = 1
	}

	query := `
		UPDATE monitored_pages SET
			last_hash = :last_hash,
			last_checked_at = :last_checked_at,
			next_check_at = :next_check_at,
			last_status = :last_status,
			last_error = :last_error,
			unread = :unread,
			updated_at = :updated_at
		WHERE id = :id AND user_id = :user_id
	`
	_, err = s.db.Exec(query,
		sql.Named("id", id),
		sql.Named("user_id", userID),
		sql.Named("last_hash", lastHash),
		sql.Named("last_checked_at", now),
		sql.Named("next_check_at", nextCheck),
		sql.Named("last_status", status),
		sql.Named("last_error", lastErr),
		sql.Named("unread", unreadInt),
		sql.Named("updated_at", now),
	)
	return err
}

// Page Snapshot Operations

func (s *Store) CreatePageSnapshot(userID int64, snapshot *model.PageSnapshot) (*model.PageSnapshot, error) {
	now := time.Now().Unix()

	sectionsJSON := snapshot.SectionsJSON
	if sectionsJSON == "" && len(snapshot.Sections) > 0 {
		if data, err := json.Marshal(snapshot.Sections); err == nil {
			sectionsJSON = string(data)
		}
	}

	query := `
		INSERT INTO page_snapshots (
			user_id, page_id, hash, content_text, prev_content_text, diff_html, sections_json, has_change,
			added_count, removed_count, unread, created_at
		) VALUES (
			:user_id, :page_id, :hash, :content_text, :prev_content_text, :diff_html, :sections_json, :has_change,
			:added_count, :removed_count, :unread, :created_at
		)
		RETURNING id, page_id, hash, content_text, prev_content_text, diff_html, sections_json, has_change,
			added_count, removed_count, unread, created_at
	`
	hasChangeInt := 0
	if snapshot.HasChange {
		hasChangeInt = 1
	}
	unreadInt := 0
	if snapshot.HasChange || snapshot.Unread {
		unreadInt = 1
	}
	res := &model.PageSnapshot{}
	err := s.db.QueryRow(query,
		sql.Named("user_id", userID),
		sql.Named("page_id", snapshot.PageID),
		sql.Named("hash", snapshot.Hash),
		sql.Named("content_text", snapshot.ContentText),
		sql.Named("prev_content_text", snapshot.PrevContentText),
		sql.Named("diff_html", snapshot.DiffHTML),
		sql.Named("sections_json", sectionsJSON),
		sql.Named("has_change", hasChangeInt),
		sql.Named("added_count", snapshot.AddedCount),
		sql.Named("removed_count", snapshot.RemovedCount),
		sql.Named("unread", unreadInt),
		sql.Named("created_at", now),
	).Scan(
		&res.ID, &res.PageID, &res.Hash, &res.ContentText, &res.PrevContentText, &res.DiffHTML, &res.SectionsJSON,
		&hasChangeInt, &res.AddedCount, &res.RemovedCount, &unreadInt, &res.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("create page snapshot: %w", err)
	}
	res.HasChange = hasChangeInt == 1
	res.Unread = unreadInt == 1
	if res.SectionsJSON != "" {
		_ = json.Unmarshal([]byte(res.SectionsJSON), &res.Sections)
	}
	return res, nil
}

func (s *Store) ListPageSnapshots(userID int64, pageID int64, limit int) ([]*model.PageSnapshot, error) {
	if limit <= 0 {
		limit = 50
	}
	query := `
		SELECT id, page_id, hash, content_text, prev_content_text, diff_html, sections_json, has_change,
			added_count, removed_count, unread, created_at
		FROM page_snapshots
		WHERE page_id = :page_id AND user_id = :user_id
		ORDER BY created_at DESC
		LIMIT :limit
	`
	rows, err := s.db.Query(query, sql.Named("page_id", pageID), sql.Named("user_id", userID), sql.Named("limit", limit))
	if err != nil {
		return nil, fmt.Errorf("list page snapshots: %w", err)
	}
	defer rows.Close()

	var snapshots []*model.PageSnapshot
	for rows.Next() {
		snap := &model.PageSnapshot{}
		var hasChangeInt, unreadInt int
		if err := rows.Scan(
			&snap.ID, &snap.PageID, &snap.Hash, &snap.ContentText, &snap.PrevContentText, &snap.DiffHTML, &snap.SectionsJSON,
			&hasChangeInt, &snap.AddedCount, &snap.RemovedCount, &unreadInt, &snap.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan page snapshot: %w", err)
		}
		snap.HasChange = hasChangeInt == 1
		snap.Unread = unreadInt == 1
		if snap.SectionsJSON != "" {
			_ = json.Unmarshal([]byte(snap.SectionsJSON), &snap.Sections)
		}
		snapshots = append(snapshots, snap)
	}
	return snapshots, nil
}

func (s *Store) GetLatestPageSnapshot(userID int64, pageID int64) (*model.PageSnapshot, error) {
	query := `
		SELECT id, page_id, hash, content_text, prev_content_text, diff_html, sections_json, has_change,
			added_count, removed_count, unread, created_at
		FROM page_snapshots
		WHERE page_id = :page_id AND user_id = :user_id
		ORDER BY created_at DESC
		LIMIT 1
	`
	snap := &model.PageSnapshot{}
	var hasChangeInt, unreadInt int
	err := s.db.QueryRow(query, sql.Named("page_id", pageID), sql.Named("user_id", userID)).Scan(
		&snap.ID, &snap.PageID, &snap.Hash, &snap.ContentText, &snap.PrevContentText, &snap.DiffHTML, &snap.SectionsJSON,
		&hasChangeInt, &snap.AddedCount, &snap.RemovedCount, &unreadInt, &snap.CreatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get latest page snapshot: %w", err)
	}
	snap.HasChange = hasChangeInt == 1
	snap.Unread = unreadInt == 1
	if snap.SectionsJSON != "" {
		_ = json.Unmarshal([]byte(snap.SectionsJSON), &snap.Sections)
	}
	return snap, nil
}

func (s *Store) DeletePageSnapshot(userID int64, pageID int64, snapshotID int64) error {
	res, err := s.db.Exec(`DELETE FROM page_snapshots WHERE id = :snapshot_id AND page_id = :page_id AND user_id = :user_id`,
		sql.Named("snapshot_id", snapshotID),
		sql.Named("page_id", pageID),
		sql.Named("user_id", userID),
	)
	if err != nil {
		return fmt.Errorf("delete page snapshot: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return s.syncMonitoredPageUnread(userID, pageID)
}

func (s *Store) BatchDeletePageSnapshots(userID int64, pageID int64, snapshotIDs []int64) (int64, error) {
	if len(snapshotIDs) == 0 {
		return 0, nil
	}

	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`DELETE FROM page_snapshots WHERE id = ? AND page_id = ? AND user_id = ?`)
	if err != nil {
		return 0, err
	}
	defer stmt.Close()

	var totalDeleted int64
	for _, id := range snapshotIDs {
		res, err := stmt.Exec(id, pageID, userID)
		if err != nil {
			return totalDeleted, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			totalDeleted += n
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}

	_ = s.syncMonitoredPageUnread(userID, pageID)
	return totalDeleted, nil
}

func (s *Store) syncMonitoredPageUnread(userID int64, pageID int64) error {
	var unreadCount int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM page_snapshots WHERE page_id = :page_id AND unread = 1 AND user_id = :user_id`,
		sql.Named("page_id", pageID),
		sql.Named("user_id", userID),
	).Scan(&unreadCount)
	if err != nil {
		return err
	}

	pageUnread := 0
	if unreadCount > 0 {
		pageUnread = 1
	}
	_, err = s.db.Exec(`UPDATE monitored_pages SET unread = :unread WHERE id = :page_id AND user_id = :user_id`,
		sql.Named("page_id", pageID),
		sql.Named("user_id", userID),
		sql.Named("unread", pageUnread),
	)
	return err
}

func (s *Store) GetMaxPageSnapshotCreatedAt(userID int64) (int64, error) {
	var maxTime sql.NullInt64
	err := s.db.QueryRow(
		`SELECT MAX(created_at) FROM page_snapshots WHERE user_id = :user_id`,
		sql.Named("user_id", userID),
	).Scan(&maxTime)
	if err != nil {
		return 0, err
	}
	if !maxTime.Valid {
		return 0, nil
	}
	return maxTime.Int64, nil
}


