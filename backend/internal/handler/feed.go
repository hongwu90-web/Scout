package handler

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/0x2E/feedfinder"
	"github.com/0x2E/fusion/internal/feedbuilder"
	"github.com/0x2E/fusion/internal/model"
	"github.com/0x2E/fusion/internal/pkg/httpc"
	"github.com/0x2E/fusion/internal/scout"
	"github.com/0x2E/fusion/internal/searchfeed"
	"github.com/0x2E/fusion/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/mmcdole/gofeed"
)

type createFeedRequest struct {
	GroupID int64  `json:"group_id" binding:"required"`
	Name    string `json:"name" binding:"required"`
	Link    string `json:"link" binding:"required"`
	SiteURL string `json:"site_url"`
	Proxy   string `json:"proxy"`
}

type updateFeedRequest struct {
	GroupID   *int64  `json:"group_id"`
	Name      *string `json:"name"`
	Link      *string `json:"link"`
	SiteURL   *string `json:"site_url"`
	Suspended *bool   `json:"suspended"`
	Proxy     *string `json:"proxy"` // Empty string clears proxy
}

type validateFeedRequest struct {
	URL string `json:"url" binding:"required"`
}

type discoveredFeed struct {
	Title       string `json:"title"`
	Link        string `json:"link"`
	Description string `json:"description,omitempty"`
	SiteURL     string `json:"site_url,omitempty"`
}

type validateFeedResponse struct {
	Feeds []discoveredFeed `json:"feeds"`
}

type batchCreateFeedsRequest struct {
	Feeds []batchCreateFeedItem `json:"feeds" binding:"required"`
}

type batchCreateFeedItem struct {
	GroupID int64  `json:"group_id" binding:"required"`
	Name    string `json:"name" binding:"required"`
	Link    string `json:"link" binding:"required"`
	SiteURL string `json:"site_url"`
}

const refreshAllTimeout = 30 * time.Minute

func (h *Handler) listFeeds(c *gin.Context) {
	userID := getUserID(c)
	feeds, err := h.store.ListFeeds(userID)
	if err != nil {
		internalError(c, err, "list feeds")
		return
	}

	listResponse(c, feeds, len(feeds))
}

func (h *Handler) getFeed(c *gin.Context) {
	userID := getUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid id")
		return
	}

	feed, err := h.store.GetFeed(userID, id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			notFoundError(c, "feed")
			return
		}
		internalError(c, err, "get feed")
		return
	}

	dataResponse(c, feed)
}

func (h *Handler) createFeed(c *gin.Context) {
	userID := getUserID(c)
	var req createFeedRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, "invalid request")
		return
	}
	link := strings.TrimSpace(req.Link)
	if !strings.HasPrefix(link, "/api/feeds/synthetic") {
		if !strings.HasPrefix(link, "http://") && !strings.HasPrefix(link, "https://") {
			link = "https://" + link
			req.Link = link
		}
		if err := httpc.ValidateRequestURL(c.Request.Context(), req.Link, h.config.AllowPrivateFeeds); err != nil {
			badRequestError(c, "invalid link")
			return
		}
	}

	feed, err := h.store.CreateFeed(userID, req.GroupID, req.Name, req.Link, req.SiteURL, req.Proxy)
	if err != nil {
		if errors.Is(err, store.ErrAlreadyExists) {
			badRequestError(c, "You are already subscribed to this feed")
			return
		}
		internalError(c, err, "create feed")
		return
	}

	// For synthetic feeds, pull synchronously so articles are immediately available upon creation.
	if strings.HasPrefix(feed.Link, "/api/feeds/synthetic") {
		syncCtx, syncCancel := context.WithTimeout(context.Background(), 15*time.Second)
		if err := h.puller.RefreshFeed(syncCtx, userID, feed.ID); err != nil {
			slog.Warn("synchronous synthetic feed pull failed", "feed_id", feed.ID, "error", err)
		}
		syncCancel()
	} else {
		// Trigger initial pull in background.
		refreshTimeout := time.Duration(h.config.PullTimeout) * time.Second
		go func(feedID int64) {
			ctx, cancel := context.WithTimeout(context.Background(), refreshTimeout)
			defer cancel()
			if err := h.puller.RefreshFeed(ctx, userID, feedID); err != nil {
				slog.Warn("initial feed pull failed", "feed_id", feedID, "error", err)
			}
			if h.puller.GetCloudFeedSync() != nil && h.puller.GetCloudFeedSync().IsEnabled() {
				_ = h.puller.GetCloudFeedSync().PushFeeds(ctx, userID)
			}
		}(feed.ID)
	}

	dataResponse(c, feed)
}

