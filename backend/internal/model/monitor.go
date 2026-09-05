package model

// MonitoredGroup represents a folder/group for organizing monitored pages.
type MonitoredGroup struct {
	ID        int64  `json:"id"`
	UserID    int64  `json:"user_id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}

// MonitoredPage represents a webpage monitored for visual/textual changes.
type MonitoredPage struct {
	ID             int64  `json:"id"`
	UserID         int64  `json:"user_id"`
	GroupID        *int64 `json:"group_id,omitempty"`
	Name           string `json:"name"`
	URL            string `json:"url"`
	CSSSelector    string `json:"css_selector,omitempty"`
	StripSelectors string `json:"strip_selectors,omitempty"`
	CheckInterval  int    `json:"check_interval"` // in seconds, default: 3600 (1 hour)
	LastHash       string `json:"last_hash,omitempty"`
	LastCheckedAt  int64  `json:"last_checked_at"`
	NextCheckAt    int64  `json:"next_check_at"`
	Active         bool   `json:"active"`
	LastStatus     int    `json:"last_status"`
	LastError      string `json:"last_error,omitempty"`
	Unread         bool   `json:"unread"`
	CreatedAt      int64  `json:"created_at"`
	UpdatedAt      int64  `json:"updated_at"`
}

// SectionChange represents a categorized change within a specific page section/heading.
type SectionChange struct {
	SectionTitle string `json:"section_title"`
	ChangeType   string `json:"change_type"` // "added", "modified", "removed"
	OldText      string `json:"old_text,omitempty"`
	NewText      string `json:"new_text,omitempty"`
	DiffHTML     string `json:"diff_html,omitempty"`
	AddedCount   int    `json:"added_count"`
	RemovedCount int    `json:"removed_count"`
}

// PageSnapshot represents a point-in-time captured state or change diff of a monitored page.
type PageSnapshot struct {
	ID              int64           `json:"id"`
	PageID          int64           `json:"page_id"`
	Hash            string          `json:"hash"`
	ContentText     string          `json:"content_text"`
	PrevContentText string          `json:"prev_content_text,omitempty"`
	DiffHTML        string          `json:"diff_html,omitempty"`
	SectionsJSON    string          `json:"sections_json,omitempty"`
	Sections        []SectionChange `json:"sections,omitempty"`
	HasChange       bool            `json:"has_change"`
	AddedCount      int             `json:"added_count"`
	RemovedCount    int             `json:"removed_count"`
	Unread          bool            `json:"unread"`
	CreatedAt       int64           `json:"created_at"`
}

// CreateMonitoredPageRequest is the payload for creating a new monitored page.
type CreateMonitoredPageRequest struct {
	GroupID        *int64 `json:"group_id"`
	Name           string `json:"name" binding:"required"`
	URL            string `json:"url" binding:"required"`
	CSSSelector    string `json:"css_selector"`
	StripSelectors string `json:"strip_selectors"`
	CheckInterval  int    `json:"check_interval"`
}

// UpdateMonitoredPageRequest is the payload for updating an existing monitored page.
type UpdateMonitoredPageRequest struct {
	GroupID        *int64  `json:"group_id"`
	Name           *string `json:"name"`
	URL            *string `json:"url"`
	CSSSelector    *string `json:"css_selector"`
	StripSelectors *string `json:"strip_selectors"`
	CheckInterval  *int    `json:"check_interval"`
	Active         *bool   `json:"active"`
}

// PreviewSelectorRequest is the payload for live testing CSS selectors on a target URL.
type PreviewSelectorRequest struct {
	URL            string `json:"url" binding:"required"`
	CSSSelector    string `json:"css_selector"`
	StripSelectors string `json:"strip_selectors"`
}

// PreviewSelectorResponse contains the extracted content preview.
type PreviewSelectorResponse struct {
	ExtractedText string `json:"extracted_text"`
	ElementsCount int    `json:"elements_count"`
}
