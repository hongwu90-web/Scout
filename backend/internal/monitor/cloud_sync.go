package monitor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/0x2E/fusion/internal/config"
	"github.com/0x2E/fusion/internal/model"
	"github.com/0x2E/fusion/internal/store"
)

type CloudSync struct {
	store  *store.Store
	cfg    *config.Config
	client *http.Client
}

type cloudPushPayload struct {
	Monitors []cloudMonitorItem `json:"monitors"`
}

type cloudMonitorItem struct {
	ID             int64  `json:"id"`
	Name           string `json:"name"`
	URL            string `json:"url"`
	CSSSelector    string `json:"css_selector"`
	StripSelectors string `json:"strip_selectors"`
	CheckInterval  int64  `json:"check_interval"`
	IsActive       bool   `json:"is_active"`
}

type cloudPullResponse struct {
	Data       []cloudSnapshotItem `json:"data"`
	ServerTime int64               `json:"server_time"`
}

type cloudSnapshotItem struct {
	ID              int64  `json:"id"`
	UserID          int64  `json:"user_id"`
	PageID          int64  `json:"page_id"`
	Hash            string `json:"hash"`
	ContentText     string `json:"content_text"`
	PrevContentText string `json:"prev_content_text"`
	DiffHTML        string `json:"diff_html"`
	Sections        string `json:"sections"`
	HasChange       int    `json:"has_change"`
	AddedCount      int    `json:"added_count"`
	RemovedCount    int    `json:"removed_count"`
	Unread          int    `json:"unread"`
	CreatedAt       int64  `json:"created_at"`
}

func NewCloudSync(st *store.Store, cfg *config.Config) *CloudSync {
	return &CloudSync{
		store:  st,
		cfg:    cfg,
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *CloudSync) IsEnabled() bool {
	return c.cfg.CloudMonitorEnabled && c.cfg.CloudMonitorURL != ""
}

// PushMonitors sends local monitor targets to the Cloudflare Worker D1 registry.
func (c *CloudSync) PushMonitors(ctx context.Context, userID int64) error {
	if !c.IsEnabled() {
		return nil
	}

	pages, err := c.store.ListMonitoredPages(userID, nil)
	if err != nil {
		return fmt.Errorf("list monitored pages: %w", err)
	}

	var items []cloudMonitorItem
	for _, p := range pages {
		items = append(items, cloudMonitorItem{
			ID:             p.ID,
			Name:           p.Name,
			URL:            p.URL,
			CSSSelector:    p.CSSSelector,
			StripSelectors: p.StripSelectors,
			CheckInterval:  int64(p.CheckInterval),
			IsActive:       p.Active,
		})
	}

	payload := cloudPushPayload{Monitors: items}
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	url := fmt.Sprintf("%s/api/sync/push", c.cfg.CloudMonitorURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("create push request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if c.cfg.CloudMonitorSecret != "" {
		req.Header.Set("Authorization", "Bearer "+c.cfg.CloudMonitorSecret)
		req.Header.Set("X-Scout-Sync-Key", c.cfg.CloudMonitorSecret)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("push to cloud: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("cloud push returned %d: %s", resp.StatusCode, string(b))
	}

	slog.Info("monitors synchronized to cloud monitor successfully", "count", len(items))
	return nil
}

// PullSnapshots downloads new snapshots collected by the Cloudflare Worker while Scout was offline.
func (c *CloudSync) PullSnapshots(ctx context.Context, userID int64) (int, error) {
	if !c.IsEnabled() {
		return 0, nil
	}

	// Determine latest local snapshot timestamp for this user
	maxCreatedAt, _ := c.store.GetMaxPageSnapshotCreatedAt(userID)

	url := fmt.Sprintf("%s/api/sync/pull?since=%d&limit=200", c.cfg.CloudMonitorURL, maxCreatedAt)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, fmt.Errorf("create pull request: %w", err)
	}

	if c.cfg.CloudMonitorSecret != "" {
		req.Header.Set("Authorization", "Bearer "+c.cfg.CloudMonitorSecret)
		req.Header.Set("X-Scout-Sync-Key", c.cfg.CloudMonitorSecret)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("pull from cloud: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return 0, fmt.Errorf("cloud pull returned %d: %s", resp.StatusCode, string(b))
	}

	var pullRes cloudPullResponse
	if err := json.NewDecoder(resp.Body).Decode(&pullRes); err != nil {
		return 0, fmt.Errorf("decode cloud pull response: %w", err)
	}

	if len(pullRes.Data) == 0 {
		return 0, nil
	}

	imported := 0
	for _, snapItem := range pullRes.Data {
		// Check if local page exists
		page, err := c.store.GetMonitoredPage(userID, snapItem.PageID)
		if err != nil || page == nil {
			continue
		}

		var sections []model.SectionChange
		if snapItem.Sections != "" {
			_ = json.Unmarshal([]byte(snapItem.Sections), &sections)
		}

		snap := &model.PageSnapshot{
			PageID:          snapItem.PageID,
			Hash:            snapItem.Hash,
			ContentText:     snapItem.ContentText,
			PrevContentText: snapItem.PrevContentText,
			DiffHTML:        snapItem.DiffHTML,
			Sections:        sections,
			HasChange:       snapItem.HasChange != 0,
			AddedCount:      snapItem.AddedCount,
			RemovedCount:    snapItem.RemovedCount,
			Unread:          true,
		}

		// Insert snapshot into local SQLite
		newSnap, err := c.store.CreatePageSnapshot(userID, snap)
		if err != nil {
			slog.Warn("failed to save pulled snapshot", "page_id", snapItem.PageID, "error", err)
			continue
		}

		// Update local monitored page last_hash and status
		_ = c.store.UpdateMonitoredPageCheckResult(userID, snapItem.PageID, snapItem.Hash, 200, "", false)
		imported++
		slog.Info("imported cloud snapshot into local scout", "snapshot_id", newSnap.ID, "page_name", page.Name)
	}

	slog.Info("cloud monitor sync completed", "new_snapshots_imported", imported)
	return imported, nil
}

// FullSync performs a 2-way sync: pushes monitor configs and pulls new snapshots.
func (c *CloudSync) FullSync(ctx context.Context, userID int64) (int, error) {
	if !c.IsEnabled() {
		return 0, nil
	}

	if err := c.PushMonitors(ctx, userID); err != nil {
		slog.Warn("cloud sync push failed", "error", err)
	}

	return c.PullSnapshots(ctx, userID)
}
