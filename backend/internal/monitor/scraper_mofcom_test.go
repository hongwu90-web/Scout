package monitor_test

import (
	"context"
	"testing"
	"time"

	"github.com/0x2E/fusion/internal/config"
	"github.com/0x2E/fusion/internal/monitor"
)

func TestMofcomScrape(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping live network test in short mode")
	}

	cfg := &config.Config{
		AllowPrivateFeeds: true,
	}
	scraper := monitor.NewScrapeEngine(cfg)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	res := scraper.Scrape(ctx, "https://english.mofcom.gov.cn/", "", "")
	if res.Error != nil {
		t.Fatalf("scrape error: %v", res.Error)
	}

	if res.StatusCode != 200 {
		t.Fatalf("expected status 200, got %d", res.StatusCode)
	}

	if len(res.ContentText) == 0 {
		t.Fatalf("expected non-empty content")
	}

	t.Logf("Successfully scraped mofcom: elements=%d, hash=%s, length=%d", res.ElementsCount, res.Hash, len(res.ContentText))
}
