package monitor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/0x2E/fusion/internal/config"
	"github.com/0x2E/fusion/internal/pkg/httpc"
	"github.com/PuerkitoBio/goquery"
)

type ScrapeResult struct {
	URL           string
	StatusCode    int
	ContentText   string
	Hash          string
	ElementsCount int
	Error         error
}

type Scraper struct {
	client *http.Client
}

func NewScrapeEngine(cfg *config.Config) *Scraper {
	client, err := httpc.NewClient(30*time.Second, "", cfg.AllowPrivateFeeds)
	if err != nil {
		// Fallback to default http.Client if error
		client = &http.Client{Timeout: 30 * time.Second}
	}
	return &Scraper{
		client: client,
	}
}

func (s *Scraper) Scrape(ctx context.Context, targetURL, cssSelector, stripSelectors string) *ScrapeResult {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return &ScrapeResult{URL: targetURL, Error: fmt.Errorf("create request: %w", err)}
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7")
	req.Header.Set("Sec-Ch-Ua", `"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"`)
	req.Header.Set("Sec-Ch-Ua-Mobile", "?0")
	req.Header.Set("Sec-Ch-Ua-Platform", `"macOS"`)
	req.Header.Set("Sec-Fetch-Dest", "document")
	req.Header.Set("Sec-Fetch-Mode", "navigate")
	req.Header.Set("Sec-Fetch-Site", "none")
	req.Header.Set("Sec-Fetch-User", "?1")
	req.Header.Set("Upgrade-Insecure-Requests", "1")

	resp, err := s.client.Do(req)
	if err != nil {
		return &ScrapeResult{URL: targetURL, Error: fmt.Errorf("http request: %w", err)}
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &ScrapeResult{
			URL:        targetURL,
			StatusCode: resp.StatusCode,
			Error:      fmt.Errorf("http error status: %d", resp.StatusCode),
		}
	}

	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return &ScrapeResult{
			URL:        targetURL,
			StatusCode: resp.StatusCode,
			Error:      fmt.Errorf("parse html: %w", err),
		}
	}

	// Always strip non-content elements
	defaultStrips := []string{"script", "style", "noscript", "iframe", "svg"}
	for _, sel := range defaultStrips {
		doc.Find(sel).Remove()
	}

	// Strip user custom selectors
	if stripSelectors != "" {
		parts := strings.Split(stripSelectors, ",")
		for _, p := range parts {
			trimmed := strings.TrimSpace(p)
			if trimmed != "" {
				doc.Find(trimmed).Remove()
			}
		}
	}

	var selection *goquery.Selection
	trimmedSelector := strings.TrimSpace(cssSelector)
	if trimmedSelector != "" {
		selection = doc.Find(trimmedSelector)
	} else {
		selection = doc.Find("body")
		if selection.Length() == 0 {
			selection = doc.Selection
		}
	}

	elementsCount := selection.Length()
	contentText := extractStructuredText(selection)

	hasher := sha256.New()
	_, _ = io.WriteString(hasher, contentText)
	hash := hex.EncodeToString(hasher.Sum(nil))

	return &ScrapeResult{
		URL:           targetURL,
		StatusCode:    resp.StatusCode,
		ContentText:   contentText,
		Hash:          hash,
		ElementsCount: elementsCount,
	}
}

func extractStructuredText(selection *goquery.Selection) string {
	var sb strings.Builder
	hasWrittenHeading := false

	// Traverse semantic block-level nodes
	selection.Find("h1, h2, h3, h4, h5, h6, p, li, tr, blockquote, pre, div, article, section").Each(func(_ int, s *goquery.Selection) {
		tagName := goquery.NodeName(s)
		text := strings.TrimSpace(s.Text())
		if text == "" {
			return
		}

		isH := tagName == "h1" || tagName == "h2" || tagName == "h3" || tagName == "h4" || tagName == "h5" || tagName == "h6"

		// If this is a container div/article/section that contains child block elements, skip the parent container so child nodes render cleanly
		if !isH && s.Find("h1, h2, h3, h4, h5, h6, p, li, tr, blockquote, pre, article, section").Length() > 0 {
			return
		}

		if isH {
			if sb.Len() > 0 {
				sb.WriteString("\n\n")
			}
			sb.WriteString("## ")
			sb.WriteString(text)
			sb.WriteString("\n")
			hasWrittenHeading = true
		} else {
			if !hasWrittenHeading {
				sb.WriteString("## Overview\n")
				hasWrittenHeading = true
			}
			if tagName == "li" {
				sb.WriteString("- ")
				sb.WriteString(text)
				sb.WriteString("\n")
			} else {
				sb.WriteString(text)
				sb.WriteString("\n")
			}
		}
	})

	if sb.Len() == 0 {
		// Fallback for simple elements or unstructured plain text
		raw := selection.Text()
		lines := strings.Split(raw, "\n")
		var validLines []string
		for _, line := range lines {
			t := strings.TrimSpace(line)
			if t != "" {
				validLines = append(validLines, t)
			}
		}
		if len(validLines) > 0 {
			sb.WriteString("## Content\n")
			sb.WriteString(strings.Join(validLines, "\n"))
		}
	}

	return strings.TrimSpace(sb.String())
}
