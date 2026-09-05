package store

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/0x2E/fusion/internal/model"
)

func (s *Store) CreateUser(username, passwordHash string) (int64, error) {
	result, err := s.db.Exec(`
		INSERT INTO users (username, password_hash)
		VALUES (:username, :password_hash)
	`, sql.Named("username", username), sql.Named("password_hash", passwordHash))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return 0, ErrAlreadyExists
		}
		return 0, err
	}

	return result.LastInsertId()
}

func (s *Store) GetUserByID(id int64) (model.User, error) {
	var u model.User
	err := s.db.QueryRow(`
		SELECT id, username, password_hash, fever_api_key, created_at, updated_at
		FROM users
		WHERE id = :id
	`, sql.Named("id", id)).Scan(
		&u.ID, &u.Username, &u.PasswordHash, &u.FeverAPIKey, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return u, ErrNotFound
		}
		return u, err
	}
	return u, nil
}

func (s *Store) GetUserByUsername(username string) (model.User, error) {
	var u model.User
	err := s.db.QueryRow(`
		SELECT id, username, password_hash, fever_api_key, created_at, updated_at
		FROM users
		WHERE username = :username
	`, sql.Named("username", username)).Scan(
		&u.ID, &u.Username, &u.PasswordHash, &u.FeverAPIKey, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return u, ErrNotFound
		}
		return u, err
	}
	return u, nil
}

func (s *Store) GetUserByFeverKey(apiKey string) (model.User, error) {
	var u model.User
	err := s.db.QueryRow(`
		SELECT id, username, password_hash, fever_api_key, created_at, updated_at
		FROM users
		WHERE fever_api_key = :fever_api_key
	`, sql.Named("fever_api_key", apiKey)).Scan(
		&u.ID, &u.Username, &u.PasswordHash, &u.FeverAPIKey, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return u, ErrNotFound
		}
		return u, err
	}
	return u, nil
}

func (s *Store) SetFeverAPIKey(userID int64, apiKey string) error {
	_, err := s.db.Exec(`
		UPDATE users
		SET fever_api_key = :fever_api_key, updated_at = strftime('%s', 'now')
		WHERE id = :id
	`, sql.Named("fever_api_key", apiKey), sql.Named("id", userID))
	return err
}

// EnsureUser inserts the user if they do not already exist.
// It intentionally does NOT overwrite an existing user's password so that
// a manually-changed password survives server restarts.
func (s *Store) EnsureUser(username, passwordHash string) (int64, error) {
	var id int64
	err := s.db.QueryRow(`
		SELECT id FROM users WHERE username = :username
	`, sql.Named("username", username)).Scan(&id)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return s.CreateUser(username, passwordHash)
		}
		return 0, err
	}

	// User already exists – do nothing (insert-or-skip semantics).
	return id, nil
}

// UpdateUsername changes the username for the given user.
// Returns ErrAlreadyExists if the new username is already taken.
func (s *Store) UpdateUsername(userID int64, newUsername string) error {
	_, err := s.db.Exec(`
		UPDATE users
		SET username = :username, updated_at = unixepoch()
		WHERE id = :id
	`, sql.Named("username", newUsername), sql.Named("id", userID))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return ErrAlreadyExists
		}
		return err
	}
	return nil
}

// UpdatePassword sets a new bcrypt password hash and re-derives the Fever API key.
func (s *Store) UpdatePassword(userID int64, newHash, newFeverKey string) error {
	_, err := s.db.Exec(`
		UPDATE users
		SET password_hash = :password_hash,
		    fever_api_key = :fever_api_key,
		    updated_at    = unixepoch()
		WHERE id = :id
	`, sql.Named("password_hash", newHash),
		sql.Named("fever_api_key", newFeverKey),
		sql.Named("id", userID))
	return err
}