func (h *Handler) updateFeed(c *gin.Context) {
	userID := getUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid id")
		return
	}

	var req updateFeedRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, "invalid request")
		return
	}

	params := store.UpdateFeedParams{}
	if req.GroupID != nil {
		params.GroupID = req.GroupID
	}
	if req.Name != nil {
		params.Name = req.Name
	}
	if req.Link != nil {
		if err := httpc.ValidateRequestURL(c.Request.Context(), *req.Link, h.config.AllowPrivateFeeds); err != nil {
			badRequestError(c, "invalid link")
			return
		}
		params.Link = req.Link
	}
	if req.SiteURL != nil {
		params.SiteURL = req.SiteURL
	}
	if req.Suspended != nil {
		params.Suspended = req.Suspended
	}
	if req.Proxy != nil {
		params.Proxy = req.Proxy
	}

	if err := h.store.UpdateFeed(userID, id, params); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			notFoundError(c, "feed")
			return
		}
		internalError(c, err, "update feed")
		return
	}

	feed, err := h.store.GetFeed(userID, id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			notFoundError(c, "feed")
			return
		}
		internalError(c, err, "get updated feed")
		return
	}

	if h.puller.GetCloudFeedSync() != nil && h.puller.GetCloudFeedSync().IsEnabled() {
		go func() {
			_ = h.puller.GetCloudFeedSync().PushFeeds(context.Background(), userID)
		}()
	}

	dataResponse(c, feed)
}

func (h *Handler) deleteFeed(c *gin.Context) {
	userID := getUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid id")
		return
	}

	if err := h.store.DeleteFeed(userID, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			notFoundError(c, "feed")
			return
		}
		internalError(c, err, "delete feed")
		return
	}

	if h.puller.GetCloudFeedSync() != nil && h.puller.GetCloudFeedSync().IsEnabled() {
		go func() {
			_ = h.puller.GetCloudFeedSync().PushFeeds(context.Background(), userID)
		}()
	}

	c.Status(http.StatusNoContent)
}

func (h *Handler) validateFeed(c *gin.Context) {
	var req validateFeedRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, "invalid request")
		return
	}

	target := strings.TrimSpace(req.URL)
	allowPrivateFeeds := h.config != nil && h.config.AllowPrivateFeeds
	if err := httpc.ValidateRequestURL(c.Request.Context(), target, allowPrivateFeeds); err != nil {
		badRequestError(c, "invalid url")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	var feeds []discoveredFeed

	// Primary: Deep reference website scouting
	scoutedFeeds, scoutErr := scout.ScoutSite(ctx, target, allowPrivateFeeds)
	if scoutErr == nil && len(scoutedFeeds) > 0 {
		for _, sf := range scoutedFeeds {
			feeds = append(feeds, discoveredFeed{
				Title:       sf.Title,
				Link:        sf.Link,
				Description: sf.Description,
				SiteURL:     sf.SiteURL,
			})
		}
	} else {
		if scoutErr != nil {
			slog.Warn("deep site scout encountered error", "url", target, "error", scoutErr)
		}

		// Fallback: standard feedfinder
		found, err := feedfinder.Find(ctx, target, nil)
		if err != nil {
			slog.Warn("feed discovery failed", "url", target, "error", err)
		}
		feeds = normalizeDiscoveredFeeds(found)
	}

	if !allowPrivateFeeds {
		filtered := make([]discoveredFeed, 0, len(feeds))
		for _, feed := range feeds {
			if err := httpc.ValidateRequestURL(ctx, feed.Link, false); err == nil {
				filtered = append(filtered, feed)
			}
		}
		feeds = filtered
	}

	if len(feeds) == 0 {
		title, parseErr := h.parseFeedTitle(ctx, target)
		if parseErr == nil {
			feeds = append(feeds, discoveredFeed{Title: title, Link: target})
		}
	}

	dataResponse(c, validateFeedResponse{Feeds: feeds})
}

