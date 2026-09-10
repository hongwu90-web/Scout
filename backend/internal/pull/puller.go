package pull

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/0x2E/fusion/internal/config"
	"github.com/0x2E/fusion/internal/model"
	"github.com/0x2E/fusion/internal/pullpolicy"
	"github.com/0x2E/fusion/internal/store"
	"golang.org/x/sync/semaphore"
)

type Puller struct {
	store       *store.Store
	config      *config.Config
	logger      *slog.Logger
	interval    time.Duration
	timeout     time.Duration
	maxBackoff  time.Duration
	concurrency *semaphore.Weighted
	cloudSync   *CloudFeedSync
}

func New(st *store.Store, cfg *config.Config) *Puller {
	return &Puller{
		store:       st,
		config:      cfg,
		logger:      slog.Default(),
		interval:    time.Duration(cfg.PullInterval) * time.Second,
		timeout:     time.Duration(cfg.PullTimeout) * time.Second,
		maxBackoff:  time.Duration(cfg.PullMaxBackoff) * time.Second,
		concurrency: semaphore.NewWeighted(int64(cfg.PullConcurrency)),
		cloudSync:   NewCloudFeedSync(st, cfg),
	}
}

func (p *Puller) GetCloudFeedSync() *CloudFeedSync {
	return p.cloudSync
}

// Start begins periodic feed pulling. Blocks until context is cancelled.
func (p *Puller) Start(ctx context.Context) error {
	p.logger.Info("pull service started", "interval", p.interval, "timeout", p.timeout, "concurrency", p.config.PullConcurrency)

	// Pull any offline articles buffered by Cloudflare Worker first
	if p.cloudSync != nil && p.cloudSync.IsEnabled() {
		p.logger.Info("running initial cloud offline feed sync on startup")
		if imported, err := p.cloudSync.FullSync(ctx, 1); err != nil {
			p.logger.Warn("initial cloud feed sync error", "error", err)
		} else if imported > 0 {
			p.logger.Info("imported offline cloud feed items on startup", "count", imported)
		}
	}

	// Run direct local fetch immediately on startup for all active feeds
	_, _ = p.RefreshAll(ctx)

	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()

	var cloudTicker *time.Ticker
	var cloudChan <-chan time.Time
	if p.cloudSync != nil && p.cloudSync.IsEnabled() {
		cloudTicker = time.NewTicker(3 * time.Minute)
		defer cloudTicker.Stop()
		cloudChan = cloudTicker.C
	}

	for {
		select {
		case <-ctx.Done():
			p.logger.Info("pull service stopping")
			return ctx.Err()
		case <-ticker.C:
			p.pullAll(ctx)
		case <-cloudChan:
			if p.cloudSync != nil && p.cloudSync.IsEnabled() {
				if _, err := p.cloudSync.FullSync(ctx, 1); err != nil {
					p.logger.Warn("periodic cloud feed sync error", "error", err)
				}
			}
		}
	}
}

// pullAll fetches all feeds concurrently with semaphore limiting.
func (p *Puller) pullAll(ctx context.Context) {
	feeds, err := p.store.ListAllFeeds()
	if err != nil {
		p.logger.Error("failed to list feeds", "error", err)
		return
	}

	now := time.Now().Unix()
	_, _ = p.dispatchFeeds(ctx, feeds, func(feed *model.Feed) bool {
		state := pullpolicy.FeedRuntimeState{
			Suspended:           feed.Suspended,
			RetryAfterUntil:     feed.FetchState.RetryAfterUntil,
			NextCheckAt:         feed.FetchState.NextCheckAt,
			ConsecutiveFailures: feed.FetchState.ConsecutiveFailures,
			LastErrorAt:         feed.FetchState.LastErrorAt,
			LastCheckedAt:       feed.FetchState.LastCheckedAt,
		}
		return !pullpolicy.ShouldSkip(now, state, p.interval, p.maxBackoff)
	})
}

