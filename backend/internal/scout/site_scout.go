package scout

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/0x2E/fusion/internal/pkg/httpc"
	"github.com/PuerkitoBio/goquery"
	"github.com/mmcdole/gofeed"
)

// DiscoveredFeed represents a feed discovered from site scouting.
type DiscoveredFeed struct {
	Title       string `json:"title"`
	Link        string `json:"link"`
	Description string `json:"description,omitempty"`
	SiteURL     string `json:"site_url,omitempty"`
}

var standardPaths = []string{
	"/rss",
	"/feed",
	"/rss.xml",
	"/feed.xml",
	"/atom.xml",
	"/index.xml",
	"/feeds",
	"/feeds/rss",
	"/feeds/posts/default",
	"/news/rss",
}

// ScoutSite thoroughly scouts a reference website or URL to discover all possible RSS/Atom feeds.
func ScoutSite(ctx context.Context, rawTarget string, allowPrivate bool) ([]DiscoveredFeed, error) {
	target := strings.TrimSpace(rawTarget)
	if target == "" {
		return nil, fmt.Errorf("empty url")
	}

	if !strings.HasPrefix(target, "http://") && !strings.HasPrefix(target, "https://") {
		target = "https://" + target
	}

	parsedURL, err := url.Parse(target)
	if err != nil {
		return nil, fmt.Errorf("invalid url: %w", err)
	}

	client, err := httpc.NewClient(15*time.Second, "", allowPrivate)
	if err != nil {
		return nil, fmt.Errorf("create http client: %w", err)
	}

	// Step 1: Check if the provided URL is already a direct RSS/Atom feed
	if feed, err := testAndParseFeed(ctx, client, target); err == nil && feed != nil {
		return []DiscoveredFeed{*feed}, nil
	}

	// Step 2: Fetch target HTML page with fallback for anti-bot protection
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpc.SetDefaultHeaders(req)

	payload, err := httpc.DoWithFallback(ctx, client, req)
	if err != nil {
		return nil, fmt.Errorf("fetch target page: %w", err)
	}

	// If the fetched payload turned out to be an XML feed directly
	if feed, err := parseFeedBody(payload.Body, target); err == nil && feed != nil {
		return []DiscoveredFeed{*feed}, nil
	}

	// Step 3: Parse HTML and harvest candidates from <link> and <a> tags
	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(payload.Body))
	if err != nil {
		return nil, fmt.Errorf("parse html: %w", err)
	}

	candidateLinks := make(map[string]struct{})
	directoryPages := make(map[string]struct{})

	// 3a. Extract <link rel="alternate">
	doc.Find("link[rel='alternate']").Each(func(_ int, s *goquery.Selection) {
		t := strings.ToLower(s.AttrOr("type", ""))
		if strings.Contains(t, "rss") || strings.Contains(t, "atom") || strings.Contains(t, "xml") || strings.Contains(t, "json") {
			if href := s.AttrOr("href", ""); href != "" {
				resolved := resolveURL(parsedURL, href)
				if resolved != "" {
					candidateLinks[resolved] = struct{}{}
				}
			}
		}
	})

	// 3b. Scan <a> anchors for feed links or RSS directory subpages
	doc.Find("a[href]").Each(func(_ int, s *goquery.Selection) {
		href := strings.TrimSpace(s.AttrOr("href", ""))
		text := strings.ToLower(strings.TrimSpace(s.Text()))
		lowerHref := strings.ToLower(href)

		isFeed := strings.Contains(lowerHref, "/rss") ||
			strings.Contains(lowerHref, "/feed") ||
			strings.HasSuffix(lowerHref, ".xml") ||
			strings.HasSuffix(lowerHref, ".rss") ||
			strings.Contains(lowerHref, "atom.xml") ||
			strings.Contains(lowerHref, "/syndication")

		isTextIndicated := strings.Contains(text, "rss") ||
			strings.Contains(text, "atom") ||
			strings.Contains(text, "feed") ||
			strings.Contains(text, "xml")

		if isFeed || isTextIndicated {
			resolved := resolveURL(parsedURL, href)
			if resolved != "" {
				// Distinguish potential direct feed vs HTML directory
				if strings.HasSuffix(resolved, ".html") || strings.HasSuffix(resolved, ".htm") || (!strings.HasSuffix(resolved, ".xml") && !strings.HasSuffix(resolved, ".rss") && !strings.Contains(resolved, ".xml?")) {
					directoryPages[resolved] = struct{}{}
				}
				candidateLinks[resolved] = struct{}{}
			}
		}
	})

	// 3c. Add standard common convention paths on the same host
	baseURL := &url.URL{Scheme: parsedURL.Scheme, Host: parsedURL.Host}
	for _, p := range standardPaths {
		candidateLinks[baseURL.ResolveReference(&url.URL{Path: p}).String()] = struct{}{}
	}

	// Step 4: Explore discovered RSS directory subpages (e.g. /rss, /feeds) to find topic feeds
	for dirPage := range directoryPages {
		if dirPage == target {
			continue
		}
		// Subpage discovery with short timeout
		subCtx, subCancel := context.WithTimeout(ctx, 6*time.Second)
		subReq, subErr := http.NewRequestWithContext(subCtx, http.MethodGet, dirPage, nil)
		if subErr == nil {
			httpc.SetDefaultHeaders(subReq)
			if subPayload, err := httpc.DoWithFallback(subCtx, client, subReq); err == nil && subPayload.StatusCode == http.StatusOK {
				if subDoc, err := goquery.NewDocumentFromReader(bytes.NewReader(subPayload.Body)); err == nil {
					subBase, _ := url.Parse(dirPage)
					subDoc.Find("a[href]").Each(func(_ int, s *goquery.Selection) {
						subHref := s.AttrOr("href", "")
						subLower := strings.ToLower(subHref)
						if strings.Contains(subLower, ".xml") || strings.Contains(subLower, "/rss") || strings.Contains(subLower, "/feed") {
							if r := resolveURL(subBase, subHref); r != "" {
								candidateLinks[r] = struct{}{}
							}
						}
					})
				}
			}
		}
		subCancel()
	}

	// Step 5: Concurrently validate candidates and collect real feeds
	results := validateCandidateFeeds(ctx, client, candidateLinks)
	return results, nil
}

