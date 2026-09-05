package monitor

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/0x2E/fusion/internal/config"
	"github.com/0x2E/fusion/internal/model"
	"github.com/0x2E/fusion/internal/store"
)

type Engine struct {
	store     *store.Store
	cfg       *config.Config
	scraper   *Scraper
	cloudSync *CloudSync
	cancel    context.CancelFunc
	wg        sync.WaitGroup
}

func NewEngine(st *store.Store, cfg *config.Config) *Engine {
	return &Engine{
		store:     st,
		cfg:       cfg,
		scraper:   NewScrapeEngine(cfg),
		cloudSync: NewCloudSync(st, cfg),
	}
}

func (e *Engine) GetCloudSync() *CloudSync {
	return e.cloudSync
}

func (e *Engine) Start(parentCtx context.Context) {
	ctx, cancel := context.WithCancel(parentCtx)
	e.cancel = cancel

	e.wg.Add(1)
	go func() {
		defer e.wg.Done()
		slog.Info("webpage monitor scheduler engine started")

		// Run Cloud Sync immediately on startup (import snapshots captured while Mac slept)
		if e.cloudSync.IsEnabled() {
			slog.Info("running initial cloud monitor 2-way sync on startup")
			go func() {
				if _, err := e.cloudSync.FullSync(ctx, 1); err != nil {
					slog.Warn("startup cloud sync error", "error", err)
				}
			}()
		}

		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()

		cloudSyncTicker := time.NewTicker(5 * time.Minute)
		defer cloudSyncTicker.Stop()

		// Run immediately on start
		e.checkDuePages(ctx)

		for {
			select {
			case <-ctx.Done():
				slog.Info("webpage monitor scheduler engine stopped")
				return
			case <-cloudSyncTicker.C:
				if e.cloudSync.IsEnabled() {
					if _, err := e.cloudSync.FullSync(ctx, 1); err != nil {
						slog.Warn("periodic cloud sync error", "error", err)
					}
				}
			case <-ticker.C:
				e.checkDuePages(ctx)
			}
		}
	}()
}

func (e *Engine) Stop() {
	if e.cancel != nil {
		e.cancel()
	}
	e.wg.Wait()
}

func (e *Engine) checkDuePages(ctx context.Context) {
	now := time.Now().Unix()
	duePages, err := e.store.ListAllDueMonitoredPages(now, 20)
	if err != nil {
		slog.Error("failed to list due monitored pages", "error", err)
		return
	}

	if len(duePages) == 0 {
		return
	}

	slog.Info("checking due monitored pages", "count", len(duePages))
	for _, page := range duePages {
		select {
		case <-ctx.Done():
			return
		default:
			if err := e.CheckPage(ctx, page.UserID, page.ID); err != nil {
				slog.Error("monitored page check failed", "page_id", page.ID, "name", page.Name, "error", err)
			}
		}
	}
}

func (e *Engine) CheckPage(ctx context.Context, userID, pageID int64) error {
	page, err := e.store.GetMonitoredPage(userID, pageID)
	if err != nil {
		return fmt.Errorf("get page %d: %w", pageID, err)
	}

	slog.Info("scraping monitored page", "page_id", page.ID, "url", page.URL)
	res := e.scraper.Scrape(ctx, page.URL, page.CSSSelector, page.StripSelectors)

	if res.Error != nil {
		lastErr := res.Error.Error()
		status := res.StatusCode
		_ = e.store.UpdateMonitoredPageCheckResult(userID, page.ID, page.LastHash, status, lastErr, false)
		return res.Error
	}

	hasChange := false
	var diffRes *DiffResult

	latestSnap, _ := e.store.GetLatestPageSnapshot(userID, page.ID)

	if latestSnap == nil {
		// First snapshot for this monitor: compute baseline sections & diff
		diffRes = ComputeDiff("", res.ContentText)
		hasChange = false // baseline snapshot

		snap := &model.PageSnapshot{
			PageID:          page.ID,
			Hash:            res.Hash,
			ContentText:     res.ContentText,
			PrevContentText: "",
			DiffHTML:        diffRes.DiffHTML,
			Sections:        diffRes.Sections,
			HasChange:       false,
			AddedCount:      diffRes.AddedCount,
			RemovedCount:    0,
			Unread:          true,
		}
		if _, err := e.store.CreatePageSnapshot(userID, snap); err != nil {
			slog.Error("failed to create initial page snapshot", "page_id", page.ID, "error", err)
		} else {
			slog.Info("initial webpage snapshot saved!", "page_id", page.ID, "name", page.Name, "sections", len(diffRes.Sections))
		}
	} else if res.Hash != latestSnap.Hash || res.Hash != page.LastHash {
		// Content hash changed!
		diffRes = ComputeDiff(latestSnap.ContentText, res.ContentText)
		hasChange = diffRes.HasChange

		if hasChange && diffRes != nil {
			snap := &model.PageSnapshot{
				PageID:          page.ID,
				Hash:            res.Hash,
				ContentText:     res.ContentText,
				PrevContentText: latestSnap.ContentText,
				DiffHTML:        diffRes.DiffHTML,
				Sections:        diffRes.Sections,
				HasChange:       true,
				AddedCount:      diffRes.AddedCount,
				RemovedCount:    diffRes.RemovedCount,
				Unread:          true,
			}
			if _, err := e.store.CreatePageSnapshot(userID, snap); err != nil {
				slog.Error("failed to create page snapshot", "page_id", page.ID, "error", err)
			} else {
				slog.Info("webpage change detected & snapshot saved!", "page_id", page.ID, "name", page.Name, "added", diffRes.AddedCount, "removed", diffRes.RemovedCount, "sections", len(diffRes.Sections))
			}
		}
	}

	return e.store.UpdateMonitoredPageCheckResult(userID, page.ID, res.Hash, res.StatusCode, "", hasChange)
}

func (e *Engine) Preview(ctx context.Context, req *model.PreviewSelectorRequest) (*model.PreviewSelectorResponse, error) {
	res := e.scraper.Scrape(ctx, req.URL, req.CSSSelector, req.StripSelectors)
	if res.Error != nil {
		return nil, res.Error
	}
	return &model.PreviewSelectorResponse{
		ExtractedText: res.ContentText,
		ElementsCount: res.ElementsCount,
	}, nil
}
