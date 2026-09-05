package searchfeed

import (
	"context"
	"net/http"
	"testing"
)

func TestSearchFeedlyLive(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping live network test in short mode")
	}
	client := http.DefaultClient
	results, err := searchFeedly(context.Background(), client, "Bloomberg")
	if err != nil {
		t.Fatalf("searchFeedly failed: %v", err)
	}
	if len(results) == 0 {
		t.Fatalf("expected at least 1 feedly result for Bloomberg, got 0")
	}
	t.Logf("Found %d feeds for Bloomberg! Top: %s (%s)", len(results), results[0].Title, results[0].Link)
}

func TestSearchOnlineFeedsQuery(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping live network test in short mode")
	}
	ctx := context.Background()
	results, err := SearchOnlineFeeds(ctx, "Shipping", false)
	if err != nil {
		t.Fatalf("SearchOnlineFeeds failed: %v", err)
	}
	if len(results) == 0 {
		t.Fatalf("expected at least 1 result (e.g. gnews), got 0")
	}

	foundGNews := false
	for _, r := range results {
		if r.Source == "gnews" {
			foundGNews = true
			break
		}
	}
	if !foundGNews {
		t.Errorf("expected to find Google News topic feed option in results")
	}
}
