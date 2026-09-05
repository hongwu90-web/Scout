package handler

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"

	"github.com/0x2E/fusion/internal/auth"
	"github.com/0x2E/fusion/internal/config"
	"github.com/0x2E/fusion/internal/monitor"
	"github.com/0x2E/fusion/internal/pull"
	"github.com/0x2E/fusion/internal/store"
	"github.com/0x2E/fusion/internal/translator"
	"github.com/gin-gonic/gin"
)

type SessionData struct {
	UserID    int64
	ExpiresAt int64
}

type Handler struct {
	store         *store.Store
	config        *config.Config
	passwordHash  string // bcrypt hash computed at startup
	feverAPIKey   string // md5(username:password) used by Fever API
	allowAnonAPI  bool   // true when both password and OIDC auth are disabled
	monitorEngine *monitor.Engine
	translator    *translator.GoogleTranslator
	puller        interface {
		RefreshFeed(ctx context.Context, userID, feedID int64) error
		RefreshAll(ctx context.Context) (int, error)
		GetCloudFeedSync() *pull.CloudFeedSync
	}
	
	sessions          map[string]SessionData        // sessionID -> SessionData
	mu        sync.RWMutex            // protects sessions state
	oidcAuth  *auth.OIDCAuthenticator // nil when OIDC is disabled
	limiter   *loginLimiter
	lastSweep int64

	refreshAllMu      sync.Mutex
	refreshAllRunning bool
}

func New(store *store.Store, config *config.Config, puller interface {
	RefreshFeed(ctx context.Context, userID, feedID int64) error
	RefreshAll(ctx context.Context) (int, error)
	GetCloudFeedSync() *pull.CloudFeedSync
}) (*Handler, error) {
	adminPass := strings.TrimSpace(config.Password)
	if adminPass == "" {
		adminPass = "admin"
	}
	passwordHash, err := auth.HashPassword(adminPass)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	if store != nil {
		if _, err := store.EnsureUser("admin", passwordHash); err != nil {
			slog.Warn("failed to ensure default admin user", "error", err)
		}
	}

	h := &Handler{
		store:        store,
		config:       config,
		passwordHash: passwordHash,
		feverAPIKey:  deriveFeverAPIKey(config.FeverUsername, config.Password),
		allowAnonAPI: strings.TrimSpace(config.Password) == "" && strings.TrimSpace(config.OIDCIssuer) == "",
		translator:   translator.New(),
		puller:       puller,
		sessions:     make(map[string]SessionData),
		limiter:      newLoginLimiter(config.LoginRateLimit, config.LoginWindow, config.LoginBlock),
	}

	if h.allowAnonAPI {
		slog.Warn("authentication is disabled because both password and OIDC are empty")
	}

	if config.OIDCIssuer != "" {
		if strings.TrimSpace(config.OIDCRedirectURI) == "" {
			return nil, fmt.Errorf("FUSION_OIDC_REDIRECT_URI is required when OIDC is enabled")
		}

		oidcAuth, err := auth.NewOIDC(
			context.Background(),
			config.OIDCIssuer,
			config.OIDCClientID,
			config.OIDCClientSecret,
			config.OIDCRedirectURI,
		)
		if err != nil {
			return nil, fmt.Errorf("initialize OIDC: %w", err)
		}
		if config.OIDCAllowedUser != "" {
			oidcAuth.SetAllowedUser(config.OIDCAllowedUser)
		}
		h.oidcAuth = oidcAuth
		slog.Info("OIDC authentication enabled", "issuer", config.OIDCIssuer)
	}

	return h, nil
}

func (h *Handler) SetMonitorEngine(engine *monitor.Engine) {
	h.monitorEngine = engine
}

func (h *Handler) SetTranslator(t *translator.GoogleTranslator) {
	h.translator = t
}

