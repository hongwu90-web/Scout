package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSearchOnlineFeedsRoute(t *testing.T) {
	h, _ := newFeverTestHandler(t)
	r := newTestRouter()
	r.GET("/api/feeds/search-online", h.searchOnlineFeeds)

	w := performRequest(r, http.MethodGet, "/api/feeds/search-online?q=Bloomberg", nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data []struct {
			Title string `json:"title"`
			Link  string `json:"link"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if len(resp.Data) == 0 {
		t.Fatalf("expected at least 1 result for Bloomberg, got 0")
	}
}

func TestBuildFeedPreviewRoute(t *testing.T) {
	// Create mock html target
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(`<html><head><title>Mock News</title></head><body><article><h3><a href="/post/1">Sample Headline</a></h3><p>Sample snippet text</p></article></body></html>`))
	}))
	defer ts.Close()

	h, _ := newFeverTestHandler(t)
	h.config.AllowPrivateFeeds = true
	r := newTestRouter()
	r.POST("/api/feeds/build/preview", h.previewFeedBuild)

	payload := buildFeedPreviewRequest{
		URL:      ts.URL,
		Selector: "article",
	}
	b, _ := json.Marshal(payload)

	w := performRequest(r, http.MethodPost, "/api/feeds/build/preview", bytes.NewReader(b), map[string]string{
		"Content-Type": "application/json",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data struct {
			PageTitle  string `json:"page_title"`
			ItemsCount int    `json:"items_count"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if resp.Data.ItemsCount != 1 {
		t.Errorf("expected 1 item, got %d", resp.Data.ItemsCount)
	}
}

func TestServeSyntheticFeedRoute(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(`<html><head><title>Mock Blog</title></head><body><article><h2><a href="/post/1">Blog Entry</a></h2><p>Blog post content</p></article></body></html>`))
	}))
	defer ts.Close()

	h, _ := newFeverTestHandler(t)
	h.config.AllowPrivateFeeds = true
	r := newTestRouter()
	r.GET("/api/feeds/synthetic", h.serveSyntheticFeed)

	w := performRequest(r, http.MethodGet, "/api/feeds/synthetic?url="+ts.URL+"&selector=article", nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	ct := w.Header().Get("Content-Type")
	if !strings.Contains(ct, "application/rss+xml") {
		t.Errorf("expected application/rss+xml content type, got: %s", ct)
	}

	body := w.Body.String()
	if !strings.Contains(body, "<rss version=\"2.0\">") {
		t.Errorf("expected valid RSS XML, got: %s", body)
	}
}

func TestCreateSyntheticFeed(t *testing.T) {
	h, _ := newFeverTestHandler(t)
	h.config.AllowPrivateFeeds = true
	r := newTestRouter()
	r.POST("/api/feeds", h.createFeed)

	payload := map[string]interface{}{
		"group_id": 1,
		"name":     "My Custom Feed",
		"link":     "/api/feeds/synthetic?url=https%3A%2F%2Fnews.ycombinator.com&selector=.athing",
		"site_url": "https://news.ycombinator.com",
	}
	b, _ := json.Marshal(payload)

	w := performRequest(r, http.MethodPost, "/api/feeds", bytes.NewReader(b), map[string]string{
		"Content-Type": "application/json",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}
}