func normalizeDiscoveredFeeds(found []feedfinder.Feed) []discoveredFeed {
	result := make([]discoveredFeed, 0, len(found))
	seen := make(map[string]struct{}, len(found))

	for _, feed := range found {
		link := strings.TrimSpace(feed.Link)
		if link == "" {
			continue
		}
		if _, exists := seen[link]; exists {
			continue
		}

		seen[link] = struct{}{}
		result = append(result, discoveredFeed{
			Title: strings.TrimSpace(feed.Title),
			Link:  link,
		})
	}

	return result
}

func (h *Handler) parseFeedTitle(ctx context.Context, target string) (string, error) {
	allowPrivateFeeds := h.config != nil && h.config.AllowPrivateFeeds

	client, err := httpc.NewClient(30*time.Second, "", allowPrivateFeeds)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return "", err
	}
	httpc.SetDefaultHeaders(req)

	payload, err := httpc.DoWithFallback(ctx, client, req)
	if err != nil {
		return "", err
	}

	if payload.StatusCode != http.StatusOK {
		return "", errors.New("feed fetch failed")
	}

	parsedFeed, err := gofeed.NewParser().Parse(bytes.NewReader(payload.Body))
	if err != nil {
		return "", err
	}

	if parsedFeed == nil {
		return "", nil
	}

	return strings.TrimSpace(parsedFeed.Title), nil
}

func (h *Handler) refreshFeed(c *gin.Context) {
	userID := getUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid id")
		return
	}

	if _, err := h.store.GetFeed(userID, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			notFoundError(c, "feed")
			return
		}
		internalError(c, err, "get feed for refresh")
		return
	}

	// Trigger refresh in background.
	// Do not use the request context here: once the handler returns, it may be cancelled.
	refreshTimeout := time.Duration(h.config.PullTimeout) * time.Second
	go func(feedID int64) {
		ctx, cancel := context.WithTimeout(context.Background(), refreshTimeout)
		defer cancel()
		if err := h.puller.RefreshFeed(ctx, userID, feedID); err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
			slog.Warn("refresh feed failed", "feed_id", feedID, "error", err)
		}
	}(id)

	c.Status(http.StatusAccepted)
}

func (h *Handler) refreshAllFeeds(c *gin.Context) {
	if !h.tryStartRefreshAll() {
		c.Status(http.StatusAccepted)
		return
	}

	userID := getUserID(c)

	// Step 1: Perform fast Cloudflare sync synchronously (150-300ms)
	// so offline articles buffered by Cloudflare D1 are already saved in SQLite
	// before the frontend receives the HTTP response and invalidates query caches.
	imported := 0
	if h.puller.GetCloudFeedSync() != nil && h.puller.GetCloudFeedSync().IsEnabled() {
		syncCtx, syncCancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
		var syncErr error
		imported, syncErr = h.puller.GetCloudFeedSync().FullSync(syncCtx, userID)
		syncCancel()
		if syncErr != nil {
			slog.Warn("cloud feed sync failed during refresh-all", "error", syncErr)
		} else if imported > 0 {
			slog.Info("imported offline cloud feed items during refresh-all", "count", imported)
		}
	}

	// Step 2: Run direct local feed scraping in background so long network timeouts do not block the user.
	go func() {
		defer h.finishRefreshAll()

		ctx, cancel := context.WithTimeout(context.Background(), refreshAllTimeout)
		defer cancel()

		if count, err := h.puller.RefreshAll(ctx); err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
			slog.Warn("refresh all feeds failed", "refreshed", count, "error", err)
		}
	}()

	dataResponse(c, gin.H{"imported": imported})
}

