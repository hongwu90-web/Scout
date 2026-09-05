package handler

import (
	"crypto/md5"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/0x2E/fusion/internal/auth"
	"github.com/0x2E/fusion/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	sessionTTL           = 30 * 24 * time.Hour
	sessionSweepInterval = 60 * time.Second
)

type loginState struct {
	windowStart int64
	failures    int
	blockedTill int64
}

type loginLimiter struct {
	mu           sync.Mutex
	states       map[string]loginState
	limit        int
	windowSecs   int64
	blockSecs    int64
	lastSweepSec int64
}

func newLoginLimiter(limit, windowSecs, blockSecs int) *loginLimiter {
	return &loginLimiter{
		states:     make(map[string]loginState),
		limit:      limit,
		windowSecs: int64(windowSecs),
		blockSecs:  int64(blockSecs),
	}
}

func (l *loginLimiter) allow(ip string, now time.Time) (bool, int64) {
	nowSec := now.Unix()

	l.mu.Lock()
	defer l.mu.Unlock()

	l.sweep(nowSec)

	state, ok := l.states[ip]
	if !ok {
		return true, 0
	}
	if state.blockedTill > nowSec {
		return false, state.blockedTill - nowSec
	}

	return true, 0
}

func (l *loginLimiter) recordFailure(ip string, now time.Time) {
	nowSec := now.Unix()

	l.mu.Lock()
	defer l.mu.Unlock()

	l.sweep(nowSec)

	state := l.states[ip]
	if state.windowStart == 0 || nowSec-state.windowStart >= l.windowSecs {
		state.windowStart = nowSec
		state.failures = 0
	}

	state.failures++
	if state.failures >= l.limit {
		state.blockedTill = nowSec + l.blockSecs
		state.windowStart = nowSec
		state.failures = 0
	}

	l.states[ip] = state
}

func (l *loginLimiter) recordSuccess(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.states, ip)
}

func (l *loginLimiter) sweep(nowSec int64) {
	if nowSec-l.lastSweepSec < 60 {
		return
	}
	l.lastSweepSec = nowSec

	for ip, state := range l.states {
		windowExpired := state.windowStart > 0 && nowSec-state.windowStart >= l.windowSecs
		unblocked := state.blockedTill > 0 && state.blockedTill <= nowSec
		if (state.blockedTill == 0 && windowExpired) || unblocked {
			delete(l.states, ip)
		}
	}
}

func isSecureRequest(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return r.Header.Get("X-Forwarded-Proto") == "https"
}

type registerRequest struct {
	Username *string `json:"username"`
	Password *string `json:"password"`
}

func (h *Handler) register(c *gin.Context) {
	if !h.config.EnableRegistration {
		forbiddenError(c, "registration is disabled")
		return
	}

	var req registerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, "invalid request")
		return
	}
	if req.Username == nil || req.Password == nil || *req.Username == "" || *req.Password == "" {
		badRequestError(c, "invalid request")
		return
	}

	hash, err := auth.HashPassword(*req.Password)
	if err != nil {
		internalError(c, err, "hash password")
		return
	}

	userID, err := h.store.CreateUser(*req.Username, hash)
	if err != nil {
		if errors.Is(err, store.ErrAlreadyExists) {
			badRequestError(c, "username already taken")
			return
		}
		internalError(c, err, "create user")
		return
	}

	sum := md5.Sum([]byte(strings.TrimSpace(*req.Username) + ":" + *req.Password))
	feverKey := hex.EncodeToString(sum[:])
	_ = h.store.SetFeverAPIKey(userID, feverKey)

	h.createSession(c, userID)
	dataResponse(c, gin.H{"message": "registered", "user_id": userID})
}

type loginRequest struct {
	Username *string `json:"username"`
	Password *string `json:"password"`
}

func (h *Handler) login(c *gin.Context) {
	ip := c.ClientIP()
	allowed, retryAfter := h.limiter.allow(ip, time.Now())
	if !allowed {
		tooManyRequestsError(c, retryAfter)
		return
	}

	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, "invalid request")
		return
	}
	if req.Password == nil {
		badRequestError(c, "invalid request")
		return
	}

	username := "admin"
	if req.Username != nil && strings.TrimSpace(*req.Username) != "" {
		username = strings.TrimSpace(*req.Username)
	}

	var userID int64 = 1
	if h.store != nil {
		user, err := h.store.GetUserByUsername(username)
		if err != nil {
			h.limiter.recordFailure(ip, time.Now())
			unauthorizedError(c)
			return
		}

		if err := auth.CheckPassword(user.PasswordHash, *req.Password); err != nil {
			h.limiter.recordFailure(ip, time.Now())
			unauthorizedError(c)
			return
		}
		userID = user.ID

		if user.FeverAPIKey == "" {
			sum := md5.Sum([]byte(username + ":" + *req.Password))
			feverKey := hex.EncodeToString(sum[:])
			_ = h.store.SetFeverAPIKey(user.ID, feverKey)
		}
	} else {
		if err := auth.CheckPassword(h.passwordHash, *req.Password); err != nil {
			h.limiter.recordFailure(ip, time.Now())
			unauthorizedError(c)
			return
		}
	}

	h.limiter.recordSuccess(ip)
	h.createSession(c, userID)
	dataResponse(c, gin.H{"message": "logged in"})
}

