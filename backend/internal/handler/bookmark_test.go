package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/0x2E/fusion/internal/model"
)

func TestListBookmarksCursorPagination(t *testing.T) {
	h, st := newFeverTestHandler(t)

	group, err := st.CreateGroup(1, "Group 1")
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	feed, err := st.CreateFeed(1, group.ID, "Feed A", "https://example.com/feed", "https://example.com", "")
	if err != nil {
		t.Fatalf("CreateFeed: %v", err)
	}
	// created_at is non-decreasing across inserts and id is auto-increment, so
	// ORDER BY created_at DESC, id DESC is deterministic regardless of second
	// resolution: the page order is always [b3, b2, b1].
	b1, err := st.CreateBookmark(1, nil, &feed.ID, "https://example.com/b1", "B1", "C1", 100, feed.Name)
	if err != nil {
		t.Fatalf("CreateBookmark 1: %v", err)
	}
	b2, err := st.CreateBookmark(1, nil, &feed.ID, "https://example.com/b2", "B2", "C2", 200, feed.Name)
	if err != nil {
		t.Fatalf("CreateBookmark 2: %v", err)
	}
	b3, err := st.CreateBookmark(1, nil, &feed.ID, "https://example.com/b3", "B3", "C3", 300, feed.Name)
	if err != nil {
		t.Fatalf("CreateBookmark 3: %v", err)
	}

	r := newTestRouter()
	r.GET("/api/bookmarks", h.listBookmarks)

	// First page: no cursor, expect the 2 newest bookmarks and a non-null next_cursor.
	w := performRequest(r, http.MethodGet, "/api/bookmarks?limit=2", nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d (body=%s)", w.Code, w.Body.String())
	}
	var page struct {
		Data       []model.Bookmark `json:"data"`
		Total      int              `json:"total"`
		NextCursor *string          `json:"next_cursor"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(page.Data) != 2 {
		t.Fatalf("expected 2 bookmarks on first page, got %d", len(page.Data))
	}
	if page.Data[0].ID != b3.ID || page.Data[1].ID != b2.ID {
		t.Errorf("expected first page [b3, b2], got ids [%d, %d]", page.Data[0].ID, page.Data[1].ID)
	}
	if page.Total != 3 {
		t.Errorf("expected total=3, got %d", page.Total)
	}
	if page.NextCursor == nil {
		t.Fatal("expected non-null next_cursor on a full first page")
	}
	last := page.Data[len(page.Data)-1]
	wantCursor := fmt.Sprintf("%d_%d", last.CreatedAt, last.ID)
	if *page.NextCursor != wantCursor {
		t.Errorf("expected next_cursor %q, got %q", wantCursor, *page.NextCursor)
	}

	// Second page: use the cursor, expect the remaining bookmark and a null next_cursor.
	w = performRequest(r, http.MethodGet, "/api/bookmarks?limit=2&before="+*page.NextCursor, nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d (body=%s)", w.Code, w.Body.String())
	}
	page = struct {
		Data       []model.Bookmark `json:"data"`
		Total      int              `json:"total"`
		NextCursor *string          `json:"next_cursor"`
	}{}
	if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(page.Data) != 1 || page.Data[0].ID != b1.ID {
		t.Errorf("expected second page [b1], got %+v", page.Data)
	}
	if page.NextCursor != nil {
		t.Errorf("expected null next_cursor on final page, got %q", *page.NextCursor)
	}
}

func TestListBookmarksCursorInvalidBefore(t *testing.T) {
	h, _ := newFeverTestHandler(t)

	r := newTestRouter()
	r.GET("/api/bookmarks", h.listBookmarks)

	w := performRequest(r, http.MethodGet, "/api/bookmarks?before=not-a-cursor", nil, nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400 for malformed cursor, got %d", w.Code)
	}
}

func TestBatchBookmarks(t *testing.T) {
	h, st := newFeverTestHandler(t)

	group, err := st.CreateGroup(1, "Group Batch")
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	feed, err := st.CreateFeed(1, group.ID, "Feed Batch", "https://example.com/feed-batch", "https://example.com", "")
	if err != nil {
		t.Fatalf("CreateFeed: %v", err)
	}

	item1, err := st.CreateItem(1, feed.ID, "item-1", "Item 1", "https://example.com/1", "C1", 100)
	if err != nil {
		t.Fatalf("CreateItem 1: %v", err)
	}
	item2, err := st.CreateItem(1, feed.ID, "item-2", "Item 2", "https://example.com/2", "C2", 200)
	if err != nil {
		t.Fatalf("CreateItem 2: %v", err)
	}

	r := newTestRouter()
	r.POST("/api/bookmarks/batch", h.batchCreateBookmarks)
	r.POST("/api/bookmarks/batch-delete", h.batchDeleteBookmarks)

	// Batch create bookmarks
	body := map[string]any{"item_ids": []int64{item1.ID, item2.ID}}
	w := performRequest(r, http.MethodPost, "/api/bookmarks/batch", mustJSONBody(t, body), nil)
	if w.Code != http.StatusNoContent {
		t.Fatalf("expected status 204, got %d (body=%s)", w.Code, w.Body.String())
	}

	savedIDs, err := st.ListSavedItemIDs(1)
	if err != nil {
		t.Fatalf("ListSavedItemIDs: %v", err)
	}
	if len(savedIDs) != 2 {
		t.Fatalf("expected 2 saved items, got %d", len(savedIDs))
	}

	// Batch delete bookmarks
	w = performRequest(r, http.MethodPost, "/api/bookmarks/batch-delete", mustJSONBody(t, body), nil)
	if w.Code != http.StatusNoContent {
		t.Fatalf("expected status 204, got %d", w.Code)
	}

	savedIDs, err = st.ListSavedItemIDs(1)
	if err != nil {
		t.Fatalf("ListSavedItemIDs: %v", err)
	}
	if len(savedIDs) != 0 {
		t.Fatalf("expected 0 saved items, got %d", len(savedIDs))
	}
}
