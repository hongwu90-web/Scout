// Package store provides data access layer for Fusion RSS reader.
//
// All timestamps are stored as Unix epoch seconds (INTEGER in SQLite).
// Boolean fields are stored as INTEGER (0/1) and converted to/from Go bool.
// Named SQL parameters (:param_name) are used throughout for safety.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"

	"modernc.org/sqlite"
)

type Store struct {
	db      *sql.DB
	writeMu sync.Mutex
}

var sqliteHookOnce sync.Once

func New(dbPath string) (*Store, error) {
	sqliteHookOnce.Do(func() {
		sqlite.RegisterConnectionHook(func(conn sqlite.ExecQuerierContext, _ string) error {
			ctx := context.Background()
			if _, err := conn.ExecContext(ctx, "PRAGMA foreign_keys = ON", nil); err != nil {
				return fmt.Errorf("enable foreign_keys: %w", err)
			}
			if _, err := conn.ExecContext(ctx, "PRAGMA busy_timeout = 10000", nil); err != nil {
				return fmt.Errorf("set busy_timeout: %w", err)
			}
			if _, err := conn.ExecContext(ctx, "PRAGMA journal_mode = WAL", nil); err != nil {
				return fmt.Errorf("set journal_mode: %w", err)
			}
			if _, err := conn.ExecContext(ctx, "PRAGMA synchronous = NORMAL", nil); err != nil {
				return fmt.Errorf("set synchronous: %w", err)
			}
			return nil
		})
	})

	if err := prepareLegacyDatabase(dbPath); err != nil {
		return nil, fmt.Errorf("prepare legacy database: %w", err)
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	db.SetMaxOpenConns(50)
	db.SetMaxIdleConns(25)

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrate database: %w", err)
	}
	if err := s.initAppStateTable(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("init app_state table: %w", err)
	}

	// Clean up duplicate items between legacy user_id=0 and user_id=1, then assign everything to user_id=1
	_, _ = s.db.Exec(`
		DELETE FROM items 
		WHERE (user_id = 0 OR user_id IS NULL)
		  AND EXISTS (
			SELECT 1 FROM items i1 
			WHERE i1.user_id = 1 AND i1.feed_id = items.feed_id AND i1.guid = items.guid
		  );
	`)
	_, _ = s.db.Exec(`UPDATE items SET user_id = 1 WHERE user_id IS NULL OR user_id = 0;`)
	_, _ = s.db.Exec(`UPDATE feeds SET user_id = 1 WHERE user_id IS NULL OR user_id = 0;`)
	_, _ = s.db.Exec(`UPDATE groups SET user_id = 1 WHERE user_id IS NULL OR user_id = 0;`)
	_, _ = s.db.Exec(`UPDATE bookmarks SET user_id = 1 WHERE user_id IS NULL OR user_id = 0;`)
	_, _ = s.db.Exec(`UPDATE monitored_groups SET user_id = 1 WHERE user_id IS NULL OR user_id = 0;`)
	_, _ = s.db.Exec(`UPDATE monitored_pages SET user_id = 1 WHERE user_id IS NULL OR user_id = 0;`)
	_, _ = s.db.Exec(`UPDATE page_snapshots SET user_id = 1 WHERE user_id IS NULL OR user_id = 0;`)

	return s, nil
}

func (s *Store) initAppStateTable() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS app_state (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at INTEGER NOT NULL DEFAULT (unixepoch())
		);
	`)
	return err
}

func (s *Store) GetAppState(key string) (string, error) {
	var val string
	err := s.db.QueryRow("SELECT value FROM app_state WHERE key = ?", key).Scan(&val)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	return val, nil
}

func (s *Store) SetAppState(key string, val string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_, err := s.db.Exec(`
		INSERT INTO app_state (key, value, updated_at)
		VALUES (?, ?, unixepoch())
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = excluded.updated_at
	`, key, val)
	return err
}

func (s *Store) Close() error {
	return s.db.Close()
}
