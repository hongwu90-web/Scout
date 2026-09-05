package handler

import (
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestExportOPML_Handler(t *testing.T) {
	h, st := newFeverTestHandler(t)

	// Create groups and feeds
	group1, err := st.CreateGroup(1, "Technology")
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}

	group2, err := st.CreateGroup(1, "News")
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}

	_, err = st.CreateFeed(1, group1.ID, "TechCrunch", "https://techcrunch.com/feed", "https://techcrunch.com", "")
	if err != nil {
		t.Fatalf("CreateFeed 1: %v", err)
	}

	_, err = st.CreateFeed(1, group1.ID, "Ars Technica", "https://feeds.arstechnica.com/arstechnica/index", "https://arstechnica.com", "")
	if err != nil {
		t.Fatalf("CreateFeed 2: %v", err)
	}

	_, err = st.CreateFeed(1, group2.ID, "Hacker News", "https://news.ycombinator.com/rss", "https://news.ycombinator.com", "")
	if err != nil {
		t.Fatalf("CreateFeed 3: %v", err)
	}

	r := newTestRouter()
	r.GET("/api/opml/export", func(c *gin.Context) {
		c.Set("userID", int64(1))
		h.exportOPML(c)
	})

	w := performRequest(r, http.MethodGet, "/api/opml/export", nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	body := w.Body.String()

	if !strings.Contains(body, `<opml version="2.0">`) {
		t.Errorf("expected OPML 2.0 root tag, got:\n%s", body)
	}
	if !strings.Contains(body, `<outline text="Technology" title="Technology">`) {
		t.Errorf("expected Technology group outline, got:\n%s", body)
	}
	if !strings.Contains(body, `xmlUrl="https://techcrunch.com/feed"`) {
		t.Errorf("expected TechCrunch xmlUrl, got:\n%s", body)
	}
	if !strings.Contains(body, `xmlUrl="https://news.ycombinator.com/rss"`) {
		t.Errorf("expected Hacker News xmlUrl, got:\n%s", body)
	}
}
