package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/0x2E/fusion/internal/model"
)

func TestLabelsCRUDAndBatch(t *testing.T) {
	h, st := newFeverTestHandler(t)

	group, err := st.CreateGroup(1, "Group L")
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	feed, err := st.CreateFeed(1, group.ID, "Feed L", "https://example.com/feed-l", "https://example.com", "")
	if err != nil {
		t.Fatalf("CreateFeed: %v", err)
	}

	item1, err := st.CreateItem(1, feed.ID, "item-l1", "Item L1", "https://example.com/l1", "C1", 100)
	if err != nil {
		t.Fatalf("CreateItem 1: %v", err)
	}
	item2, err := st.CreateItem(1, feed.ID, "item-l2", "Item L2", "https://example.com/l2", "C2", 200)
	if err != nil {
		t.Fatalf("CreateItem 2: %v", err)
	}

	r := newTestRouter()
	r.GET("/api/labels", h.listLabels)
	r.POST("/api/labels", h.createLabel)
	r.DELETE("/api/labels/:id", h.deleteLabel)
	r.POST("/api/items/labels/batch", h.batchUpdateItemLabels)
	r.POST("/api/items/labels", h.getItemLabels)

	// 1. Create label
	createBody := map[string]any{"name": "Priority", "color": "#ef4444"}
	w := performRequest(r, http.MethodPost, "/api/labels", mustJSONBody(t, createBody), nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d (body=%s)", w.Code, w.Body.String())
	}

	var createResp struct {
		Data model.Label `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("unmarshal create label: %v", err)
	}
	labelID := createResp.Data.ID
	if labelID == 0 || createResp.Data.Name != "Priority" {
		t.Fatalf("unexpected label data: %+v", createResp.Data)
	}

	// 2. List labels
	w = performRequest(r, http.MethodGet, "/api/labels", nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}
	var listResp struct {
		Data []model.Label `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("unmarshal list labels: %v", err)
	}
	if len(listResp.Data) != 1 {
		t.Fatalf("expected 1 label, got %d", len(listResp.Data))
	}

	// 3. Batch attach label
	attachBody := map[string]any{
		"label_id": labelID,
		"item_ids": []int64{item1.ID, item2.ID},
		"action":   "attach",
	}
	w = performRequest(r, http.MethodPost, "/api/items/labels/batch", mustJSONBody(t, attachBody), nil)
	if w.Code != http.StatusNoContent {
		t.Fatalf("expected status 204 on attach, got %d", w.Code)
	}

	// 4. Get item labels
	getItemsLabelsBody := map[string]any{
		"item_ids": []int64{item1.ID, item2.ID},
	}
	w = performRequest(r, http.MethodPost, "/api/items/labels", mustJSONBody(t, getItemsLabelsBody), nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200 on getItemLabels, got %d", w.Code)
	}
	var itemLabelsResp struct {
		Data map[string][]int64 `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &itemLabelsResp); err != nil {
		t.Fatalf("unmarshal item labels: %v", err)
	}
	if len(itemLabelsResp.Data) != 2 {
		t.Fatalf("expected 2 items in item labels map, got %d", len(itemLabelsResp.Data))
	}

	// 5. Batch detach label from 1 item
	detachBody := map[string]any{
		"label_id": labelID,
		"item_ids": []int64{item1.ID},
		"action":   "detach",
	}
	w = performRequest(r, http.MethodPost, "/api/items/labels/batch", mustJSONBody(t, detachBody), nil)
	if w.Code != http.StatusNoContent {
		t.Fatalf("expected status 204 on detach, got %d", w.Code)
	}

	// 6. Delete label
	w = performRequest(r, http.MethodDelete, "/api/labels/1", nil, nil)
	if w.Code != http.StatusNoContent {
		t.Fatalf("expected status 204 on delete, got %d", w.Code)
	}
}
