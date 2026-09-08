package scout

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestScoutSiteWithDirectFeed(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Mock Test Feed</title>
<link>http://example.com</link>
<description>Test Description</description>
<item>
<title>Item 1</title>
<link>http://example.com/1</link>
</item>
</channel>
</rss>`))
	}))
	defer ts.Close()

	feeds, err := ScoutSite(context.Background(), ts.URL+"/feed.xml", true)
	if err != nil {
		t.Fatalf("ScoutSite failed: %v", err)
	}
	if len(feeds) == 0 {
		t.Fatalf("expected at least 1 feed, got 0")
	}
	if feeds[0].Title != "Mock Test Feed" {
		t.Errorf("expected title 'Mock Test Feed', got %q", feeds[0].Title)
	}
}

func TestScoutSiteWithHTMLAlternate(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/rss.xml" {
			w.Header().Set("Content-Type", "application/rss+xml")
			w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Alternate RSS Feed</title><link>http://example.com</link></channel></rss>`))
			return
		}

		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(`<!DOCTYPE html>
<html>
<head>
<link rel="alternate" type="application/rss+xml" title="Alternate RSS Feed" href="/rss.xml">
</head>
<body><h1>Hello World</h1></body>
</html>`))
	}))
	defer ts.Close()

	feeds, err := ScoutSite(context.Background(), ts.URL, true)
	if err != nil {
		t.Fatalf("ScoutSite failed: %v", err)
	}
	if len(feeds) == 0 {
		t.Fatalf("expected at least 1 feed, got 0")
	}
	if feeds[0].Title != "Alternate RSS Feed" {
		t.Errorf("expected 'Alternate RSS Feed', got %q", feeds[0].Title)
	}
}
