package pull

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/0x2E/fusion/internal/config"
	"github.com/0x2E/fusion/internal/store"
)

type CloudFeedSync struct {
	store      *store.Store
	cfg        *config.Config
	client     *http.Client
	mu         sync.Mutex
	lastSyncAt int64
}

type cloudFeedPushPayload struct {
	Feeds []cloudFeedPushItem `json:"feeds"`
}

type cloudFeedPushItem struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Link     string `json:"link"`
	IsActive bool   `json:"is_active"`
}

type cloudFeedPullResponse struct {
	Data       []cloudFeedPullItem `json:"data"`
	MaxID      int64               `json:"max_id"`
	Count      int                 `json:"count"`
	ServerTime int64               `json:"server_time"`
}

type cloudFeedPullItem struct {
	ID        int64  `json:"id"`
	UserID    int64  `json:"user_id"`
	FeedID    int64  `json:"feed_id"`
	GUID      string `json:"guid"`
	Title     string `json:"title"`
	Link      string `json:"link"`
	Content   string `json:"content"`
	PubDate   int64  `json:"pub_date"`
	CreatedAt int64  `json:"created_at"`
}

func NewCloudFeedSync(st *store.Store, cfg *config.Config) *CloudFeedSync {
	return &CloudFeedSync{
		store:  st,
		cfg:    cfg,
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *CloudFeedSync) IsEnabled() bool {
	return c.cfg.CloudMonitorEnabled && c.cfg.CloudMonitorURL != ""
}

// PushFeeds sends active local feed subscriptions to the Cloudflare Worker.
func (c *CloudFeedSync) PushFeeds(ctx context.Context, userID int64) error {
	if !c.IsEnabled() {
		return nil
	}

	feeds, err := c.store.ListFeeds(userID)
	if err != nil {
		return fmt.Errorf("list feeds: %w", err)
	}

	var items []cloudFeedPushItem
	for _, f := range feeds {
		if strings.HasPrefix(f.Link, "/api/feeds/synthetic") {
			continue
		}
		items = append(items, cloudFeedPushItem{
			ID:       f.ID,
			Name:     f.Name,
			Link:     f.Link,
			IsActive: !f.Suspended,
		})
	}

	payload := cloudFeedPushPayload{Feeds: items}
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal feeds payload: %w", err)
	}

	url := fmt.Sprintf("%s/api/sync/feeds/push", c.cfg.CloudMonitorURL)
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
		return fmt.Errorf("push feeds to cloud: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("cloud push returned status %d: %s", resp.StatusCode, string(body))
	}

	slog.Info("feeds list synchronized to cloud monitor successfully", "count", len(items))
	return nil
}

// PullOfflineFeedItems fetches buffered feed articles ingested by Cloudflare D1 while Scout was offline.
func (c *CloudFeedSync) PullOfflineFeedItems(ctx context.Context, userID int64) (int, error) {
	if !c.IsEnabled() {
		return 0, nil
	}

	// Read last synced cloud item ID from persistent store
	var lastID int64
	if val, err := c.store.GetAppState("last_cloud_feed_item_id"); err == nil && val != "" {
		lastID, _ = strconv.ParseInt(val, 10, 64)
	}

	totalInserted := 0
	totalReceived := 0
	currentCursor := lastID
	batchLimit := 1000

	for {
		url := fmt.Sprintf("%s/api/sync/feeds/pull?since_id=%d&limit=%d", c.cfg.CloudMonitorURL, currentCursor, batchLimit)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return totalInserted, fmt.Errorf("create pull request: %w", err)
		}

		if c.cfg.CloudMonitorSecret != "" {
			req.Header.Set("Authorization", "Bearer "+c.cfg.CloudMonitorSecret)
			req.Header.Set("X-Scout-Sync-Key", c.cfg.CloudMonitorSecret)
		}

		resp, err := c.client.Do(req)
		if err != nil {
			return totalInserted, fmt.Errorf("pull feeds from cloud: %w", err)
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			return totalInserted, fmt.Errorf("cloud pull returned status %d: %s", resp.StatusCode, string(body))
		}

		var pullRes cloudFeedPullResponse
		err = json.NewDecoder(resp.Body).Decode(&pullRes)
		resp.Body.Close()
		if err != nil {
			return totalInserted, fmt.Errorf("decode cloud pull response: %w", err)
		}

		if len(pullRes.Data) == 0 {
			break
		}

		totalReceived += len(pullRes.Data)

		// Group items by feed_id
		grouped := make(map[int64][]store.BatchCreateItemInput)
		var maxIDInBatch int64 = currentCursor
		for _, item := range pullRes.Data {
			if item.ID > maxIDInBatch {
				maxIDInBatch = item.ID
			}
			grouped[item.FeedID] = append(grouped[item.FeedID], store.BatchCreateItemInput{
				GUID:    item.GUID,
				Title:   item.Title,
				Link:    item.Link,
				Content: item.Content,
				PubDate: item.PubDate,
			})
		}

		for feedID, inputs := range grouped {
			inserted, err := c.store.BatchCreateItemsIgnore(userID, feedID, inputs)
			if err != nil {
				slog.Warn("failed to insert cloud feed items", "feed_id", feedID, "error", err)
				continue
			}
			totalInserted += inserted
		}

		if pullRes.MaxID > maxIDInBatch {
			maxIDInBatch = pullRes.MaxID
		}
		currentCursor = maxIDInBatch
		_ = c.store.SetAppState("last_cloud_feed_item_id", strconv.FormatInt(currentCursor, 10))

		// If this batch had fewer items than the limit, we've caught up
		if len(pullRes.Data) < batchLimit {
			break
		}
	}

	if totalReceived > 0 {
		slog.Info("cloud offline feed sync completed", "total_received", totalReceived, "new_items_inserted", totalInserted, "last_id", currentCursor)
	}
	return totalInserted, nil
}

// FullSync pushes active feeds to Cloudflare and pulls all offline buffered articles.
func (c *CloudFeedSync) FullSync(ctx context.Context, userID int64) (int, error) {
	if !c.IsEnabled() {
		return 0, nil
	}

	if err := c.PushFeeds(ctx, userID); err != nil {
		slog.Warn("cloud feed push error during sync", "error", err)
	}

	return c.PullOfflineFeedItems(ctx, userID)
}
