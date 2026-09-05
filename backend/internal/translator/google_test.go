package translator

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestParseGoogleResponse_ChromeExtensionFormat(t *testing.T) {
	rawJSON := []byte(`[["Chinese technology giants are accelerating the layout of new artificial intelligence tracks","zh-CN"]]`)

	translated, lang, err := parseGoogleResponse(rawJSON)
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}

	expectedTranslated := "Chinese technology giants are accelerating the layout of new artificial intelligence tracks"
	if translated != expectedTranslated {
		t.Errorf("expected %q, got %q", expectedTranslated, translated)
	}

	if lang != LangChinese {
		t.Errorf("expected lang %q, got %q", LangChinese, lang)
	}
}

func TestParseGoogleResponse_MultiChunkWebFormat(t *testing.T) {
	rawJSON := []byte(`[[["Chinese tech giants accelerate their layout in the new AI track","中国科技巨头加速布局人工智能新赛道",null,null,3,null,null,[[]],[[["af64405095a399ceb1e05c7abb7cda66","zh_en_2023q1.md"]]]]],null,"zh-CN",null,null,null,1,[],[["zh-CN"],null,[1],["zh-CN"]]]`)

	translated, lang, err := parseGoogleResponse(rawJSON)
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}

	expectedTranslated := "Chinese tech giants accelerate their layout in the new AI track"
	if translated != expectedTranslated {
		t.Errorf("expected %q, got %q", expectedTranslated, translated)
	}

	if lang != LangChinese {
		t.Errorf("expected lang %q, got %q", LangChinese, lang)
	}
}

func TestGoogleClientTranslate_MockServer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("q")
		if q == "" {
			http.Error(w, "missing q", http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`[["Mocked Translation for ` + q + `","zh-CN"]]`))
	}))
	defer server.Close()

	client := NewGoogleClient()
	client.SetBaseURL(server.URL)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	translated, lang, err := client.Translate(ctx, "测试标题", "auto", "en")
	if err != nil {
		t.Fatalf("unexpected translate error: %v", err)
	}

	if translated != "Mocked Translation for 测试标题" {
		t.Errorf("unexpected translated text: %s", translated)
	}
	if lang != LangChinese {
		t.Errorf("unexpected lang: %s", lang)
	}
}

func TestGoogleTranslator(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`[["Google Fast Translation","zh-CN"]]`))
	}))
	defer server.Close()

	gt := New()
	gt.Google().SetBaseURL(server.URL)

	translated, err := gt.TranslateTitle(context.Background(), "原文")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if translated != "Google Fast Translation" {
		t.Errorf("expected 'Google Fast Translation', got %q", translated)
	}
}

func TestLiveTranslation(t *testing.T) {
	client := NewGoogleClient()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	translated, lang, err := client.Translate(ctx, "乌克兰总统泽连斯基就撤换国防部长费多罗夫一事阐述分歧原因", "auto", "en")
	if err != nil {
		t.Fatalf("live translate failed: %v", err)
	}

	t.Logf("Live translated result: %s (detected: %s)", translated, lang)
	if translated == "" {
		t.Errorf("expected non-empty translation")
	}
}
