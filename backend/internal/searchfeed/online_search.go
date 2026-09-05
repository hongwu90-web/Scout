package searchfeed

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/0x2E/fusion/internal/pkg/httpc"
	"github.com/0x2E/fusion/internal/scout"
)

type OnlineFeedResult struct {
	Title       string   `json:"title"`
	Link        string   `json:"link"`
	Website     string   `json:"website,omitempty"`
	Description string   `json:"description,omitempty"`
	Subscribers int      `json:"subscribers,omitempty"`
	IconURL     string   `json:"icon_url,omitempty"`
	VisualURL   string   `json:"visual_url,omitempty"`
	Topics      []string `json:"topics,omitempty"`
	Source      string   `json:"source"`
}

type feedlyResponse struct {
	Results []feedlyResult `json:"results"`
}

type feedlyResult struct {
	FeedID      string   `json:"feedId"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Website     string   `json:"website"`
	Subscribers int      `json:"subscribers"`
	IconURL     string   `json:"iconUrl"`
	VisualURL   string   `json:"visualUrl"`
	Topics      []string `json:"topics"`
}

// SearchOnlineFeeds discovers publicly available RSS feeds from keywords.
func SearchOnlineFeeds(ctx context.Context, query string, allowPrivate bool) ([]OnlineFeedResult, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return nil, fmt.Errorf("empty search query")
	}

	client, err := httpc.NewClient(15*time.Second, "", allowPrivate)
	if err != nil {
		return nil, fmt.Errorf("create client: %w", err)
	}

	var results []OnlineFeedResult
	var mu sync.Mutex
	seen := make(map[string]struct{})

	var wg sync.WaitGroup

	// Task A: Search Feedly public catalog API
	wg.Add(1)
	go func() {
		defer wg.Done()
		feedlyItems, err := searchFeedly(ctx, client, q)
		if err == nil && len(feedlyItems) > 0 {
			mu.Lock()
			for _, item := range feedlyItems {
				if _, ok := seen[item.Link]; !ok {
					seen[item.Link] = struct{}{}
					results = append(results, item)
				}
			}
			mu.Unlock()
		}
	}()

	// Task B: If query is a domain name (e.g. bloomberg.com, spglobal.com), scout that site
	if strings.Contains(q, ".") && !strings.Contains(q, " ") {
		wg.Add(1)
		go func() {
			defer wg.Done()
			domainURL := q
			if !strings.HasPrefix(domainURL, "http://") && !strings.HasPrefix(domainURL, "https://") {
				domainURL = "https://" + domainURL
			}
			scouted, err := scout.ScoutSite(ctx, domainURL, allowPrivate)
			if err == nil {
				mu.Lock()
				for _, f := range scouted {
					if _, ok := seen[f.Link]; !ok {
						seen[f.Link] = struct{}{}
						results = append(results, OnlineFeedResult{
							Title:       f.Title,
							Link:        f.Link,
							Website:     f.SiteURL,
							Description: f.Description,
							Source:      "scout",
						})
					}
				}
				mu.Unlock()
			}
		}()
	}

	wg.Wait()

	// Task C: Always provide a companion Google News topic feed for the keywords
	gnewsLink := fmt.Sprintf("https://news.google.com/rss/search?q=%s&hl=en-US&gl=US&ceid=US:en", url.QueryEscape(q))
	if _, ok := seen[gnewsLink]; !ok {
		seen[gnewsLink] = struct{}{}
		results = append(results, OnlineFeedResult{
			Title:       fmt.Sprintf("Google News: %s", q),
			Link:        gnewsLink,
			Website:     "https://news.google.com",
			Description: fmt.Sprintf("Live aggregated news headlines for \"%s\"", q),
			Source:      "gnews",
		})
	}

	return results, nil
}

func searchFeedly(ctx context.Context, client *http.Client, query string) ([]OnlineFeedResult, error) {
	reqURL := fmt.Sprintf("https://cloud.feedly.com/v3/search/feeds?query=%s&count=20", url.QueryEscape(query))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}
	httpc.SetDefaultHeaders(req)

	payload, err := httpc.DoWithFallback(ctx, client, req)
	if err != nil {
		return nil, err
	}
	if payload.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("feedly search status %d", payload.StatusCode)
	}

	var resp feedlyResponse
	if err := json.Unmarshal(payload.Body, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal feedly response: %w", err)
	}

	var out []OnlineFeedResult
	for _, item := range resp.Results {
		link := strings.TrimPrefix(item.FeedID, "feed/")
		if link == "" {
			continue
		}

		out = append(out, OnlineFeedResult{
			Title:       strings.TrimSpace(item.Title),
			Link:        link,
			Website:     strings.TrimSpace(item.Website),
			Description: strings.TrimSpace(item.Description),
			Subscribers: item.Subscribers,
			IconURL:     item.IconURL,
			VisualURL:   item.VisualURL,
			Topics:      item.Topics,
			Source:      "feedly",
		})
	}

	return out, nil
}
