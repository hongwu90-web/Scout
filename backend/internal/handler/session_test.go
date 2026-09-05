package handler

import (
	"net/http"
	"strings"
	"testing"

	"github.com/0x2E/fusion/internal/auth"
	"github.com/gin-gonic/gin"
)

func newTestSessionHandler(t *testing.T, password string) *Handler {
	t.Helper()

	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}

	return &Handler{
		passwordHash: hash,
		sessions:     make(map[string]SessionData),
		limiter:      newLoginLimiter(10, 60, 300),
	}
}

func TestLogin(t *testing.T) {
	tests := []struct {
		name           string
		passwordHashOf string
		body           string
		wantStatus     int
		wantCookie     bool
	}{
		{
			name:           "rejects missing password field",
			passwordHashOf: "secret",
			body:           `{}`,
			wantStatus:     http.StatusBadRequest,
		},
		{
			name:           "accepts empty password when configured",
			passwordHashOf: "",
			body:           `{"password":""}`,
			wantStatus:     http.StatusOK,
			wantCookie:     true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newTestSessionHandler(t, tt.passwordHashOf)

			r := newTestRouter()
			r.POST("/api/sessions", h.login)
			w := performRequest(
				r,
				http.MethodPost,
				"/api/sessions",
				strings.NewReader(tt.body),
				map[string]string{"Content-Type": "application/json"},
			)

			if w.Code != tt.wantStatus {
				t.Fatalf("expected status %d, got %d", tt.wantStatus, w.Code)
			}
			if !tt.wantCookie {
				return
			}
			if cookie := w.Header().Get("Set-Cookie"); !strings.Contains(cookie, "session=") {
				t.Fatalf("expected session cookie to be set, got %q", cookie)
			}
		})
	}
}

func TestAuthMiddleware(t *testing.T) {
	h := &Handler{}
	r := newTestRouter()
	r.Use(h.authMiddleware())
	var capturedUserID any
	r.GET("/api/protected", func(c *gin.Context) {
		capturedUserID, _ = c.Get("userID")
		c.Status(http.StatusOK)
	})
	w := performRequest(
		r,
		http.MethodGet,
		"/api/protected",
		nil,
		nil,
	)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}
	if capturedUserID != int64(1) {
		t.Fatalf("expected userID 1, got %v", capturedUserID)
	}
}
