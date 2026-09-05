package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/0x2E/fusion/internal/config"
	"github.com/0x2E/fusion/internal/monitor"
)

func TestCloudMonitorStatus(t *testing.T) {
	h, st := newFeverTestHandler(t)
	cfg := &config.Config{
		CloudMonitorEnabled: true,
		CloudMonitorURL:     "https://scout-cloud-monitor.example.workers.dev",
		CloudMonitorSecret:  "test_secret",
	}
	h.config = cfg
	h.monitorEngine = monitor.NewEngine(st, cfg)

	r := newTestRouter()
	r.GET("/api/monitored-pages/cloud-status", h.getCloudMonitorStatus)

	w := performRequest(r, http.MethodGet, "/api/monitored-pages/cloud-status", nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var res struct {
		Data struct {
			Enabled bool   `json:"enabled"`
			URL     string `json:"url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	if !res.Data.Enabled {
		t.Fatalf("expected cloud monitor enabled true, got false")
	}
	if res.Data.URL != "https://scout-cloud-monitor.example.workers.dev" {
		t.Fatalf("unexpected cloud monitor url: %s", res.Data.URL)
	}
}
