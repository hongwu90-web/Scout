package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/0x2E/fusion/internal/model"
)

func TestBatchDeletePageSnapshots(t *testing.T) {
	h, st := newFeverTestHandler(t)

	page, err := st.CreateMonitoredPage(1, &model.CreateMonitoredPageRequest{
		Name:          "Test Page",
		URL:           "https://example.com",
		CheckInterval: 300,
	})
	if err != nil {
		t.Fatalf("CreateMonitoredPage: %v", err)
	}

	snap1, err := st.CreatePageSnapshot(1, &model.PageSnapshot{
		PageID:      page.ID,
		Hash:        "hash1",
		ContentText: "content 1",
		HasChange:   true,
		Unread:      true,
	})
	if err != nil {
		t.Fatalf("CreatePageSnapshot 1: %v", err)
	}

	snap2, err := st.CreatePageSnapshot(1, &model.PageSnapshot{
		PageID:      page.ID,
		Hash:        "hash2",
		ContentText: "content 2",
		HasChange:   true,
		Unread:      true,
	})
	if err != nil {
		t.Fatalf("CreatePageSnapshot 2: %v", err)
	}

	snap3, err := st.CreatePageSnapshot(1, &model.PageSnapshot{
		PageID:      page.ID,
		Hash:        "hash3",
		ContentText: "content 3",
		HasChange:   false,
		Unread:      false,
	})
	if err != nil {
		t.Fatalf("CreatePageSnapshot 3: %v", err)
	}

	r := newTestRouter()
	r.POST("/api/monitored-pages/:id/snapshots/delete", h.batchDeletePageSnapshots)
	r.DELETE("/api/monitored-pages/:id/snapshots", h.batchDeletePageSnapshots)
	r.DELETE("/api/monitored-pages/:id/snapshots/:snapshotId", h.deletePageSnapshot)

	// Test POST /api/monitored-pages/:id/snapshots/delete with snap1 and snap2
	reqBody := mustJSONBody(t, map[string]any{
		"ids": []int64{snap1.ID, snap2.ID},
	})
	w := performRequest(r, http.MethodPost, fmt.Sprintf("/api/monitored-pages/%d/snapshots/delete", page.ID), reqBody, map[string]string{
		"Content-Type": "application/json",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d (body=%s)", w.Code, w.Body.String())
	}

	var res struct {
		Data struct {
			Deleted int64 `json:"deleted"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if res.Data.Deleted != 2 {
		t.Fatalf("expected 2 deleted snapshots, got %d", res.Data.Deleted)
	}

	// Verify remaining snapshots list
	remaining, err := st.ListPageSnapshots(1, page.ID, 50)
	if err != nil {
		t.Fatalf("ListPageSnapshots: %v", err)
	}
	if len(remaining) != 1 {
		t.Fatalf("expected 1 remaining snapshot, got %d", len(remaining))
	}
	if remaining[0].ID != snap3.ID {
		t.Fatalf("expected remaining snapshot id %d, got %d", snap3.ID, remaining[0].ID)
	}

	// Test single delete
	wSingle := performRequest(r, http.MethodDelete, fmt.Sprintf("/api/monitored-pages/%d/snapshots/%d", page.ID, snap3.ID), nil, nil)
	if wSingle.Code != http.StatusNoContent {
		t.Fatalf("expected status 204 for single delete, got %d", wSingle.Code)
	}

	remainingAfter, err := st.ListPageSnapshots(1, page.ID, 50)
	if err != nil {
		t.Fatalf("ListPageSnapshots after single delete: %v", err)
	}
	if len(remainingAfter) != 0 {
		t.Fatalf("expected 0 remaining snapshots, got %d", len(remainingAfter))
	}
}
