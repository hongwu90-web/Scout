package store

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/0x2E/fusion/internal/model"
)

func (s *Store) ListLabels(userID int64) ([]*model.Label, error) {
	rows, err := s.db.Query(`
		SELECT id, user_id, name, color, created_at, updated_at
		FROM labels
		WHERE user_id = :user_id
		ORDER BY name ASC
	`, sql.Named("user_id", userID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	labels := []*model.Label{}
	for rows.Next() {
		l := &model.Label{}
		if err := rows.Scan(&l.ID, &l.UserID, &l.Name, &l.Color, &l.CreatedAt, &l.UpdatedAt); err != nil {
			return nil, err
		}
		labels = append(labels, l)
	}
	return labels, rows.Err()
}

func (s *Store) CreateLabel(userID int64, name, color string) (*model.Label, error) {
	if color == "" {
		color = "#3b82f6"
	}

	result, err := s.db.Exec(`
		INSERT INTO labels (user_id, name, color)
		VALUES (:user_id, :name, :color)
	`, sql.Named("user_id", userID), sql.Named("name", name), sql.Named("color", color))
	if err != nil {
		return nil, err
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}

	l := &model.Label{}
	err = s.db.QueryRow(`
		SELECT id, user_id, name, color, created_at, updated_at
		FROM labels
		WHERE id = :id AND user_id = :user_id
	`, sql.Named("id", id), sql.Named("user_id", userID)).Scan(&l.ID, &l.UserID, &l.Name, &l.Color, &l.CreatedAt, &l.UpdatedAt)
	if err != nil {
		return nil, err
	}

	return l, nil
}

func (s *Store) DeleteLabel(userID int64, id int64) error {
	result, err := s.db.Exec(`DELETE FROM labels WHERE id = :id AND user_id = :user_id`, sql.Named("id", id), sql.Named("user_id", userID))
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("%w: label", ErrNotFound)
	}
	return nil
}

func (s *Store) BatchAttachLabel(userID int64, labelID int64, itemIDs []int64) error {
	if len(itemIDs) == 0 {
		return nil
	}

	// Verify label belongs to user
	var exists bool
	err := s.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM labels WHERE id = :id AND user_id = :user_id)`,
		sql.Named("id", labelID), sql.Named("user_id", userID)).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return errors.New("label not found")
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`INSERT OR IGNORE INTO item_labels (item_id, label_id) VALUES (?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, itemID := range itemIDs {
		if _, err := stmt.Exec(itemID, labelID); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *Store) BatchDetachLabel(userID int64, labelID int64, itemIDs []int64) error {
	if len(itemIDs) == 0 {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`DELETE FROM item_labels WHERE label_id = ? AND item_id = ?`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, itemID := range itemIDs {
		if _, err := stmt.Exec(labelID, itemID); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *Store) GetItemLabels(itemIDs []int64) (map[int64][]int64, error) {
	result := make(map[int64][]int64)
	if len(itemIDs) == 0 {
		return result, nil
	}

	for _, id := range itemIDs {
		result[id] = []int64{}
	}

	query := `SELECT item_id, label_id FROM item_labels WHERE item_id IN (`
	args := make([]any, len(itemIDs))
	for i, id := range itemIDs {
		if i > 0 {
			query += ","
		}
		query += "?"
		args[i] = id
	}
	query += `)`

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var itemID, labelID int64
		if err := rows.Scan(&itemID, &labelID); err != nil {
			return nil, err
		}
		result[itemID] = append(result[itemID], labelID)
	}

	return result, rows.Err()
}