func (h *Handler) SetupRouter() *gin.Engine {
	r := gin.New()
	r.Use(requestLogMiddleware(), recoveryMiddleware())

	if err := h.configureTrustedProxies(r); err != nil {
		slog.Warn("failed to configure trusted proxies", "error", err)
	}

	r.Use(h.corsMiddleware())
	r.POST("/fever", h.fever)
	r.POST("/fever/", h.fever)
	r.POST("/fever.php", h.fever)

	api := r.Group("/api")
	{
		api.POST("/register", h.register)
		api.POST("/sessions", h.login)
		api.DELETE("/sessions", h.logout)

		// OIDC routes (public, no auth middleware)
		api.GET("/oidc/enabled", h.oidcEnabled)
		if h.oidcAuth != nil {
			api.GET("/oidc/login", h.oidcLogin)
			api.GET("/oidc/callback", h.oidcCallback)
			// Compatibility route for deployments that configured redirect_uri without /api.
			r.GET("/oidc/callback", h.oidcCallback)
		}
		api.GET("/feeds/synthetic", h.serveSyntheticFeed)

		auth := api.Group("")
		auth.Use(h.authMiddleware())
		{
			auth.GET("/me", h.getMe)
			auth.PATCH("/me/username", h.updateUsername)
			auth.PATCH("/me/password", h.updatePassword)
			auth.GET("/groups", h.listGroups)
			auth.POST("/groups", h.createGroup)
			auth.GET("/groups/:id", h.getGroup)
			auth.PATCH("/groups/:id", h.updateGroup)
			auth.DELETE("/groups/:id", h.deleteGroup)

			auth.GET("/feeds", h.listFeeds)
			auth.GET("/feeds/export", h.exportOPML)
			auth.GET("/opml/export", h.exportOPML)
			auth.POST("/feeds", h.createFeed)
			auth.POST("/feeds/batch", h.batchCreateFeeds)
			auth.POST("/feeds/refresh", h.refreshAllFeeds)
			auth.GET("/feeds/:id", h.getFeed)
			auth.PATCH("/feeds/:id", h.updateFeed)
			auth.DELETE("/feeds/:id", h.deleteFeed)
			auth.POST("/feeds/validate", h.validateFeed)
			auth.GET("/feeds/search-online", h.searchOnlineFeeds)
			auth.POST("/feeds/build/preview", h.previewFeedBuild)
			auth.POST("/feeds/:id/refresh", h.refreshFeed)

			auth.GET("/items", h.listItems)
			auth.GET("/items/:id", h.getItem)
			auth.PATCH("/items/-/read", h.markItemsRead)
			auth.PATCH("/items/-/unread", h.markItemsUnread)
			auth.POST("/items/mark-read-by-date", h.markItemsReadByDate)
			auth.DELETE("/items/read", h.purgeReadItems)
			auth.POST("/items/:id/translate", h.translateItemTitle)
			auth.POST("/translate", h.translateText)

			auth.GET("/search", h.search)

			auth.GET("/bookmarks", h.listBookmarks)
			auth.POST("/bookmarks", h.createBookmark)
			auth.POST("/bookmarks/batch", h.batchCreateBookmarks)
			auth.POST("/bookmarks/batch-delete", h.batchDeleteBookmarks)
			auth.GET("/bookmarks/:id", h.getBookmark)
			auth.DELETE("/bookmarks/:id", h.deleteBookmark)
			auth.DELETE("/bookmarks", h.deleteAllBookmarks)

			// Labels
			auth.GET("/labels", h.listLabels)
			auth.POST("/labels", h.createLabel)
			auth.DELETE("/labels/:id", h.deleteLabel)
			auth.POST("/items/labels/batch", h.batchUpdateItemLabels)
			auth.POST("/items/labels", h.getItemLabels)

			// Focus Feeds (Keyword Focus)
			auth.GET("/focus-feeds", h.listFocusFeeds)
			auth.POST("/focus-feeds", h.createFocusFeed)
			auth.GET("/focus-feeds/:id", h.getFocusFeed)
			auth.PATCH("/focus-feeds/:id", h.updateFocusFeed)
			auth.DELETE("/focus-feeds/:id", h.deleteFocusFeed)
			auth.GET("/focus-feeds/:id/items", h.listFocusFeedItems)

			// Webpage Monitor Routes
			auth.GET("/monitored-groups", h.listMonitoredGroups)
			auth.POST("/monitored-groups", h.createMonitoredGroup)
			auth.PATCH("/monitored-groups/:id", h.updateMonitoredGroup)
			auth.DELETE("/monitored-groups/:id", h.deleteMonitoredGroup)

			auth.GET("/monitored-pages", h.listMonitoredPages)
			auth.POST("/monitored-pages", h.createMonitoredPage)
			auth.POST("/monitored-pages/preview", h.previewSelector)
			auth.GET("/monitored-pages/:id", h.getMonitoredPage)
			auth.PATCH("/monitored-pages/:id", h.updateMonitoredPage)
			auth.DELETE("/monitored-pages/:id", h.deleteMonitoredPage)
			auth.PATCH("/monitored-pages/:id/read", h.markMonitoredPageRead)
			auth.POST("/monitored-pages/:id/check", h.checkMonitoredPageNow)
			auth.GET("/monitored-pages/:id/snapshots", h.listPageSnapshots)
			auth.PATCH("/monitored-pages/:id/snapshots/:snapshotId/read", h.markPageSnapshotRead)
			auth.DELETE("/monitored-pages/:id/snapshots/:snapshotId", h.deletePageSnapshot)
			auth.POST("/monitored-pages/sync", h.syncCloudMonitors)
			auth.GET("/monitored-pages/cloud-status", h.getCloudMonitorStatus)
			auth.POST("/monitored-pages/:id/snapshots/delete", h.batchDeletePageSnapshots)
			auth.DELETE("/monitored-pages/:id/snapshots", h.batchDeletePageSnapshots)
		}
	}

	if err := h.setupFrontendRoutes(r); err != nil {
		slog.Warn("failed to configure frontend routes", "error", err)
	}

	return r
}

