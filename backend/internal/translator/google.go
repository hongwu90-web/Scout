package translator

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	defaultUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

// GoogleClient implements highly resilient, zero-configuration translation
// with automatic endpoint failover (Chrome Extension API -> Web API -> Fallback).
type GoogleClient struct {
	httpClient *http.Client
	customURL  string // for testing overrides
}

// NewGoogleClient creates a new Google Translate client with high resilience.
func NewGoogleClient() *GoogleClient {
	return &GoogleClient{
		httpClient: &http.Client{
			Timeout: 8 * time.Second,
		},
	}
}

// SetHTTPClient allows custom HTTP client injection for testing.
func (g *GoogleClient) SetHTTPClient(client *http.Client) {
	g.httpClient = client
}

// SetBaseURL allows custom base URL override for unit testing.
func (g *GoogleClient) SetBaseURL(u string) {
	g.customURL = u
}

// Translate translates text into targetLang (default "en").
// It attempts multiple Google endpoints sequentially to bypass 429 rate limits.
func (g *GoogleClient) Translate(ctx context.Context, text string, sourceLang, targetLang string) (string, string, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return "", LangEnglish, nil
	}

	if strings.TrimSpace(sourceLang) == "" {
		sourceLang = "auto"
	}
	if strings.TrimSpace(targetLang) == "" {
		targetLang = "en"
	}

	// If a custom URL is configured (e.g. in unit tests), use it directly
	if g.customURL != "" {
		return g.fetchAndParse(ctx, g.customURL+"?q="+url.QueryEscape(text))
	}

	// 1. Primary Endpoint: Google Chrome Extension API (High rate limit, avoids 429)
	url1 := fmt.Sprintf(
		"https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=%s&tl=%s&q=%s",
		url.QueryEscape(sourceLang),
		url.QueryEscape(targetLang),
		url.QueryEscape(text),
	)
	if trans, lang, err := g.fetchAndParse(ctx, url1); err == nil && trans != "" {
		return trans, lang, nil
	} else {
		slog.Debug("translator endpoint 1 (dict-chrome-ex) failed, trying endpoint 2", "err", err)
	}

	// 2. Secondary Endpoint: Google Web Translate (client=at)
	url2 := fmt.Sprintf(
		"https://translate.google.com/translate_a/single?client=at&dt=t&sl=%s&tl=%s&q=%s",
		url.QueryEscape(sourceLang),
		url.QueryEscape(targetLang),
		url.QueryEscape(text),
	)
	if trans, lang, err := g.fetchAndParse(ctx, url2); err == nil && trans != "" {
		return trans, lang, nil
	} else {
		slog.Debug("translator endpoint 2 (web-at) failed, trying endpoint 3", "err", err)
	}

	// 3. Tertiary Endpoint: Googleapis (client=gtx)
	url3 := fmt.Sprintf(
		"https://translate.googleapis.com/translate_a/single?client=gtx&sl=%s&tl=%s&dt=t&q=%s",
		url.QueryEscape(sourceLang),
		url.QueryEscape(targetLang),
		url.QueryEscape(text),
	)
	if trans, lang, err := g.fetchAndParse(ctx, url3); err == nil && trans != "" {
		return trans, lang, nil
	} else {
		slog.Debug("translator endpoint 3 (gtx) failed, trying fallback", "err", err)
	}

	// 4. Quaternary Endpoint: MyMemory Public Translation Memory API
	srcPair := sourceLang
	if srcPair == "auto" {
		srcPair = DetectLanguage(text)
	}
	url4 := fmt.Sprintf(
		"https://api.mymemory.translated.net/get?q=%s&langpair=%s|%s",
		url.QueryEscape(text),
		url.QueryEscape(srcPair),
		url.QueryEscape(targetLang),
	)
	if trans, lang, err := g.fetchMyMemory(ctx, url4, srcPair); err == nil && trans != "" {
		return trans, lang, nil
	}

	return "", "", fmt.Errorf("google translate: all translation endpoints failed")
}

// fetchAndParse fetches from a Google translation URL and parses either Chrome Extension or multidimensional JSON.
func (g *GoogleClient) fetchAndParse(ctx context.Context, reqURL string) (string, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return "", "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("User-Agent", defaultUserAgent)
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")

	resp, err := g.httpClient.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", "", fmt.Errorf("returned status %d: %s", resp.StatusCode, string(body))
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", fmt.Errorf("read response: %w", err)
	}

	return parseGoogleResponse(bodyBytes)
}

