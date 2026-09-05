package handler

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/0x2E/fusion/internal/model"
	"github.com/0x2E/fusion/internal/store"
	"github.com/gin-gonic/gin"
)

// Monitored Groups Handlers

func (h *Handler) listMonitoredGroups(c *gin.Context) {
	userID := getUserID(c)
	groups, err := h.store.ListMonitoredGroups(userID)
	if err != nil {
		internalError(c, err, "list monitored groups")
		return
	}
	if groups == nil {
		groups = []*model.MonitoredGroup{}
	}
	dataResponse(c, groups)
}

func (h *Handler) createMonitoredGroup(c *gin.Context) {
	userID := getUserID(c)
	var req struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, err.Error())
		return
	}
	group, err := h.store.CreateMonitoredGroup(userID, req.Name)
	if err != nil {
		internalError(c, err, "create monitored group")
		return
	}
	dataResponse(c, group)
}

func (h *Handler) updateMonitoredGroup(c *gin.Context) {
	userID := getUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid id")
		return
	}
	var req struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, err.Error())
		return
	}
	group, err := h.store.UpdateMonitoredGroup(userID, id, req.Name)
	if errors.Is(err, store.ErrNotFound) {
		notFoundError(c, "monitored group")
		return
	}
	if err != nil {
		internalError(c, err, "update monitored group")
		return
	}
	dataResponse(c, group)
}

func (h *Handler) deleteMonitoredGroup(c *gin.Context) {
	userID := getUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid id")
		return
	}
	err = h.store.DeleteMonitoredGroup(userID, id)
	if errors.Is(err, store.ErrNotFound) {
		notFoundError(c, "monitored group")
		return
	}
	if err != nil {
		internalError(c, err, "delete monitored group")
		return
	}
	c.Status(http.StatusNoContent)
}

// Monitored Pages Handlers

func (h *Handler) listMonitoredPages(c *gin.Context) {
	userID := getUserID(c)
	var groupID *int64
	if gStr := c.Query("group_id"); gStr != "" {
		if g, err := strconv.ParseInt(gStr, 10, 64); err == nil {
			groupID = &g
		}
	}
	pages, err := h.store.ListMonitoredPages(userID, groupID)
	if err != nil {
		internalError(c, err, "list monitored pages")
		return
	}
	if pages == nil {
		pages = []*model.MonitoredPage{}
	}
	dataResponse(c, pages)
}

func normalizeMonitorURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.HasPrefix(raw, "http://") && !strings.HasPrefix(raw, "https://") {
		return "https://" + raw
	}
	return raw
}

func (h *Handler) createMonitoredPage(c *gin.Context) {
	userID := getUserID(c)
	var req model.CreateMonitoredPageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, err.Error())
		return
	}
	req.URL = normalizeMonitorURL(req.URL)
	page, err := h.store.CreateMonitoredPage(userID, &req)
	if err != nil {
		internalError(c, err, "create monitored page")
		return
	}

	// Trigger async immediate check on creation and sync to cloud
	if h.monitorEngine != nil {
		go func(pageID int64) {
			_ = h.monitorEngine.CheckPage(context.Background(), userID, pageID)
			if h.monitorEngine.GetCloudSync() != nil && h.monitorEngine.GetCloudSync().IsEnabled() {
				_ = h.monitorEngine.GetCloudSync().PushMonitors(context.Background(), userID)
			}
		}(page.ID)
	}

	dataResponse(c, page)
}

func (h *Handler) getMonitoredPage(c *gin.Context) {
	userID := getUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid id")
		return
	}
	page, err := h.store.GetMonitoredPage(userID, id)
	if errors.Is(err, store.ErrNotFound) {
		notFoundError(c, "monitored page")
		return
	}
	if err != nil {
		internalError(c, err, "get monitored page")
		return
	}
	dataResponse(c, page)
}

func (h *Handler) updateMonitoredPage(c *gin.Context) {
	userID := getUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid id")
		return
	}
	var req model.UpdateMonitoredPageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, err.Error())
		return
	}
	if req.URL != nil {
		norm := normalizeMonitorURL(*req.URL)
		req.URL = &norm
	}
	page, err := h.store.UpdateMonitoredPage(userID, id, &req)
	if errors.Is(err, store.ErrNotFound) {
		notFoundError(c, "monitored page")
		return
	}
	if err != nil {
		internalError(c, err, "update monitored page")
		return
	}

	if h.monitorEngine != nil && h.monitorEngine.GetCloudSync() != nil && h.monitorEngine.GetCloudSync().IsEnabled() {
		go func() {
			_ = h.monitorEngine.GetCloudSync().PushMonitors(context.Background(), userID)
		}()
	}

	dataResponse(c, page)
}

