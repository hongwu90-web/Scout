package store

import (
	"errors"
	"testing"
)

func TestUserStore(t *testing.T) {
	store, _ := setupTestDB(t)
	defer closeStore(t, store)

	// Create user
	u1ID, err := store.CreateUser("alice", "hash123")
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}
	if u1ID == 0 {
		t.Fatal("expected non-zero user ID")
	}

	// Duplicate user fails
	_, err = store.CreateUser("alice", "hash456")
	if !errors.Is(err, ErrAlreadyExists) {
		t.Fatalf("expected ErrAlreadyExists on duplicate username, got: %v", err)
	}

	// Get by ID
	user, err := store.GetUserByID(u1ID)
	if err != nil {
		t.Fatalf("GetUserByID failed: %v", err)
	}
	if user.Username != "alice" || user.PasswordHash != "hash123" {
		t.Fatalf("unexpected user: %+v", user)
	}

	// Get by Username
	userByU, err := store.GetUserByUsername("alice")
	if err != nil {
		t.Fatalf("GetUserByUsername failed: %v", err)
	}
	if userByU.ID != u1ID {
		t.Fatalf("expected user ID %d, got %d", u1ID, userByU.ID)
	}

	// Set Fever key
	feverKey := "fever_api_key_abc"
	if err := store.SetFeverAPIKey(u1ID, feverKey); err != nil {
		t.Fatalf("SetFeverAPIKey failed: %v", err)
	}

	// Get by Fever key
	userByF, err := store.GetUserByFeverKey(feverKey)
	if err != nil {
		t.Fatalf("GetUserByFeverKey failed: %v", err)
	}
	if userByF.ID != u1ID {
		t.Fatalf("expected user ID %d, got %d", u1ID, userByF.ID)
	}

	// Non-existent lookups
	_, err = store.GetUserByID(99999)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for non-existent ID, got: %v", err)
	}

	_, err = store.GetUserByUsername("nonexistent")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for non-existent username, got: %v", err)
	}

	_, err = store.GetUserByFeverKey("nonexistent")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for non-existent fever key, got: %v", err)
	}
}

func TestUpdateUsername(t *testing.T) {
	store, _ := setupTestDB(t)
	defer closeStore(t, store)

	uid, err := store.CreateUser("bob", "hash_bob")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	// Rename to a fresh name.
	if err := store.UpdateUsername(uid, "bobby"); err != nil {
		t.Fatalf("UpdateUsername failed: %v", err)
	}
	u, _ := store.GetUserByID(uid)
	if u.Username != "bobby" {
		t.Fatalf("expected username bobby, got %s", u.Username)
	}

	// Rename to an already-taken name fails.
	uid2, _ := store.CreateUser("charlie", "hash_c")
	if err := store.UpdateUsername(uid2, "bobby"); !errors.Is(err, ErrAlreadyExists) {
		t.Fatalf("expected ErrAlreadyExists when username taken, got: %v", err)
	}
}

func TestUpdatePassword(t *testing.T) {
	store, _ := setupTestDB(t)
	defer closeStore(t, store)

	uid, err := store.CreateUser("dave", "old_hash")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	if err := store.UpdatePassword(uid, "new_hash", "new_fever"); err != nil {
		t.Fatalf("UpdatePassword failed: %v", err)
	}

	u, _ := store.GetUserByID(uid)
	if u.PasswordHash != "new_hash" {
		t.Fatalf("expected new_hash, got %s", u.PasswordHash)
	}
	if u.FeverAPIKey != "new_fever" {
		t.Fatalf("expected new_fever, got %s", u.FeverAPIKey)
	}
}

func TestEnsureUser_DoesNotOverwrite(t *testing.T) {
	store, _ := setupTestDB(t)
	defer closeStore(t, store)

	uid, err := store.EnsureUser("testadmin", "initial_hash")
	if err != nil {
		t.Fatalf("EnsureUser first call: %v", err)
	}

	// Simulate server restart: EnsureUser called again with a different hash.
	uid2, err := store.EnsureUser("testadmin", "different_hash")
	if err != nil {
		t.Fatalf("EnsureUser second call: %v", err)
	}
	if uid != uid2 {
		t.Fatalf("EnsureUser returned different ID on second call: %d vs %d", uid, uid2)
	}

	// The original hash must be preserved.
	u, _ := store.GetUserByID(uid)
	if u.PasswordHash != "initial_hash" {
		t.Fatalf("EnsureUser overwrote hash: got %s, want initial_hash", u.PasswordHash)
	}
}
