package handler

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/0x2E/fusion/internal/store"
	"github.com/gin-gonic/gin"
)

type createFocusFeedRequest struct {
	Name     string `json:"name" binding:"required"`
	Keywords string `json:"keywords" binding:"required"`
	FeedIDs  string `json:"feed_ids"`
	GroupID  int64  `json:"group_id"`
	Icon     string `json:"icon"`
}

type updateFocusFeedRequest struct {
	Name     *string `json:"name"`
	Keywords *string `json:"keywords"`
	FeedIDs  *string `json:"feed_ids"`
	GroupID  *int64  `json:"group_id"`
	Icon     *string `json:"icon"`
}

func (h *Handler) listFocusFeeds(c *gin.Context) {
	userID := getUserID(c)
	list, err := h.store.ListFocusFeeds(userID)
	if err != nil {
		internalError(c, err, "list focus feeds")
		return
	}
	listResponse(c, list, len(list))
}

func (h *Handler) createFocusFeed(c *gin.Context) {
	userID := getUserID(c)
	var req createFocusFeedRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, err.Error())
		return
	}

	groupID := req.GroupID
	if groupID <= 0 {
		groupID = 1
	}

	ff, err := h.store.CreateFocusFeed(userID, groupID, req.Name, req.Keywords, req.FeedIDs, req.Icon)
	if err != nil {
		internalError(c, err, "create focus feed")
		return
	}
	dataResponse(c, ff)
}

func (h *Handler) getFocusFeed(c *gin.Context) {
	userID := getUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid focus feed id")
		return
	}

	ff, err := h.store.GetFocusFeed(userID, id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			notFoundError(c, "focus feed not found")
			return
		}
		internalError(c, err, "get focus feed")
		return
	}
	dataResponse(c, ff)
}

func (h *Handler) updateFocusFeed(c *gin.Context) {
	userID := getUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid focus feed id")
		return
	}

	var req updateFocusFeedRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, err.Error())
		return
	}

	ff, err := h.store.UpdateFocusFeed(userID, id, req.Name, req.Keywords, req.FeedIDs, req.Icon, req.GroupID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			notFoundError(c, "focus feed not found")
			return
		}
		internalError(c, err, "update focus feed")
		return
	}
	dataResponse(c, ff)
}

func (h *Handler) deleteFocusFeed(c *gin.Context) {
	userID := getUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid focus feed id")
		return
	}

	if err := h.store.DeleteFocusFeed(userID, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			notFoundError(c, "focus feed not found")
			return
		}
		internalError(c, err, "delete focus feed")
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) listFocusFeedItems(c *gin.Context) {
	userID := getUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid focus feed id")
		return
	}

	ff, err := h.store.GetFocusFeed(userID, id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			notFoundError(c, "focus feed not found")
			return
		}
		internalError(c, err, "get focus feed")
		return
	}

	params := store.ListItemsParams{}
	if unread := c.Query("unread"); unread != "" {
		val, err := strconv.ParseBool(unread)
		if err != nil {
			badRequestError(c, "invalid unread")
			return
		}
		params.Unread = &val
	}

	if q := c.Query("query"); q != "" {
		params.Query = q
	} else if q := c.Query("q"); q != "" {
		params.Query = q
	}

	if limit := c.Query("limit"); limit != "" {
		val, err := strconv.Atoi(limit)
		if err != nil || val <= 0 {
			badRequestError(c, "invalid limit")
			return
		}
		if val > maxListLimit {
			val = maxListLimit
		}
		params.Limit = val
	} else {
		params.Limit = 10
	}

	if before := c.Query("before"); before != "" {
		pubDate, id, err := parseCursor(before)
		if err != nil {
			badRequestError(c, "invalid before")
			return
		}
		params.BeforePubDate = &pubDate
		params.BeforeID = &id
	}

	if orderBy := c.Query("order_by"); orderBy != "" {
		params.OrderBy = orderBy
	} else {
		params.OrderBy = "pub_date"
	}

	items, err := h.store.ListFocusFeedItems(userID, ff, params)
	if err != nil {
		internalError(c, err, "list focus feed items")
		return
	}

	total, err := h.store.CountFocusFeedItems(userID, ff, params.Unread)
	if err != nil {
		internalError(c, err, "count focus feed items")
		return
	}

	var nextCursor *string
	if params.Limit > 0 && len(items) >= params.Limit {
		last := items[len(items)-1]
		nc := fmt.Sprintf("%d_%d", last.PubDate, last.ID)
		nextCursor = &nc
	}

	paginatedListResponse(c, items, int(total), nextCursor)
}