// parseGoogleResponse handles both dict-chrome-ex and multidimensional array structures.
func parseGoogleResponse(data []byte) (string, string, error) {
	var raw any
	if err := json.Unmarshal(data, &raw); err != nil {
		return "", "", fmt.Errorf("unmarshal json: %w", err)
	}

	// Case 1: Simple string
	if str, ok := raw.(string); ok && strings.TrimSpace(str) != "" {
		return strings.TrimSpace(str), "auto", nil
	}

	rawArr, ok := raw.([]any)
	if !ok || len(rawArr) == 0 {
		return "", "", fmt.Errorf("empty or non-array json")
	}

	// Case 2: Array of strings e.g. ["Translated Text", "zh-CN"] or [["Translated Text", "zh-CN"]]
	if len(rawArr) > 0 {
		// Subcase 2a: First element is a string
		if firstStr, ok := rawArr[0].(string); ok && strings.TrimSpace(firstStr) != "" {
			detectedLang := "auto"
			if len(rawArr) > 1 {
				if dLang, ok := rawArr[1].(string); ok {
					detectedLang = normalizeGoogleLang(dLang)
				}
			}
			return strings.TrimSpace(firstStr), detectedLang, nil
		}

		// Subcase 2b: First element is an array (Chrome extension format e.g. [["Translated Text", "zh-CN"]])
		if innerArr, ok := rawArr[0].([]any); ok && len(innerArr) > 0 {
			// Check if innerArr[0] is a string (dict-chrome-ex)
			if innerStr, ok := innerArr[0].(string); ok && strings.TrimSpace(innerStr) != "" {
				detectedLang := "auto"
				if len(innerArr) > 1 {
					if dLang, ok := innerArr[1].(string); ok {
						detectedLang = normalizeGoogleLang(dLang)
					}
				}
				// Also check if root array has detected lang at index 2
				if detectedLang == "auto" && len(rawArr) > 2 && rawArr[2] != nil {
					if dLang, ok := rawArr[2].(string); ok {
						detectedLang = normalizeGoogleLang(dLang)
					}
				}
				return strings.TrimSpace(innerStr), detectedLang, nil
			}

			// Subcase 2c: Standard multi-chunk array e.g. [[["chunk1", "orig1"], ["chunk2", "orig2"]], null, "zh-CN"]
			var sb strings.Builder
			for _, chunk := range innerArr {
				if chunkArr, ok := chunk.([]any); ok && len(chunkArr) > 0 {
					if part, ok := chunkArr[0].(string); ok {
						sb.WriteString(part)
					}
				}
			}
			translated := strings.TrimSpace(sb.String())
			if translated != "" {
				detectedLang := "auto"
				if len(rawArr) > 2 && rawArr[2] != nil {
					if dLang, ok := rawArr[2].(string); ok {
						detectedLang = normalizeGoogleLang(dLang)
					}
				}
				return translated, detectedLang, nil
			}
		}
	}

	return "", "", fmt.Errorf("unable to extract translated text from response")
}

// fetchMyMemory handles MyMemory free translation API fallback.
func (g *GoogleClient) fetchMyMemory(ctx context.Context, reqURL, fallbackLang string) (string, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("User-Agent", defaultUserAgent)

	resp, err := g.httpClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("mymemory status %d", resp.StatusCode)
	}

	var mmResp struct {
		ResponseData struct {
			TranslatedText string `json:"translatedText"`
		} `json:"responseData"`
		ResponseStatus int `json:"responseStatus"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&mmResp); err != nil {
		return "", "", err
	}

	trans := strings.TrimSpace(mmResp.ResponseData.TranslatedText)
	if trans == "" || strings.Contains(trans, "MYMEMORY WARNING") {
		return "", "", fmt.Errorf("invalid mymemory response")
	}

	return trans, normalizeGoogleLang(fallbackLang), nil
}

// normalizeGoogleLang normalizes Google's language codes (e.g. "zh-CN" -> "zh", "ja" -> "ja")
func normalizeGoogleLang(lang string) string {
	lang = strings.ToLower(strings.TrimSpace(lang))
	switch {
	case strings.HasPrefix(lang, "zh"):
		return LangChinese
	case strings.HasPrefix(lang, "ja"):
		return LangJapanese
	case strings.HasPrefix(lang, "ko"):
		return LangKorean
	case strings.HasPrefix(lang, "vi"):
		return LangVietnamese
	case strings.HasPrefix(lang, "hi"):
		return LangHindi
	case strings.HasPrefix(lang, "en"):
		return LangEnglish
	default:
		return lang
	}
}
