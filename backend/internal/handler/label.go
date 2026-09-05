package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/0x2E/fusion/internal/store"
	"github.com/gin-gonic/gin"
)

type createLabelRequest struct {
	Name  string `json:"name" binding:"required"`
	Color string `json:"color"`
}

type batchItemLabelsRequest struct {
	LabelID int64   `json:"label_id" binding:"required"`
	ItemIDs []int64 `json:"item_ids" binding:"required"`
	Action  string  `json:"action" binding:"required"` // "attach" or "detach"
}

type getItemLabelsRequest struct {
	ItemIDs []int64 `json:"item_ids" binding:"required"`
}

func (h *Handler) listLabels(c *gin.Context) {
	userID := getUserID(c)
	labels, err := h.store.ListLabels(userID)
	if err != nil {
		internalError(c, err, "list labels")
		return
	}
	dataResponse(c, labels)
}

func (h *Handler) createLabel(c *gin.Context) {
	userID := getUserID(c)
	var req createLabelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, "invalid request")
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		badRequestError(c, "label name cannot be empty")
		return
	}

	label, err := h.store.CreateLabel(userID, name, req.Color)
	if err != nil {
		internalError(c, err, "create label")
		return
	}

	dataResponse(c, label)
}

func (h *Handler) deleteLabel(c *gin.Context) {
	userID := getUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		badRequestError(c, "invalid id")
		return
	}

	if err := h.store.DeleteLabel(userID, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			notFoundError(c, "label")
			return
		}
		internalError(c, err, "delete label")
		return
	}

	c.Status(http.StatusNoContent)
}

func (h *Handler) batchUpdateItemLabels(c *gin.Context) {
	userID := getUserID(c)
	var req batchItemLabelsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, "invalid request")
		return
	}

	if len(req.ItemIDs) == 0 {
		badRequestError(c, "item_ids cannot be empty")
		return
	}

	if req.Action == "attach" {
		if err := h.store.BatchAttachLabel(userID, req.LabelID, req.ItemIDs); err != nil {
			internalError(c, err, "batch attach label")
			return
		}
	} else if req.Action == "detach" {
		if err := h.store.BatchDetachLabel(userID, req.LabelID, req.ItemIDs); err != nil {
			internalError(c, err, "batch detach label")
			return
		}
	} else {
		badRequestError(c, "invalid action, must be attach or detach")
		return
	}

	c.Status(http.StatusNoContent)
}

func (h *Handler) getItemLabels(c *gin.Context) {
	var req getItemLabelsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequestError(c, "invalid request")
		return
	}

	labelsMap, err := h.store.GetItemLabels(req.ItemIDs)
	if err != nil {
		internalError(c, err, "get item labels")
		return
	}

	dataResponse(c, labelsMap)
}
