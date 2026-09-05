package translator

import (
	"testing"
)

func TestDetectLanguage(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
		needsTr  bool
	}{
		{
			name:     "Chinese Simplified headline",
			input:    "中国央行开展公开市场逆回购操作 保持流动性合理充裕",
			expected: LangChinese,
			needsTr:  true,
		},
		{
			name:     "Chinese Traditional headline",
			input:    "香港金管局跟隨美聯儲降息 基準利率下調25個基點",
			expected: LangChinese,
			needsTr:  true,
		},
		{
			name:     "Japanese headline with Kanji and Hiragana",
			input:    "日銀、追加利上げの判断を慎重に見極めへ 物価上昇の基調注視",
			expected: LangJapanese,
			needsTr:  true,
		},
		{
			name:     "Korean headline",
			input:    "한국은행, 기준금리 동결 결정... 외환시장 변동성 주시",
			expected: LangKorean,
			needsTr:  true,
		},
		{
			name:     "Vietnamese headline",
			input:    "Thủ tướng chỉ đạo đẩy nhanh tiến độ các dự án giao thông trọng điểm",
			expected: LangVietnamese,
			needsTr:  true,
		},
		{
			name:     "Hindi headline",
			input:    "आरबीआई ने नीतिगत दरों में बदलाव नहीं किया, आर्थिक विकास पर जोर",
			expected: LangHindi,
			needsTr:  true,
		},
		{
			name:     "English news title",
			input:    "Asian Markets Rally as Central Banks Signal Measured Easing",
			expected: LangEnglish,
			needsTr:  false,
		},
		{
			name:     "Mixed English with brand/ticker",
			input:    "TSMC Q4 Revenue Surges 36% on AI Chip Demand Boom",
			expected: LangEnglish,
			needsTr:  false,
		},
		{
			name:     "Empty text",
			input:    "   ",
			expected: LangEnglish,
			needsTr:  false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := DetectLanguage(tc.input)
			if got != tc.expected {
				t.Errorf("DetectLanguage(%q) = %v; want %v", tc.input, got, tc.expected)
			}
			needs := NeedsTranslation(tc.input)
			if needs != tc.needsTr {
				t.Errorf("NeedsTranslation(%q) = %v; want %v", tc.input, needs, tc.needsTr)
			}
		})
	}
}