func validateCandidateFeeds(ctx context.Context, client *http.Client, candidates map[string]struct{}) []DiscoveredFeed {
	var mu sync.Mutex
	discovered := make([]DiscoveredFeed, 0, len(candidates))
	seen := make(map[string]struct{})

	sem := make(chan struct{}, 8)
	var wg sync.WaitGroup

	for link := range candidates {
		wg.Add(1)
		go func(targetURL string) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				return
			}

			valCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
			defer cancel()

			feed, err := testAndParseFeed(valCtx, client, targetURL)
			if err == nil && feed != nil && feed.Link != "" {
				mu.Lock()
				if _, exists := seen[feed.Link]; !exists {
					seen[feed.Link] = struct{}{}
					discovered = append(discovered, *feed)
				}
				mu.Unlock()
			}
		}(link)
	}

	wg.Wait()
	return discovered
}

func testAndParseFeed(ctx context.Context, client *http.Client, targetURL string) (*DiscoveredFeed, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return nil, err
	}
	httpc.SetDefaultHeaders(req)

	payload, err := httpc.DoWithFallback(ctx, client, req)
	if err != nil {
		return nil, err
	}
	if payload.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", payload.StatusCode)
	}

	return parseFeedBody(payload.Body, targetURL)
}

func parseFeedBody(body []byte, targetURL string) (*DiscoveredFeed, error) {
	if len(body) == 0 {
		return nil, fmt.Errorf("empty body")
	}

	fp := gofeed.NewParser()
	parsed, err := fp.Parse(bytes.NewReader(body))
	if err != nil || parsed == nil {
		return nil, fmt.Errorf("not a valid feed: %w", err)
	}

	title := strings.TrimSpace(parsed.Title)
	if title == "" {
		title = targetURL
	}

	siteURL := strings.TrimSpace(parsed.Link)
	desc := strings.TrimSpace(parsed.Description)

	return &DiscoveredFeed{
		Title:       title,
		Link:        targetURL,
		Description: desc,
		SiteURL:     siteURL,
	}, nil
}

func resolveURL(base *url.URL, ref string) string {
	ref = strings.TrimSpace(ref)
	if ref == "" || strings.HasPrefix(ref, "javascript:") || strings.HasPrefix(ref, "mailto:") {
		return ""
	}
	parsedRef, err := url.Parse(ref)
	if err != nil {
		return ""
	}
	resolved := base.ResolveReference(parsedRef)
	if resolved.Scheme != "http" && resolved.Scheme != "https" {
		return ""
	}
	return resolved.String()
}
