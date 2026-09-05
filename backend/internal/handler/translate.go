package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/0x2E/fusion/internal/store"
	"github.com/0x2E/fusion/internal/translator"
	"github.com/gin-gonic/gin"
)

type TranslateItemResponse struct {
	ID              int64  `json:"id"`
	OriginalTitle   string `json:"original_title"`
	TranslatedTitle string `json:"translated_title"`
	DetectedLang    string `json:"detected_lang"`
	Cached          bool   `json:"cached"`
}

type TranslateTextRequest struct {
	Text string `json:"text" binding:"required"`
}

type TranslateTextResponse struct {
	OriginalText   string `json:"original_text"`
	TranslatedText string `json:"translated_text"`
	DetectedLang   string `json:"detected_lang"`
	Cached         bool   `json:"cached"`
}

func hashText(text string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(text)))
	return hex.EncodeToString(sum[:])
}

func (h *Handler) translateItemTitle(c *gin.Context) {
	userID := getUserID(c)

	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid item id"})
		return
	}

	item, err := h.store.GetItem(userID, id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "item not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	title := strings.TrimSpace(item.Title)
	if title == "" {
		c.JSON(http.StatusOK, TranslateItemResponse{
			ID:              item.ID,
			OriginalTitle:   "",
			TranslatedTitle: "",
			DetectedLang:    translator.LangEnglish,
			Cached:          true,
		})
		return
	}

	detectedLang := translator.DetectLanguage(title)

	// If item already has a non-empty translated title, return it immediately
	if strings.TrimSpace(item.TranslatedTitle) != "" {
		c.JSON(http.StatusOK, TranslateItemResponse{
			ID:              item.ID,
			OriginalTitle:   item.Title,
			TranslatedTitle: item.TranslatedTitle,
			DetectedLang:    detectedLang,
			Cached:          true,
		})
		return
	}

	contentHash := hashText(title)

	// Check global persistent cache
	cachedTranslation, err := h.store.GetCachedTranslation(contentHash)
	if err == nil && cachedTranslation != "" {
		_ = h.store.UpdateItemTranslatedTitle(userID, item.ID, cachedTranslation)
		c.JSON(http.StatusOK, TranslateItemResponse{
			ID:              item.ID,
			OriginalTitle:   item.Title,
			TranslatedTitle: cachedTranslation,
			DetectedLang:    detectedLang,
			Cached:          true,
		})
		return
	}

	if h.translator == nil {
		h.translator = translator.New()
	}

	translated, err := h.translator.TranslateTitle(c.Request.Context(), title)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "translation service error: " + err.Error()})
		return
	}

	// Persist translation to item and cache
	_ = h.store.UpdateItemTranslatedTitle(userID, item.ID, translated)
	_ = h.store.SetCachedTranslation(contentHash, detectedLang, title, translated)

	c.JSON(http.StatusOK, TranslateItemResponse{
		ID:              item.ID,
		OriginalTitle:   item.Title,
		TranslatedTitle: translated,
		DetectedLang:    detectedLang,
		Cached:          false,
	})
}

func (h *Handler) translateText(c *gin.Context) {
	var req TranslateTextRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "text is required"})
		return
	}

	text := strings.TrimSpace(req.Text)
	if text == "" {
		c.JSON(http.StatusOK, TranslateTextResponse{
			OriginalText:   "",
			TranslatedText: "",
			DetectedLang:   translator.LangEnglish,
			Cached:         true,
		})
		return
	}

	detectedLang := translator.DetectLanguage(text)
	contentHash := hashText(text)

	cachedTranslation, err := h.store.GetCachedTranslation(contentHash)
	if err == nil && cachedTranslation != "" {
		c.JSON(http.StatusOK, TranslateTextResponse{
			OriginalText:   text,
			TranslatedText: cachedTranslation,
			DetectedLang:   detectedLang,
			Cached:         true,
		})
		return
	}

	if h.translator == nil {
		h.translator = translator.New()
	}

	translated, err := h.translator.TranslateTitle(c.Request.Context(), text)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "translation service error: " + err.Error()})
		return
	}

	_ = h.store.SetCachedTranslation(contentHash, detectedLang, text, translated)

	c.JSON(http.StatusOK, TranslateTextResponse{
		OriginalText:   text,
		TranslatedText: translated,
		DetectedLang:   detectedLang,
		Cached:         false,
	})
}