func (h *Handler) tryStartRefreshAll() bool {
	h.refreshAllMu.Lock()
	defer h.refreshAllMu.Unlock()

	if h.refreshAllRunning {
		return false
	}

	h.refreshAllRunning = true
	return true
}

func (h *Handler) finishRefreshAll() {
	h.refreshAllMu.Lock()
	h.refreshAllRunning = false
	h.refreshAllMu.Unlock()
}

func (h *Handler) batchCreateFeeds(c *gin.Context) {
	userID := getUserID(c)
	var req batchCreateFeedsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, "invalid request")
		return
	}

	inputs := make([]store.BatchCreateFeedsInput, len(req.Feeds))
	for i, f := range req.Feeds {
		if err := httpc.ValidateRequestURL(c.Request.Context(), f.Link, h.config.AllowPrivateFeeds); err != nil {
			badRequestError(c, "invalid link")
			return
		}
		inputs[i] = store.BatchCreateFeedsInput{
			GroupID: f.GroupID,
			Name:    f.Name,
			Link:    f.Link,
			SiteURL: f.SiteURL,
		}
	}

	result, err := h.store.BatchCreateFeeds(userID, inputs)
	if err != nil {
		internalError(c, err, "batch create feeds")
		return
	}

	// Trigger initial pull for each new feed in background.
	refreshTimeout := time.Duration(h.config.PullTimeout) * time.Second
	for _, id := range result.CreatedIDs {
		go func(feedID int64) {
			ctx, cancel := context.WithTimeout(context.Background(), refreshTimeout)
			defer cancel()
			if err := h.puller.RefreshFeed(ctx, userID, feedID); err != nil {
				slog.Warn("initial feed pull failed", "feed_id", feedID, "error", err)
			}
		}(id)
	}

	dataResponse(c, gin.H{
		"created": result.Created,
		"failed":  len(result.Errors),
		"errors":  result.Errors,
	})
}

