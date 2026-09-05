package handler

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/0x2E/fusion/internal/store"
	"github.com/gin-gonic/gin"
)

type createBookmarkRequest struct {
	ItemID   *int64 `json:"item_id"`
	Link     string `json:"link"`
	Title    string `json:"title"`
	Content  string `json:"content"`
	PubDate  int64  `json:"pub_date"`
	FeedName string `json:"feed_name"`
}

func (h *Handler) listBookmarks(c *gin.Context) {
	userID := getUserID(c)
	params := store.ListBookmarksParams{}

	if feedID := c.Query("feed_id"); feedID != "" {
		id, err := strconv.ParseInt(feedID, 10, 64)
		if err != nil {
			badRequestError(c, "invalid feed_id")
			return
		}
		params.FeedID = &id
	}

	if groupID := c.Query("group_id"); groupID != "" {
		id, err := strconv.ParseInt(groupID, 10, 64)
		if err != nil {
			badRequestError(c, "invalid group_id")
			return
		}
		params.GroupID = &id
	}

	if limitStr := c.Query("limit"); limitStr != "" {
		val, err := strconv.Atoi(limitStr)
		if err != nil || val <= 0 {
			badRequestError(c, "invalid limit")
			return
		}
		if val > maxListLimit {
			val = maxListLimit
		}
		params.Limit = val
	} else {
		params.Limit = 50
	}

	if before := c.Query("before"); before != "" {
		createdAt, id, err := parseCursor(before)
		if err != nil {
			badRequestError(c, "invalid before")
			return
		}
		params.BeforeCreatedAt = &createdAt
		params.BeforeID = &id
	}

	bookmarks, err := h.store.ListBookmarks(userID, params)
	if err != nil {
		internalError(c, err, "list bookmarks")
		return
	}

	total, err := h.store.CountBookmarks(userID, params)
	if err != nil {
		internalError(c, err, "count bookmarks")
		return
	}

	// A non-null next_cursor signals the client may request another full page.
	var nextCursor *string
	if params.Limit > 0 && len(bookmarks) >= params.Limit {
		last := bookmarks[len(bookmarks)-1]
		nc := fmt.Sprintf("%d_%d", last.CreatedAt, last.ID)
		nextCursor = &nc
	}
	paginatedListResponse(c, bookmarks, total, nextCursor)
}

func (h *Handler) getBookmark(c *gin.Context) {
	userID := getUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid id")
		return
	}

	bookmark, err := h.store.GetBookmark(userID, id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			notFoundError(c, "bookmark")
			return
		}
		internalError(c, err, "get bookmark")
		return
	}

	dataResponse(c, bookmark)
}

func (h *Handler) createBookmark(c *gin.Context) {
	userID := getUserID(c)
	var req createBookmarkRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, "invalid request")
		return
	}

	var link, title, content, feedName string
	var feedID *int64
	var pubDate int64

	// If item_id provided, auto-fill bookmark fields from item
	if req.ItemID != nil {
		item, err := h.store.GetItem(userID, *req.ItemID)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				notFoundError(c, "item")
				return
			}
			internalError(c, err, "get item for bookmark")
			return
		}

		feed, err := h.store.GetFeed(userID, item.FeedID)
		if err != nil {
			internalError(c, err, "get feed for bookmark")
			return
		}

		link = item.Link
		title = item.Title
		content = item.Content
		pubDate = item.PubDate
		feedName = feed.Name
		feedID = &item.FeedID
	} else {
		if req.Link == "" || req.Title == "" || req.Content == "" || req.FeedName == "" {
			badRequestError(c, "missing required fields")
			return
		}
		link = req.Link
		title = req.Title
		content = req.Content
		pubDate = req.PubDate
		feedName = req.FeedName
	}

	bookmark, err := h.store.CreateBookmark(userID, req.ItemID, feedID, link, title, content, pubDate, feedName)
	if err != nil {
		internalError(c, err, "create bookmark")
		return
	}

	dataResponse(c, bookmark)
}

func (h *Handler) deleteBookmark(c *gin.Context) {
	userID := getUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid id")
		return
	}

	if err := h.store.DeleteBookmark(userID, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			notFoundError(c, "bookmark")
			return
		}
		internalError(c, err, "delete bookmark")
		return
	}

	c.Status(http.StatusNoContent)
}

type deleteAllBookmarksRequest struct {
	FeedID  *int64 `json:"feed_id"`
	GroupID *int64 `json:"group_id"`
}

func (h *Handler) deleteAllBookmarks(c *gin.Context) {
	userID := getUserID(c)
	var req deleteAllBookmarksRequest
	if err := c.ShouldBindJSON(&req); err != nil && c.Request.ContentLength > 0 {
		badRequestError(c, "invalid request")
		return
	}

	if err := h.store.DeleteAllBookmarks(userID, req.FeedID, req.GroupID); err != nil {
		internalError(c, err, "delete all bookmarks")
		return
	}

	c.Status(http.StatusNoContent)
}

type batchBookmarkRequest struct {
	ItemIDs []int64 `json:"item_ids" binding:"required"`
}

func (h *Handler) batchCreateBookmarks(c *gin.Context) {
	userID := getUserID(c)
	var req batchBookmarkRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, "invalid request")
		return
	}
	if len(req.ItemIDs) == 0 {
		badRequestError(c, "item_ids cannot be empty")
		return
	}

	if err := h.store.BatchCreateBookmarks(userID, req.ItemIDs); err != nil {
		internalError(c, err, "batch create bookmarks")
		return
	}

	c.Status(http.StatusNoContent)
}

func (h *Handler) batchDeleteBookmarks(c *gin.Context) {
	userID := getUserID(c)
	var req batchBookmarkRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, "invalid request")
		return
	}
	if len(req.ItemIDs) == 0 {
		badRequestError(c, "item_ids cannot be empty")
		return
	}

	if err := h.store.BatchDeleteBookmarksByItemIDs(userID, req.ItemIDs); err != nil {
		internalError(c, err, "batch delete bookmarks")
		return
	}

	c.Status(http.StatusNoContent)
}
