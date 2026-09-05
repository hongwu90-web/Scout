package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"

	"github.com/0x2E/fusion/internal/translator"
	"github.com/gin-gonic/gin"
)

func setupTestTranslator(mockResponseText string) *translator.GoogleTranslator {
	mockResponseJSON := fmt.Sprintf(`[[["%s","original",null,null,3]],null,"ja"]`, mockResponseText)

	mockClient := &http.Client{
		Transport: roundTripFunc(func(req *http.Request) *http.Response {
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(bytes.NewBufferString(mockResponseJSON)),
				Header:     make(http.Header),
			}
		}),
	}

	gt := translator.New()
	gt.Google().SetHTTPClient(mockClient)
	return gt
}

type roundTripFunc func(req *http.Request) *http.Response

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req), nil
}

func TestTranslateItemTitle_Handler(t *testing.T) {
	h, st := newFeverTestHandler(t)
	h.SetTranslator(setupTestTranslator("BOJ to Carefully Assess Additional Rate Hike Decision"))

	group, err := st.CreateGroup(1, "News")
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}

	feed, err := st.CreateFeed(1, group.ID, "Nikkei", "https://example.com/rss", "https://example.com", "")
	if err != nil {
		t.Fatalf("CreateFeed: %v", err)
	}

	item, err := st.CreateItem(1, feed.ID, "guid-1", "日銀、追加利上げの判断を慎重に見極めへ", "https://example.com/1", "content", 1700000000)
	if err != nil {
		t.Fatalf("CreateItem: %v", err)
	}

	r := newTestRouter()
	r.POST("/api/items/:id/translate", func(c *gin.Context) {
		c.Set("userID", int64(1))
		h.translateItemTitle(c)
	})
	r.GET("/api/items/:id", func(c *gin.Context) {
		c.Set("userID", int64(1))
		h.getItem(c)
	})

	// 1. Initial translation call
	w := performRequest(r, http.MethodPost, fmt.Sprintf("/api/items/%d/translate", item.ID), nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp TranslateItemResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if resp.ID != item.ID {
		t.Errorf("expected item ID %d, got %d", item.ID, resp.ID)
	}
	if resp.OriginalTitle != "日銀、追加利上げの判断を慎重に見極めへ" {
		t.Errorf("unexpected original title: %s", resp.OriginalTitle)
	}
	if resp.TranslatedTitle != "BOJ to Carefully Assess Additional Rate Hike Decision" {
		t.Errorf("unexpected translated title: %s", resp.TranslatedTitle)
	}
	if resp.DetectedLang != translator.LangJapanese {
		t.Errorf("expected lang %s, got %s", translator.LangJapanese, resp.DetectedLang)
	}
	if resp.Cached {
		t.Errorf("expected cached false on first translation")
	}

	// 2. Second translation call - should be served from persistent cache
	w2 := performRequest(r, http.MethodPost, fmt.Sprintf("/api/items/%d/translate", item.ID), nil, nil)
	if w2.Code != http.StatusOK {
		t.Fatalf("expected status 200 on cache hit, got %d: %s", w2.Code, w2.Body.String())
	}
	var resp2 TranslateItemResponse
	_ = json.Unmarshal(w2.Body.Bytes(), &resp2)
	if !resp2.Cached {
		t.Errorf("expected cached true on second translation")
	}

	// 3. Verify item in store was updated with translated_title
	wGet := performRequest(r, http.MethodGet, fmt.Sprintf("/api/items/%d", item.ID), nil, nil)
	if wGet.Code != http.StatusOK {
		t.Fatalf("expected status 200 on getItem, got %d", wGet.Code)
	}
	var getItemResp struct {
		Data struct {
			TranslatedTitle string `json:"translated_title"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wGet.Body.Bytes(), &getItemResp)
	if getItemResp.Data.TranslatedTitle != "BOJ to Carefully Assess Additional Rate Hike Decision" {
		t.Errorf("expected GetItem to include translated title, body: %s", wGet.Body.String())
	}
}

func TestTranslateText_Handler(t *testing.T) {
	h, _ := newFeverTestHandler(t)
	h.SetTranslator(setupTestTranslator("China's Central Bank Conducts Reverse Repo Operations"))

	r := newTestRouter()
	r.POST("/api/translate", func(c *gin.Context) {
		c.Set("userID", int64(1))
		h.translateText(c)
	})

	body := mustJSONBody(t, TranslateTextRequest{
		Text: "中国央行开展公开市场逆回购操作",
	})
	w := performRequest(r, http.MethodPost, "/api/translate", body, map[string]string{"Content-Type": "application/json"})

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp TranslateTextResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if resp.OriginalText != "中国央行开展公开市场逆回购操作" {
		t.Errorf("unexpected original text: %s", resp.OriginalText)
	}
	if resp.TranslatedText != "China's Central Bank Conducts Reverse Repo Operations" {
		t.Errorf("unexpected translated text: %s", resp.TranslatedText)
	}
	if resp.DetectedLang != translator.LangChinese {
		t.Errorf("expected lang %s, got %s", translator.LangChinese, resp.DetectedLang)
	}
}