func (h *Handler) exportOPML(c *gin.Context) {
	userID := getUserID(c)

	groups, err := h.store.ListGroups(userID)
	if err != nil {
		internalError(c, err, "list groups for opml export")
		return
	}

	feeds, err := h.store.ListFeeds(userID)
	if err != nil {
		internalError(c, err, "list feeds for opml export")
		return
	}

	feedsByGroup := make(map[int64][]*model.Feed)
	var ungroupedFeeds []*model.Feed
	groupMap := make(map[int64]*model.Group)

	for _, g := range groups {
		groupMap[g.ID] = g
	}

	for _, f := range feeds {
		if _, ok := groupMap[f.GroupID]; ok {
			feedsByGroup[f.GroupID] = append(feedsByGroup[f.GroupID], f)
		} else {
			ungroupedFeeds = append(ungroupedFeeds, f)
		}
	}

	escapeXML := func(s string) string {
		s = strings.ReplaceAll(s, "&", "&amp;")
		s = strings.ReplaceAll(s, "<", "&lt;")
		s = strings.ReplaceAll(s, ">", "&gt;")
		s = strings.ReplaceAll(s, "\"", "&quot;")
		s = strings.ReplaceAll(s, "'", "&apos;")
		return s
	}

	var sb strings.Builder
	sb.WriteString("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
	sb.WriteString("<opml version=\"2.0\">\n")
	sb.WriteString("  <head>\n")
	sb.WriteString("    <title>Scout Subscriptions</title>\n")
	sb.WriteString(fmt.Sprintf("    <dateCreated>%s</dateCreated>\n", time.Now().UTC().Format(time.RFC1123)))
	sb.WriteString("  </head>\n")
	sb.WriteString("  <body>\n")

	for _, g := range groups {
		gFeeds := feedsByGroup[g.ID]
		if len(gFeeds) > 0 {
			sb.WriteString(fmt.Sprintf("    <outline text=\"%s\" title=\"%s\">\n", escapeXML(g.Name), escapeXML(g.Name)))
			for _, f := range gFeeds {
				siteAttr := ""
				if f.SiteURL != "" {
					siteAttr = fmt.Sprintf(" htmlUrl=\"%s\"", escapeXML(f.SiteURL))
				}
				sb.WriteString(fmt.Sprintf("      <outline type=\"rss\" text=\"%s\" title=\"%s\" xmlUrl=\"%s\"%s />\n", escapeXML(f.Name), escapeXML(f.Name), escapeXML(f.Link), siteAttr))
			}
			sb.WriteString("    </outline>\n")
		}
	}

	for _, f := range ungroupedFeeds {
		siteAttr := ""
		if f.SiteURL != "" {
			siteAttr = fmt.Sprintf(" htmlUrl=\"%s\"", escapeXML(f.SiteURL))
		}
		sb.WriteString(fmt.Sprintf("    <outline type=\"rss\" text=\"%s\" title=\"%s\" xmlUrl=\"%s\"%s />\n", escapeXML(f.Name), escapeXML(f.Name), escapeXML(f.Link), siteAttr))
	}

	sb.WriteString("  </body>\n")
	sb.WriteString("</opml>\n")

	c.Header("Content-Disposition", `attachment; filename="scout-subscriptions.opml"`)
	c.Data(http.StatusOK, "application/xml; charset=utf-8", []byte(sb.String()))
}

type buildFeedPreviewRequest struct {
	URL      string `json:"url" binding:"required"`
	Selector string `json:"selector"`
}

func (h *Handler) searchOnlineFeeds(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	if q == "" {
		badRequestError(c, "query parameter 'q' is required")
		return
	}

	allowPrivateFeeds := h.config != nil && h.config.AllowPrivateFeeds
	results, err := searchfeed.SearchOnlineFeeds(c.Request.Context(), q, allowPrivateFeeds)
	if err != nil {
		internalError(c, err, "search online feeds")
		return
	}

	listResponse(c, results, len(results))
}

func (h *Handler) previewFeedBuild(c *gin.Context) {
	var req buildFeedPreviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, "invalid request")
		return
	}

	target := strings.TrimSpace(req.URL)
	if strings.HasPrefix(target, "/api/feeds/synthetic") {
		if parsed, err := url.Parse(target); err == nil {
			if qURL := parsed.Query().Get("url"); qURL != "" {
				target = qURL
			}
			if req.Selector == "" {
				req.Selector = parsed.Query().Get("selector")
			}
		}
	}

	if !strings.HasPrefix(target, "http://") && !strings.HasPrefix(target, "https://") {
		target = "https://" + target
	}

	allowPrivateFeeds := h.config != nil && h.config.AllowPrivateFeeds
	if err := httpc.ValidateRequestURL(c.Request.Context(), target, allowPrivateFeeds); err != nil {
		badRequestError(c, "invalid target url")
		return
	}

	_, preview, err := feedbuilder.BuildRSSFromWebpage(c.Request.Context(), target, req.Selector, allowPrivateFeeds)
	if err != nil {
		badRequestError(c, fmt.Sprintf("failed to build feed: %v", err))
		return
	}

	dataResponse(c, preview)
}

func (h *Handler) serveSyntheticFeed(c *gin.Context) {
	target := strings.TrimSpace(c.Query("url"))
	if target == "" {
		c.String(http.StatusBadRequest, "missing url parameter")
		return
	}

	selector := strings.TrimSpace(c.Query("selector"))
	allowPrivateFeeds := h.config != nil && h.config.AllowPrivateFeeds

	xmlBytes, _, err := feedbuilder.BuildRSSFromWebpage(c.Request.Context(), target, selector, allowPrivateFeeds)
	if err != nil {
		c.String(http.StatusBadGateway, fmt.Sprintf("error generating synthetic feed: %v", err))
		return
	}

	c.Data(http.StatusOK, "application/rss+xml; charset=utf-8", xmlBytes)
}
