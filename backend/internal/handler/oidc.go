package handler

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
)

func (h *Handler) oidcEnabled(c *gin.Context) {
	dataResponse(c, gin.H{"enabled": h.oidcAuth != nil})
}

func (h *Handler) oidcLogin(c *gin.Context) {
	if h.oidcAuth == nil {
		badRequestError(c, "OIDC is not configured")
		return
	}

	authURL, err := h.oidcAuth.AuthURL()
	if err != nil {
		internalError(c, err, "oidc auth url")
		return
	}

	dataResponse(c, gin.H{"auth_url": authURL})
}

func (h *Handler) oidcCallback(c *gin.Context) {
	if h.oidcAuth == nil {
		badRequestError(c, "OIDC is not configured")
		return
	}

	state := c.Query("state")
	code := c.Query("code")
	if state == "" || code == "" {
		c.Redirect(http.StatusTemporaryRedirect, "/login?error=oidc_failed")
		return
	}

	username, err := h.oidcAuth.Callback(c.Request.Context(), state, code)
	if err != nil {
		slog.Error("OIDC callback failed", "error", err)
		c.Redirect(http.StatusTemporaryRedirect, "/login?error=oidc_failed")
		return
	}

	user, err := h.store.GetUserByUsername(username)
	var userID int64
	if err != nil {
		userID, err = h.store.CreateUser(username, "")
		if err != nil {
			slog.Error("Failed to create OIDC user", "error", err)
			c.Redirect(http.StatusTemporaryRedirect, "/login?error=oidc_failed")
			return
		}
	} else {
		userID = user.ID
	}

	slog.Info("OIDC login successful", "username", username, "userID", userID)
	h.createSession(c, userID)
	c.Redirect(http.StatusTemporaryRedirect, "/")
}