func (h *Handler) getMe(c *gin.Context) {
	userID := c.GetInt64("userID")
	user, err := h.store.GetUserByID(userID)
	if err != nil {
		internalError(c, err, "get user")
		return
	}
	dataResponse(c, user)
}

func (h *Handler) isSessionValid(sessionID string) (int64, bool) {
	nowSec := time.Now().Unix()

	h.mu.Lock()
	defer h.mu.Unlock()

	h.sweepExpiredSessionsLocked(nowSec)

	data, ok := h.sessions[sessionID]
	if !ok {
		return 0, false
	}

	if data.ExpiresAt <= nowSec {
		delete(h.sessions, sessionID)
		return 0, false
	}

	return data.UserID, true
}

func (h *Handler) sweepExpiredSessionsLocked(nowSec int64) {
	if nowSec-h.lastSweep < int64(sessionSweepInterval.Seconds()) {
		return
	}
	h.lastSweep = nowSec

	for sessionID, data := range h.sessions {
		if data.ExpiresAt <= nowSec {
			delete(h.sessions, sessionID)
		}
	}
}

// createSession generates a new session ID, stores it, and sets the session cookie.
func (h *Handler) createSession(c *gin.Context, userID int64) {
	now := time.Now()
	expiresAt := now.Add(sessionTTL).Unix()
	sessionID := uuid.New().String()

	h.mu.Lock()
	h.sweepExpiredSessionsLocked(now.Unix())
	h.sessions[sessionID] = SessionData{
		UserID:    userID,
		ExpiresAt: expiresAt,
	}
	h.mu.Unlock()

	http.SetCookie(c.Writer, &http.Cookie{
		Name:     "session",
		Value:    sessionID,
		Path:     "/",
		MaxAge:   int(sessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   isSecureRequest(c.Request),
		SameSite: http.SameSiteLaxMode,
	})
}

func (h *Handler) logout(c *gin.Context) {
	sessionID, err := c.Cookie("session")
	if err == nil {
		h.mu.Lock()
		delete(h.sessions, sessionID)
		h.mu.Unlock()
	}

	http.SetCookie(c.Writer, &http.Cookie{
		Name:     "session",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   isSecureRequest(c.Request),
		SameSite: http.SameSiteLaxMode,
	})

	c.Status(http.StatusNoContent)
}

// invalidateOtherSessions removes all sessions belonging to userID except the
// current session (keepSessionID), effectively signing out all other devices.
func (h *Handler) invalidateOtherSessions(userID int64, keepSessionID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for id, data := range h.sessions {
		if data.UserID == userID && id != keepSessionID {
			delete(h.sessions, id)
		}
	}
}

type updateUsernameRequest struct {
	Username string `json:"username"`
}

func (h *Handler) updateUsername(c *gin.Context) {
	userID := getUserID(c)

	var req updateUsernameRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Username) == "" {
		badRequestError(c, "username is required")
		return
	}
	newUsername := strings.TrimSpace(req.Username)

	if err := h.store.UpdateUsername(userID, newUsername); err != nil {
		if errors.Is(err, store.ErrAlreadyExists) {
			badRequestError(c, "username already taken")
			return
		}
		internalError(c, err, "update username")
		return
	}

	dataResponse(c, gin.H{"message": "ok"})
}

type updatePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func (h *Handler) updatePassword(c *gin.Context) {
	userID := getUserID(c)

	var req updatePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, "invalid request")
		return
	}
	if req.CurrentPassword == "" || req.NewPassword == "" {
		badRequestError(c, "current_password and new_password are required")
		return
	}

	// Verify the current password.
	user, err := h.store.GetUserByID(userID)
	if err != nil {
		internalError(c, err, "get user")
		return
	}
	if err := auth.CheckPassword(user.PasswordHash, req.CurrentPassword); err != nil {
		unauthorizedError(c)
		return
	}

	// Hash the new password.
	newHash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		internalError(c, err, "hash password")
		return
	}

	// Re-derive the Fever API key from the (unchanged) username and new password.
	sum := md5.Sum([]byte(user.Username + ":" + req.NewPassword))
	newFeverKey := hex.EncodeToString(sum[:])

	if err := h.store.UpdatePassword(userID, newHash, newFeverKey); err != nil {
		internalError(c, err, "update password")
		return
	}

	// Invalidate all other sessions so other devices are signed out.
	currentSessionID, _ := c.Cookie("session")
	h.invalidateOtherSessions(userID, currentSessionID)

	dataResponse(c, gin.H{"message": "ok"})
}