// pullFeed fetches single feed and saves new items, automatically following RFC5005 pagination links.
func (p *Puller) pullFeed(ctx context.Context, feed *model.Feed) {
	p.logger.Debug("pulling feed", "feed_id", feed.ID, "feed_name", feed.Name)

	targetURL := feed.Link
	maxPages := 5
	var firstResult *FetchResult
	var checkedAt int64
	totalNewCount := 0

	for page := 0; page < maxPages; page++ {
		// Do not send conditional headers for paginated pages to ensure we get the content
		// Actually, FetchAndParse still uses feed.FetchState for If-Modified-Since, which is okay for page 0.
		// For page > 0, the targetURL changes, so If-Modified-Since might be ignored by the server anyway.
		// A cleaner way is to let FetchAndParse handle it.
		result, err := FetchAndParse(ctx, feed, targetURL, p.timeout, p.config.AllowPrivateFeeds)
		if page == 0 {
			checkedAt = time.Now().Unix()
		}

		if err != nil {
			if page == 0 {
				httpStatus := 0
				retryAfterUntil := int64(0)
				if result != nil {
					httpStatus = result.HTTPStatus
					retryAfterUntil = result.RetryAfterUntil
				}

				if err := p.store.UpdateFeedFetchFailure(feed.UserID, feed.ID, store.UpdateFeedFetchFailureParams{
					CheckedAt:       checkedAt,
					HTTPStatus:      httpStatus,
					LastError:       err.Error(),
					RetryAfterUntil: retryAfterUntil,
					IntervalSeconds: int64(p.interval.Seconds()),
					MaxBackoff:      int64(p.maxBackoff.Seconds()),
				}); err != nil {
					p.logger.Error("failed to record failure", "feed_id", feed.ID, "error", err)
				}

				p.logger.Warn("failed to fetch feed", "feed_id", feed.ID, "feed_name", feed.Name, "status", httpStatus, "error", err)
				return
			} else {
				p.logger.Warn("failed to fetch next feed page", "feed_id", feed.ID, "url", targetURL, "error", err)
				break
			}
		}

		if result.NotModified {
			if page == 0 {
				etag := result.ETag
				if strings.TrimSpace(etag) == "" {
					etag = feed.FetchState.ETag
				}

				lastModified := result.LastModified
				if strings.TrimSpace(lastModified) == "" {
					lastModified = feed.FetchState.LastModified
				}

				cacheControl := result.CacheControl
				if strings.TrimSpace(cacheControl) == "" {
					cacheControl = feed.FetchState.CacheControl
				}

				expiresAt := result.ExpiresAt
				if expiresAt == 0 {
					expiresAt = feed.FetchState.ExpiresAt
				}

				nextCheckAt := pullpolicy.ComputeNextCheckAt(
					checkedAt,
					p.interval,
					p.maxBackoff,
					0,
					result.RetryAfterUntil,
					cacheControl,
					expiresAt,
				)

				if err := p.store.UpdateFeedFetchSuccess(feed.UserID, feed.ID, store.UpdateFeedFetchSuccessParams{
					CheckedAt:       checkedAt,
					HTTPStatus:      result.HTTPStatus,
					ETag:            etag,
					LastModified:    lastModified,
					CacheControl:    cacheControl,
					ExpiresAt:       expiresAt,
					RetryAfterUntil: result.RetryAfterUntil,
					NextCheckAt:     nextCheckAt,
				}); err != nil {
					p.logger.Error("failed to persist not-modified state", "feed_id", feed.ID, "error", err)
					return
				}

				p.logger.Debug("feed not modified", "feed_id", feed.ID, "feed_name", feed.Name)
				return
			}
			break
		}

		if page == 0 {
			firstResult = result
		}

		inputs := make([]store.BatchCreateItemInput, 0, len(result.Items))
		for _, item := range result.Items {
			inputs = append(inputs, store.BatchCreateItemInput{
				GUID:    item.GUID,
				Title:   item.Title,
				Link:    item.Link,
				Content: item.Content,
				PubDate: item.PubDate,
			})
		}

		newCount, err := p.store.BatchCreateItemsIgnore(feed.UserID, feed.ID, inputs)
		if err != nil {
			p.logger.Error("failed to batch create items", "feed_id", feed.ID, "error", err)
			if err := p.store.UpdateFeedFetchFailure(feed.UserID, feed.ID, store.UpdateFeedFetchFailureParams{
				CheckedAt:       checkedAt,
				HTTPStatus:      firstResult.HTTPStatus,
				LastError:       err.Error(),
				RetryAfterUntil: 0,
				IntervalSeconds: int64(p.interval.Seconds()),
				MaxBackoff:      int64(p.maxBackoff.Seconds()),
			}); err != nil {
				p.logger.Error("failed to record failure", "feed_id", feed.ID, "error", err)
			}
			return
		}
		
		totalNewCount += newCount

		if len(inputs) > 0 && newCount < len(inputs) {
			// We've overlapped with already existing items in our DB. No need to look back further.
			break
		}

		if result.NextURL == "" {
			break
		}

		targetURL = result.NextURL
	}

	if firstResult == nil {
		return
	}

	nextCheckAt := pullpolicy.ComputeNextCheckAt(
		checkedAt,
		p.interval,
		p.maxBackoff,
		0,
		firstResult.RetryAfterUntil,
		firstResult.CacheControl,
		firstResult.ExpiresAt,
	)

	if err := p.store.UpdateFeedFetchSuccess(feed.UserID, feed.ID, store.UpdateFeedFetchSuccessParams{
		CheckedAt:       checkedAt,
		HTTPStatus:      firstResult.HTTPStatus,
		ETag:            firstResult.ETag,
		LastModified:    firstResult.LastModified,
		CacheControl:    firstResult.CacheControl,
		ExpiresAt:       firstResult.ExpiresAt,
		RetryAfterUntil: firstResult.RetryAfterUntil,
		NextCheckAt:     nextCheckAt,
	}); err != nil {
		p.logger.Error("failed to update fetch state", "feed_id", feed.ID, "error", err)
		return
	}

	if strings.TrimSpace(feed.SiteURL) == "" && firstResult.SiteURL != "" {
		if err := p.store.UpdateFeedSiteURLIfEmpty(feed.UserID, feed.ID, firstResult.SiteURL); err != nil {
			p.logger.Warn("failed to auto-fill site_url", "feed_id", feed.ID, "site_url", firstResult.SiteURL, "error", err)
		}
	}

	p.logger.Info("feed pulled successfully", "feed_id", feed.ID, "feed_name", feed.Name, "new_items", totalNewCount)
}

