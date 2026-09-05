package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/0x2E/fusion/internal/model"
)

func TestFocusFeedEndpoints(t *testing.T) {
	h, st := newFeverTestHandler(t)

	group, err := st.CreateGroup(1, "Group 1")
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	feed, err := st.CreateFeed(1, group.ID, "Reuters", "https://example.com/rss", "https://example.com", "")
	if err != nil {
		t.Fatalf("CreateFeed: %v", err)
	}
	_, err = st.CreateItem(1, feed.ID, "guid-1", "Nvidia and TSMC report record chip demand", "https://example.com/1", "semiconductor packaging", 100)
	if err != nil {
		t.Fatalf("CreateItem: %v", err)
	}

	r := newTestRouter()
	r.GET("/api/focus-feeds", h.listFocusFeeds)
	r.POST("/api/focus-feeds", h.createFocusFeed)
	r.GET("/api/focus-feeds/:id", h.getFocusFeed)
	r.PATCH("/api/focus-feeds/:id", h.updateFocusFeed)
	r.DELETE("/api/focus-feeds/:id", h.deleteFocusFeed)
	r.GET("/api/focus-feeds/:id/items", h.listFocusFeedItems)

	// 1. Create Focus Feed
	createPayload := map[string]any{
		"name":     "Chips Focus",
		"keywords": "TSMC, Nvidia, semiconductor",
		"group_id": group.ID,
		"icon":     "cpu",
	}
	w := performRequest(r, http.MethodPost, "/api/focus-feeds", mustJSONBody(t, createPayload), nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var createResp struct {
		Data model.FocusFeed `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("unmarshal create response: %v", err)
	}
	if createResp.Data.Name != "Chips Focus" || createResp.Data.UnreadCount != 1 {
		t.Errorf("unexpected created focus feed: %+v", createResp.Data)
	}

	// 2. List Focus Feeds
	w = performRequest(r, http.MethodGet, "/api/focus-feeds", nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	// 3. List Focus Feed Items
	itemsURL := fmt.Sprintf("/api/focus-feeds/%d/items", createResp.Data.ID)
	w = performRequest(r, http.MethodGet, itemsURL, nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for items, got %d: %s", w.Code, w.Body.String())
	}

	var itemsResp struct {
		Data  []model.Item `json:"data"`
		Total int          `json:"total"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &itemsResp); err != nil {
		t.Fatalf("unmarshal items response: %v", err)
	}
	if len(itemsResp.Data) != 1 {
		t.Errorf("expected 1 item, got %d", len(itemsResp.Data))
	}

	// 4. Delete Focus Feed
	deleteURL := fmt.Sprintf("/api/focus-feeds/%d", createResp.Data.ID)
	w = performRequest(r, http.MethodDelete, deleteURL, nil, nil)
	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content, got %d: %s", w.Code, w.Body.String())
	}
}