func (h *Handler) configureTrustedProxies(r *gin.Engine) error {
	if h.config == nil || len(h.config.TrustedProxies) == 0 {
		return r.SetTrustedProxies(nil)
	}

	return r.SetTrustedProxies(h.config.TrustedProxies)
}

func (h *Handler) corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := strings.TrimSpace(c.Request.Header.Get("Origin"))
		if origin != "" {
			if !h.isOriginAllowed(origin) {
				c.AbortWithStatus(http.StatusForbidden)
				return
			}
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Vary", "Origin")
			if h.isCredentialsAllowed(origin) {
				c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
			}
		} else {
			c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		}
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, PATCH, DELETE")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

func (h *Handler) isCredentialsAllowed(origin string) bool {
	// Always allow loopback origins for local desktop app and dev server
	if isLocalhostOrigin(origin) {
		return true
	}

	// Only allow credentials if origin was explicitly enumerated in CORSAllowedOrigins
	if h.config != nil && len(h.config.CORSAllowedOrigins) > 0 {
		normalizedOrigin := normalizeOrigin(origin)
		for _, allowed := range h.config.CORSAllowedOrigins {
			normalizedAllowed := normalizeOrigin(allowed)
			if normalizedAllowed != "*" && normalizedAllowed == normalizedOrigin {
				return true
			}
		}
	}

	return false
}

func isLocalhostOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	h := u.Hostname()
	return h == "localhost" || h == "127.0.0.1" || h == "::1"
}

func (h *Handler) isOriginAllowed(origin string) bool {
	if h.config == nil {
		return true
	}

	if len(h.config.CORSAllowedOrigins) == 0 {
		return true
	}

	normalizedOrigin := normalizeOrigin(origin)
	for _, allowed := range h.config.CORSAllowedOrigins {
		normalizedAllowed := normalizeOrigin(allowed)
		if normalizedAllowed == "*" || normalizedAllowed == normalizedOrigin {
			return true
		}
	}

	return false
}

func normalizeOrigin(origin string) string {
	origin = strings.TrimSpace(origin)
	origin = strings.TrimSuffix(origin, "/")
	return strings.ToLower(origin)
}

func (h *Handler) authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set("userID", int64(1))
		c.Next()
	}
}

func getUserID(c *gin.Context) int64 {
	id := c.GetInt64("userID")
	if id == 0 {
		return 1
	}
	return id
}

func dataResponse(c *gin.Context, data any) {
	c.JSON(200, gin.H{"data": data})
}

func listResponse(c *gin.Context, data any, total int) {
	c.JSON(200, gin.H{"data": data, "total": total})
}

// paginatedListResponse emits a list payload with a cursor-based next_cursor.
// nextCursor is non-nil only when more pages may exist; nil means "no more".
func paginatedListResponse(c *gin.Context, data any, total int, nextCursor *string) {
	c.JSON(200, gin.H{"data": data, "total": total, "next_cursor": nextCursor})
}

// parseCursor decodes a "<value>_<id>" cursor into its two int64 components.
// Shared by list endpoints that paginate on a composite (timestamp, id) key.
func parseCursor(cursor string) (first int64, second int64, err error) {
	parts := strings.SplitN(cursor, "_", 2)
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("malformed cursor")
	}
	first, err = strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, 0, fmt.Errorf("malformed cursor")
	}
	second, err = strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return 0, 0, fmt.Errorf("malformed cursor")
	}
	return first, second, nil
}
