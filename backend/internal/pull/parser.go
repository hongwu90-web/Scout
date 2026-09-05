package pull

import (
	"context"
	"bytes"
	"crypto/sha256"
	"encoding/xml"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/0x2E/fusion/internal/feedbuilder"
	"github.com/0x2E/fusion/internal/model"
	"github.com/0x2E/fusion/internal/pkg/httpc"
	"github.com/mmcdole/gofeed"
)

// ParsedItem represents a feed item after parsing and field mapping.
type ParsedItem struct {
	GUID    string
	Title   string
	Link    string
	Content string
	PubDate int64
}

type FetchResult struct {
	Items           []*ParsedItem
	SiteURL         string
	HTTPStatus      int
	NotModified     bool
	ETag            string
	LastModified    string
	CacheControl    string
	ExpiresAt       int64
	RetryAfterUntil int64
	NextURL         string
}

// FetchAndParse fetches RSS/Atom feed with conditional request headers.
// It returns fetch metadata plus parsed items when response status is 200.
func FetchAndParse(ctx context.Context, feed *model.Feed, targetURL string, timeout time.Duration, allowPrivateFeeds bool) (*FetchResult, error) {
	result := &FetchResult{}

	if strings.HasPrefix(targetURL, "/api/feeds/synthetic") {
		parsedURL, err := url.Parse(targetURL)
		if err != nil {
			return nil, fmt.Errorf("invalid synthetic url: %w", err)
		}
		rawTarget := parsedURL.Query().Get("url")
		selector := parsedURL.Query().Get("selector")
		xmlBytes, _, err := feedbuilder.BuildRSSFromWebpage(ctx, rawTarget, selector, allowPrivateFeeds)
		if err != nil {
			return nil, fmt.Errorf("build synthetic feed: %w", err)
		}

		fp := gofeed.NewParser()
		parsedFeed, err := fp.Parse(bytes.NewReader(xmlBytes))
		if err != nil {
			return nil, fmt.Errorf("parse synthetic feed: %w", err)
		}

		siteURL := normalizeSiteURL(rawTarget)
		baseURL, _ := url.Parse(siteURL)

		items := make([]*ParsedItem, 0, len(parsedFeed.Items))
		for _, item := range parsedFeed.Items {
			items = append(items, mapItem(item, baseURL))
		}

		result.HTTPStatus = http.StatusOK
		result.Items = items
		result.SiteURL = siteURL
		return result, nil
	}

	if err := httpc.ValidateRequestURL(ctx, targetURL, allowPrivateFeeds); err != nil {
		return nil, fmt.Errorf("validate feed url: %w", err)
	}

	client, err := httpc.NewClient(timeout, feed.Proxy, allowPrivateFeeds)
	if err != nil {
		return nil, fmt.Errorf("create client: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", targetURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpc.SetDefaultHeaders(req)
	if targetURL == feed.Link {
		setConditionalHeaders(req, feed)
	}

	payload, err := httpc.DoWithFallback(ctx, client, req)
	if err != nil {
		return nil, fmt.Errorf("fetch feed: %w", err)
	}

	now := time.Now().Unix()
	result.HTTPStatus = payload.StatusCode
	result.ETag = strings.TrimSpace(payload.Header.Get("ETag"))
	result.LastModified = strings.TrimSpace(payload.Header.Get("Last-Modified"))
	result.CacheControl = strings.TrimSpace(payload.Header.Get("Cache-Control"))
	result.ExpiresAt = parseHTTPTime(payload.Header.Get("Expires"))
	result.RetryAfterUntil = parseRetryAfter(payload.Header.Get("Retry-After"), now)

	if payload.StatusCode == http.StatusNotModified {
		result.NotModified = true
		return result, nil
	}

	if payload.StatusCode != http.StatusOK {
		return result, fmt.Errorf("HTTP %d", payload.StatusCode)
	}

	bodyBytes := payload.Body

	fp := gofeed.NewParser()
	parsedFeed, err := fp.Parse(bytes.NewReader(bodyBytes))
	if err != nil {
		return result, fmt.Errorf("parse feed: %w", err)
	}

	siteURL := normalizeSiteURL(parsedFeed.Link)

	baseURL, _ := url.Parse(feed.SiteURL)
	if baseURL == nil || baseURL.String() == "" {
		baseURL, _ = url.Parse(siteURL)
	}
	if baseURL == nil || baseURL.String() == "" {
		baseURL, _ = url.Parse(targetURL)
	}

	nextURL := extractNextLink(bodyBytes)
	if nextURL != "" && baseURL != nil {
		if absURL, err := baseURL.Parse(nextURL); err == nil {
			nextURL = absURL.String()
		}
	}
	result.NextURL = nextURL

	items := make([]*ParsedItem, 0, len(parsedFeed.Items))
	for _, item := range parsedFeed.Items {
		items = append(items, mapItem(item, baseURL))
	}

	result.Items = items
	result.SiteURL = siteURL
	return result, nil
}

func setConditionalHeaders(req *http.Request, feed *model.Feed) {
	if req == nil || feed == nil {
		return
	}

	if etag := strings.TrimSpace(feed.FetchState.ETag); etag != "" {
		req.Header.Set("If-None-Match", etag)
	}

	if lastModified := strings.TrimSpace(feed.FetchState.LastModified); lastModified != "" {
		req.Header.Set("If-Modified-Since", lastModified)
	}
}

func parseHTTPTime(value string) int64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}

	parsed, err := http.ParseTime(value)
	if err != nil {
		return 0
	}

	return parsed.Unix()
}

