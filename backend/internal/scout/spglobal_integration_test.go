package scout

import (
	"context"
	"testing"
	"time"
)

func TestLiveScoutSPGlobalFeed(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping live network test in short mode")
	}
	target := "https://www.spglobal.com/content/spglobal/energy/us/en/rss/shipping.xml"
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	feeds, err := ScoutSite(ctx, target, false)
	if err != nil {
		t.Fatalf("ScoutSite failed: %v", err)
	}
	if len(feeds) == 0 {
		t.Fatalf("expected at least 1 feed, got 0")
	}

	t.Logf("Found %d feeds: %+v", len(feeds), feeds)
	if feeds[0].Title != "Latest Shipping Headlines" {
		t.Errorf("expected 'Latest Shipping Headlines', got %q", feeds[0].Title)
	}
}