func (h *Handler) deleteMonitoredPage(c *gin.Context) {
	userID := getUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid id")
		return
	}
	err = h.store.DeleteMonitoredPage(userID, id)
	if errors.Is(err, store.ErrNotFound) {
		notFoundError(c, "monitored page")
		return
	}
	if err != nil {
		internalError(c, err, "delete monitored page")
		return
	}

	if h.monitorEngine != nil && h.monitorEngine.GetCloudSync() != nil && h.monitorEngine.GetCloudSync().IsEnabled() {
		go func() {
			_ = h.monitorEngine.GetCloudSync().PushMonitors(context.Background(), userID)
		}()
	}

	c.Status(http.StatusNoContent)
}

func (h *Handler) markMonitoredPageRead(c *gin.Context) {
	userID := getUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid id")
		return
	}
	var req struct {
		Unread bool `json:"unread"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, err.Error())
		return
	}
	if err := h.store.MarkMonitoredPageRead(userID, id, req.Unread); err != nil {
		internalError(c, err, "mark monitored page read")
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) markPageSnapshotRead(c *gin.Context) {
	userID := getUserID(c)
	pageID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid page id")
		return
	}
	snapshotID, err := strconv.ParseInt(c.Param("snapshotId"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid snapshot id")
		return
	}
	var req struct {
		Unread bool `json:"unread"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, err.Error())
		return
	}
	if err := h.store.MarkPageSnapshotRead(userID, pageID, snapshotID, req.Unread); err != nil {
		internalError(c, err, "mark page snapshot read")
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) checkMonitoredPageNow(c *gin.Context) {
	userID := getUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid id")
		return
	}
	if h.monitorEngine != nil {
		if err := h.monitorEngine.CheckPage(c.Request.Context(), userID, id); err != nil {
			internalError(c, err, "check monitored page now")
			return
		}
	}
	page, err := h.store.GetMonitoredPage(userID, id)
	if err != nil {
		internalError(c, err, "get monitored page after check")
		return
	}
	dataResponse(c, page)
}

func (h *Handler) listPageSnapshots(c *gin.Context) {
	userID := getUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid id")
		return
	}
	limit := 50
	if lStr := c.Query("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 {
			limit = l
		}
	}
	snapshots, err := h.store.ListPageSnapshots(userID, id, limit)
	if err != nil {
		internalError(c, err, "list page snapshots")
		return
	}
	if snapshots == nil {
		snapshots = []*model.PageSnapshot{}
	}
	dataResponse(c, snapshots)
}

func (h *Handler) previewSelector(c *gin.Context) {
	var req model.PreviewSelectorRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, err.Error())
		return
	}
	req.URL = normalizeMonitorURL(req.URL)
	if h.monitorEngine == nil {
		badRequestError(c, "monitor engine not initialized")
		return
	}
	resp, err := h.monitorEngine.Preview(c.Request.Context(), &req)
	if err != nil {
		internalError(c, err, "preview selector")
		return
	}
	dataResponse(c, resp)
}

func (h *Handler) deletePageSnapshot(c *gin.Context) {
	userID := getUserID(c)
	pageID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid page id")
		return
	}
	snapshotID, err := strconv.ParseInt(c.Param("snapshotId"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid snapshot id")
		return
	}
	if err := h.store.DeletePageSnapshot(userID, pageID, snapshotID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			notFoundError(c, "page snapshot")
			return
		}
		internalError(c, err, "delete page snapshot")
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) batchDeletePageSnapshots(c *gin.Context) {
	userID := getUserID(c)
	pageID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid page id")
		return
	}
	var req struct {
		IDs []int64 `json:"ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, err.Error())
		return
	}
	deleted, err := h.store.BatchDeletePageSnapshots(userID, pageID, req.IDs)
	if err != nil {
		internalError(c, err, "batch delete page snapshots")
		return
	}
	dataResponse(c, gin.H{"deleted": deleted})
}

func (h *Handler) syncCloudMonitors(c *gin.Context) {
	userID := getUserID(c)
	if h.monitorEngine == nil || h.monitorEngine.GetCloudSync() == nil {
		badRequestError(c, "cloud monitor engine is not initialized")
		return
	}
	cloudSync := h.monitorEngine.GetCloudSync()
	if !cloudSync.IsEnabled() {
		badRequestError(c, "cloud monitor is not enabled in settings")
		return
	}
	imported, err := cloudSync.FullSync(c.Request.Context(), userID)
	if err != nil {
		internalError(c, err, "cloud sync error")
		return
	}
	dataResponse(c, gin.H{
		"message":            "cloud sync completed",
		"imported_snapshots": imported,
	})
}

func (h *Handler) getCloudMonitorStatus(c *gin.Context) {
	if h.monitorEngine == nil || h.monitorEngine.GetCloudSync() == nil {
		dataResponse(c, gin.H{"enabled": false})
		return
	}
	cloudSync := h.monitorEngine.GetCloudSync()
	dataResponse(c, gin.H{
		"enabled": cloudSync.IsEnabled(),
		"url":     h.config.CloudMonitorURL,
	})
}