func parseRetryAfter(value string, now int64) int64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}

	if seconds, err := strconv.ParseInt(value, 10, 64); err == nil {
		if seconds <= 0 {
			return 0
		}
		return now + seconds
	}

	parsed, err := http.ParseTime(value)
	if err != nil {
		return 0
	}

	unix := parsed.Unix()
	if unix <= now {
		return 0
	}

	return unix
}

func normalizeSiteURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}

	parsed, err := url.Parse(raw)
	if err != nil || parsed == nil {
		return ""
	}
	if parsed.Host == "" {
		return ""
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return ""
	}

	parsed.Fragment = ""
	return parsed.String()
}

// mapItem converts gofeed.Item to ParsedItem following mapping rules:
// - guid: prefer GUID, fallback to Link
// - content: prefer Content, fallback to Description
// - pub_date: prefer PublishedParsed, fallback to UpdatedParsed
// - link: convert to absolute URL
func mapItem(item *gofeed.Item, baseURL *url.URL) *ParsedItem {
	content := item.Content
	if content == "" {
		content = item.Description
	}

	var sourcePubDate int64
	hasSourcePubDate := false
	var pubDate int64
	if item.PublishedParsed != nil {
		sourcePubDate = item.PublishedParsed.Unix()
		hasSourcePubDate = true
		pubDate = sourcePubDate
	} else if item.UpdatedParsed != nil {
		sourcePubDate = item.UpdatedParsed.Unix()
		hasSourcePubDate = true
		pubDate = sourcePubDate
	} else {
		pubDate = time.Now().Unix()
	}

	rawLink := strings.TrimSpace(item.Link)
	link := rawLink
	if rawLink != "" && baseURL != nil {
		if absURL, err := baseURL.Parse(rawLink); err == nil {
			link = absURL.String()
		}
	}

	guid := strings.TrimSpace(item.GUID)
	if guid == "" {
		guid = strings.TrimSpace(link)
	}
	if guid == "" {
		guid = fallbackGUID(item.Title, content, sourcePubDate, hasSourcePubDate)
	}

	return &ParsedItem{
		GUID:    guid,
		Title:   item.Title,
		Link:    link,
		Content: content,
		PubDate: pubDate,
	}
}

func fallbackGUID(title, content string, sourcePubDate int64, hasSourcePubDate bool) string {
	pubDatePart := ""
	if hasSourcePubDate {
		pubDatePart = strconv.FormatInt(sourcePubDate, 10)
	}

	h := sha256.Sum256([]byte(strings.TrimSpace(title) + "\n" + strings.TrimSpace(content) + "\n" + pubDatePart))
	return "generated:" + hex.EncodeToString(h[:])
}

func extractNextLink(data []byte) string {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	for {
		t, _ := decoder.Token()
		if t == nil {
			break
		}
		switch se := t.(type) {
		case xml.StartElement:
			if se.Name.Local == "link" {
				var rel, href string
				for _, attr := range se.Attr {
					if attr.Name.Local == "rel" {
						rel = strings.ToLower(strings.TrimSpace(attr.Value))
					}
					if attr.Name.Local == "href" {
						href = strings.TrimSpace(attr.Value)
					}
				}
				if (rel == "next" || rel == "next-archive" || rel == "prev-archive") && href != "" {
					return href
				}
			}
		}
	}
	return ""
}
