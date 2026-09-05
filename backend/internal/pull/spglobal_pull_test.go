package pull

import (
	"context"
	"testing"
	"time"

	"github.com/0x2E/fusion/internal/model"
)

func TestLivePullSPGlobalFeed(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping live network test in short mode")
	}
	target := "https://www.spglobal.com/content/spglobal/energy/us/en/rss/shipping.xml"
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	feed := &model.Feed{
		Link: target,
	}

	result, err := FetchAndParse(ctx, feed, target, 20*time.Second, false)
	if err != nil {
		t.Fatalf("FetchAndParse failed: %v", err)
	}

	if result.HTTPStatus != 200 {
		t.Fatalf("expected HTTP 200, got %d", result.HTTPStatus)
	}

	if len(result.Items) == 0 {
		t.Fatalf("expected articles to be parsed, got 0")
	}

	t.Logf("Successfully parsed %d items from S&P Global!", len(result.Items))
	for i, it := range result.Items {
		if i < 3 {
			t.Logf("  [%d] %s (%s)", i+1, it.Title, it.Link)
		}
	}
}