// RefreshAll triggers refresh for all non-suspended feeds and waits until all
// started refresh jobs have completed. It bypasses backoff/interval skip logic.
// Concurrency is controlled by the same semaphore as periodic pulls.
func (p *Puller) RefreshAll(ctx context.Context) (int, error) {
	if p.cloudSync != nil && p.cloudSync.IsEnabled() {
		go func() {
			syncCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			_, _ = p.cloudSync.FullSync(syncCtx, 1)
		}()
	}

	feeds, err := p.store.ListAllFeeds()
	if err != nil {
		return 0, fmt.Errorf("list feeds: %w", err)
	}

	count, err := p.dispatchFeeds(ctx, feeds, func(feed *model.Feed) bool {
		return !feed.Suspended
	})
	if err != nil {
		return count, err
	}

	return count, nil
}

func (p *Puller) dispatchFeeds(ctx context.Context, feeds []*model.Feed, shouldPull func(*model.Feed) bool) (int, error) {
	count := 0
	var wg sync.WaitGroup
	var acquireErr error

	for _, feed := range feeds {
		if !shouldPull(feed) {
			continue
		}

		if err := p.concurrency.Acquire(ctx, 1); err != nil {
			acquireErr = err
			break
		}

		count++
		wg.Add(1)
		go func(f *model.Feed) {
			defer wg.Done()
			defer p.concurrency.Release(1)
			p.pullFeed(ctx, f)
		}(feed)
	}

	wg.Wait()
	return count, acquireErr
}

// RefreshFeed manually triggers refresh for specific feed (bypasses skip logic).
// Used by HTTP handler for manual refresh requests.
func (p *Puller) RefreshFeed(ctx context.Context, userID, feedID int64) error {
	feed, err := p.store.GetFeed(userID, feedID)
	if err != nil {
		return fmt.Errorf("get feed: %w", err)
	}

	if err := p.concurrency.Acquire(ctx, 1); err != nil {
		return err
	}
	defer p.concurrency.Release(1)

	p.pullFeed(ctx, feed)
	return nil
}
