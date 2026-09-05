// Core data models (matching backend/internal/model/model.go)
export interface User {
  id: number;
  username: string;
  fever_api_key?: string;
  created_at: number;
  updated_at: number;
}

export interface Group {
  id: number;
  name: string;
  created_at: number;
  updated_at: number;
}

export interface Feed {
  id: number;
  group_id: number;
  name: string;
  link: string;
  site_url?: string;
  suspended: boolean;
  proxy?: string;
  created_at: number;
  updated_at: number;
  fetch_state: FeedFetchState;
  unread_count: number;
  item_count: number;
}

export interface FeedFetchState {
  etag?: string;
  last_modified?: string;
  cache_control?: string;
  expires_at: number;
  last_checked_at: number;
  next_check_at: number;
  last_http_status: number;
  retry_after_until: number;
  last_success_at: number;
  last_error_at: number;
  last_error?: string;
  consecutive_failures: number;
}

export interface Item {
  id: number;
  feed_id: number;
  guid: string;
  title: string;
  translated_title?: string;
  link: string;
  content: string;
  pub_date: number;
  unread: boolean;
  created_at: number;
}

export interface Bookmark {
  id: number;
  item_id: number | null;
  link: string;
  title: string;
  content: string;
  pub_date: number;
  feed_name: string;
  feed_id: number | null;
  unread: boolean;
  created_at: number;
}

// API response wrappers
export interface APIResponse<T> {
  data?: T;
  error?: string;
}

export interface ListAPIResponse<T> {
  data: T[];
  total: number;
  next_cursor: string | null;
}

// Request types
export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
}

export interface UpdateUsernameRequest {
  username: string;
}

export interface UpdatePasswordRequest {
  current_password: string;
  new_password: string;
}

export interface CreateGroupRequest {
  name: string;
}

export interface UpdateGroupRequest {
  name: string;
}

export interface CreateFeedRequest {
  group_id: number;
  name: string;
  link: string;
  site_url?: string;
  proxy?: string;
}

export interface UpdateFeedRequest {
  group_id?: number;
  name?: string;
  link?: string;
  site_url?: string;
  suspended?: boolean;
  proxy?: string;
}

export interface ValidateFeedRequest {
  url: string;
}

export interface DiscoveredFeed {
  title: string;
  link: string;
  description?: string;
  site_url?: string;
}

export interface ValidateFeedResponse {
  feeds: DiscoveredFeed[];
}

export interface OnlineFeedResult {
  title: string;
  link: string;
  website?: string;
  description?: string;
  subscribers?: number;
  icon_url?: string;
  visual_url?: string;
  topics?: string[];
  source: string;
}

export interface BuildFeedPreviewRequest {
  url: string;
  selector?: string;
}

export interface BuiltItem {
  title: string;
  link: string;
  description: string;
  pub_date: string;
}

export interface SelectorSuggestion {
  selector: string;
  count: number;
  sample: string;
}

export interface BuildFeedPreviewResponse {
  page_title: string;
  page_url: string;
  selector_used: string;
  items_count: number;
  items: BuiltItem[];
  synthetic_url: string;
  suggested_selectors?: SelectorSuggestion[];
}

export interface CreateBookmarkRequest {
  item_id?: number;
  link: string;
  title: string;
  content: string;
  pub_date: number;
  feed_name: string;
}

export interface MarkItemsReadRequest {
  ids: number[];
}

export interface MarkItemsReadByDateRequest {
  feed_id?: number;
  group_id?: number;
  before_date?: number;
}

export interface PurgeReadItemsRequest {
  feed_id?: number;
  group_id?: number;
}

export interface FocusFeed {
  id: number;
  user_id: number;
  group_id: number;
  name: string;
  keywords: string;
  feed_ids: string;
  icon: string;
  unread_count: number;
  item_count: number;
  created_at: number;
  updated_at: number;
}

export interface CreateFocusFeedRequest {
  name: string;
  keywords: string;
  feed_ids?: string;
  group_id?: number;
  icon?: string;
}

export interface UpdateFocusFeedRequest {
  name?: string;
  keywords?: string;
  feed_ids?: string;
  group_id?: number;
  icon?: string;
}

export interface ListItemsParams {
  feed_id?: number;
  group_id?: number;
  unread?: boolean;
  query?: string;
  limit?: number;
  before?: string;
  order_by?: string;
}

export interface ListBookmarksParams {
  feed_id?: number;
  group_id?: number;
  limit?: number;
  before?: string;
}

export interface BatchCreateFeedsRequest {
  feeds: Array<{
    group_id: number;
    name: string;
    link: string;
    site_url?: string;
  }>;
}

export interface SearchFeed {
  id: number;
  name: string;
  link: string;
  site_url: string;
}

export interface SearchItem {
  id: number;
  feed_id: number;
  title: string;
  pub_date: number;
}

export interface SearchResponse {
  feeds: SearchFeed[];
  items: SearchItem[];
}

export interface BatchCreateFeedsResponse {
  created: number;
  failed: number;
  errors?: string[];
}

// OIDC
export interface OIDCStatusResponse {
  enabled: boolean;
}

export interface OIDCLoginResponse {
  auth_url: string;
}

// Webpage Monitor Models & Requests
export interface MonitoredGroup {
  id: number;
  name: string;
  created_at: number;
  updated_at: number;
}

export interface MonitoredPage {
  id: number;
  group_id?: number;
  name: string;
  url: string;
  css_selector?: string;
  strip_selectors?: string;
  check_interval: number;
  last_hash?: string;
  last_checked_at: number;
  next_check_at: number;
  active: boolean;
  last_status: number;
  last_error?: string;
  unread: boolean;
  created_at: number;
  updated_at: number;
}

export interface SectionChange {
  section_title: string;
  change_type: "added" | "modified" | "removed";
  old_text?: string;
  new_text?: string;
  diff_html?: string;
  added_count: number;
  removed_count: number;
}

export interface PageSnapshot {
  id: number;
  page_id: number;
  hash: string;
  content_text: string;
  prev_content_text?: string;
  diff_html?: string;
  sections_json?: string;
  sections?: SectionChange[];
  has_change: boolean;
  added_count: number;
  removed_count: number;
  unread: boolean;
  created_at: number;
}

export interface CreateMonitoredPageRequest {
  group_id?: number | null;
  name: string;
  url: string;
  css_selector?: string;
  strip_selectors?: string;
  check_interval: number;
}

export interface UpdateMonitoredPageRequest {
  group_id?: number | null;
  name?: string;
  url?: string;
  css_selector?: string;
  strip_selectors?: string;
  check_interval?: number;
  active?: boolean;
}

export interface PreviewSelectorRequest {
  url: string;
  css_selector?: string;
  strip_selectors?: string;
}

export interface PreviewSelectorResponse {
  extracted_text: string;
  elements_count: number;
}

export interface TranslateItemResponse {
  id: number;
  original_title: string;
  translated_title: string;
  detected_lang: string;
  cached: boolean;
}

export interface TranslateTextResponse {
  original_text: string;
  translated_text: string;
  detected_lang: string;
  cached: boolean;
}

export interface Label {
  id: number;
  user_id: number;
  name: string;
  color: string;
  created_at: number;
  updated_at: number;
}

export interface CreateLabelRequest {
  name: string;
  color?: string;
}

export interface BatchItemLabelsRequest {
  label_id: number;
  item_ids: number[];
  action: "attach" | "detach";
}

export interface BatchBookmarkRequest {
  item_ids: number[];
}
