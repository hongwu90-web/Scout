package translator

import (
	"context"
	"fmt"
	"strings"
)

// Translator defines the contract for translation services.
type Translator interface {
	TranslateTitle(ctx context.Context, title string) (string, error)
}

// GoogleTranslator coordinates fast, zero-configuration translation via Google Translate.
type GoogleTranslator struct {
	google *GoogleClient
}

// New constructs a GoogleTranslator instance.
func New() *GoogleTranslator {
	return &GoogleTranslator{
		google: NewGoogleClient(),
	}
}

// TranslateTitle translates an article title into English using Google Translate.
func (gt *GoogleTranslator) TranslateTitle(ctx context.Context, title string) (string, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return "", nil
	}

	if gt.google == nil {
		gt.google = NewGoogleClient()
	}

	translated, _, err := gt.google.Translate(ctx, title, "auto", "en")
	if err != nil {
		return "", fmt.Errorf("google translate error: %w", err)
	}

	return translated, nil
}

// Google returns the underlying GoogleClient.
func (gt *GoogleTranslator) Google() *GoogleClient {
	return gt.google
}
