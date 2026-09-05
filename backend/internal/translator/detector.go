package translator

import (
	"regexp"
	"strings"
	"unicode"
)

// Language codes
const (
	LangChinese    = "zh"
	LangJapanese   = "ja"
	LangKorean     = "ko"
	LangVietnamese = "vi"
	LangHindi      = "hi"
	LangEnglish    = "en"
	LangOther      = "other"
)

// Regex patterns for script detection
var (
	// Vietnamese distinct accented characters
	vietnamesePattern = regexp.MustCompile(`(?i)[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]`)
)

// DetectLanguage analyzes text and returns the detected language code.
func DetectLanguage(text string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return LangEnglish
	}

	var (
		hanCount        int
		hiraganaCount   int
		katakanaCount   int
		hangulCount     int
		devanagariCount int
		totalRunes      int
	)

	for _, r := range text {
		if unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) || unicode.IsDigit(r) {
			continue
		}
		totalRunes++

		if unicode.Is(unicode.Scripts["Devanagari"], r) {
			devanagariCount++
		} else if unicode.Is(unicode.Scripts["Hangul"], r) {
			hangulCount++
		} else if unicode.Is(unicode.Scripts["Hiragana"], r) {
			hiraganaCount++
		} else if unicode.Is(unicode.Scripts["Katakana"], r) {
			katakanaCount++
		} else if unicode.Is(unicode.Scripts["Han"], r) {
			hanCount++
		}
	}

	if totalRunes == 0 {
		return LangEnglish
	}

	// Check Devanagari (Hindi)
	if float64(devanagariCount)/float64(totalRunes) > 0.15 {
		return LangHindi
	}

	// Check Hangul (Korean)
	if float64(hangulCount)/float64(totalRunes) > 0.15 {
		return LangKorean
	}

	// Check Japanese (Hiragana/Katakana presence confirms Japanese even if Han/Kanji is present)
	if hiraganaCount > 0 || katakanaCount > 0 {
		return LangJapanese
	}

	// Check Chinese (Pure Han without Japanese kana)
	if float64(hanCount)/float64(totalRunes) > 0.20 {
		return LangChinese
	}

	// Check Vietnamese
	if vietnamesePattern.MatchString(text) {
		return LangVietnamese
	}

	return LangEnglish
}

// NeedsTranslation returns true if the text is in Chinese, Japanese, Korean, Vietnamese, or Hindi.
func NeedsTranslation(text string) bool {
	lang := DetectLanguage(text)
	return lang == LangChinese || lang == LangJapanese || lang == LangKorean || lang == LangVietnamese || lang == LangHindi
}
