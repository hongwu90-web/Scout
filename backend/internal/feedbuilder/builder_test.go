package feedbuilder

import (
	"context"
	"net/url"
	"strings"
	"testing"

	"github.com/PuerkitoBio/goquery"
)

func TestBuildRSSFromHTML(t *testing.T) {
	htmlData := `<!DOCTYPE html>
<html>
<head><title>Company Newsroom</title></head>
<body>
  <h1>Recent Announcements</h1>
  <article>
    <h2><a href="/news/item-1">Launch of New AI Model</a></h2>
    <p>We are thrilled to announce our next-generation reasoning model.</p>
    <time datetime="2026-09-04">Sept 4, 2026</time>
  </article>
  <article>
    <h2><a href="/news/item-2">Global Partner Summit Announced</a></h2>
    <p>Join us in Tokyo for our annual summit with international partners.</p>
    <time datetime="2026-09-03">Sept 3, 2026</time>
  </article>
</body>
</html>`

	doc, err := goquery.NewDocumentFromReader(strings.NewReader(htmlData))
	if err != nil {
		t.Fatalf("failed to parse html: %v", err)
	}
	parsedURL, _ := url.Parse("https://example.com/news")

	xmlBytes, preview, err := BuildRSSFromHTML(doc, parsedURL, "https://example.com/news", "article")
	if err != nil {
		t.Fatalf("BuildRSSFromHTML failed: %v", err)
	}

	if preview == nil || preview.ItemsCount != 2 {
		t.Fatalf("expected 2 items, got %+v", preview)
	}

	if preview.Items[0].Title != "Launch of New AI Model" {
		t.Errorf("unexpected item title: %s", preview.Items[0].Title)
	}

	xmlStr := string(xmlBytes)
	if !strings.Contains(xmlStr, "<rss version=\"2.0\">") {
		t.Errorf("expected valid RSS 2.0 XML, got: %s", xmlStr)
	}
	if !strings.Contains(xmlStr, "<title>Launch of New AI Model</title>") {
		t.Errorf("expected item title in XML, got: %s", xmlStr)
	}

	if len(preview.SuggestedSelectors) == 0 {
		t.Errorf("expected suggested selectors, got none")
	} else if preview.SuggestedSelectors[0].Selector != "article" {
		t.Errorf("expected top suggested selector to be 'article', got: %s", preview.SuggestedSelectors[0].Selector)
	}
}

func TestAutoDetectWithoutUserSelector(t *testing.T) {
	htmlData := `<!DOCTYPE html>
<html>
<head><title>Tech Blog</title></head>
<body>
  <div class="post">
    <h3><a href="/post/1">Story One</a></h3>
    <p>Excerpt for story 1</p>
  </div>
  <div class="post">
    <h3><a href="/post/2">Story Two</a></h3>
    <p>Excerpt for story 2</p>
  </div>
  <div class="post">
    <h3><a href="/post/3">Story Three</a></h3>
    <p>Excerpt for story 3</p>
  </div>
</body>
</html>`

	doc, err := goquery.NewDocumentFromReader(strings.NewReader(htmlData))
	if err != nil {
		t.Fatalf("failed to parse html: %v", err)
	}
	parsedURL, _ := url.Parse("https://example.com/blog")

	_, preview, err := BuildRSSFromHTML(doc, parsedURL, "https://example.com/blog", "")
	if err != nil {
		t.Fatalf("auto-detect failed: %v", err)
	}

	if preview.ItemsCount != 3 {
		t.Errorf("expected 3 items detected, got %d", preview.ItemsCount)
	}

	if len(preview.SuggestedSelectors) == 0 {
		t.Fatalf("expected candidate suggestions, got 0")
	}

	foundPost := false
	for _, s := range preview.SuggestedSelectors {
		if s.Selector == ".post" {
			foundPost = true
			if s.Count != 3 {
				t.Errorf("expected count 3 for .post, got %d", s.Count)
			}
			if s.Sample != "Story One" {
				t.Errorf("expected sample 'Story One', got '%s'", s.Sample)
			}
		}
	}
	if !foundPost {
		t.Errorf("expected .post among suggested selectors, got: %+v", preview.SuggestedSelectors)
	}
}

func TestLiveCaixinDebug(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping live test in short mode")
	}
	_, preview, err := BuildRSSFromWebpage(context.Background(), "https://www.caixinglobal.com/", "", true)
	if err != nil {
		t.Skipf("skipping live test due to network/sandbox: %v", err)
	}

	t.Logf("Selected: %q with %d items", preview.SelectorUsed, preview.ItemsCount)
	t.Logf("Suggestions count: %d", len(preview.SuggestedSelectors))
	for _, s := range preview.SuggestedSelectors {
		t.Logf("  - %q: %d items (sample: %q)", s.Selector, s.Count, s.Sample)
	}

	if preview.ItemsCount < 5 {
		t.Errorf("expected at least 5 items, got %d", preview.ItemsCount)
	}
}



