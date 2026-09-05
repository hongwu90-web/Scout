import { api } from "./client";
import type {
  APIResponse,
  ListAPIResponse,
  LoginRequest,
  RegisterRequest,
  UpdateUsernameRequest,
  UpdatePasswordRequest,
  User,
  Group,
  Feed,
  Item,
  Bookmark,
  CreateGroupRequest,
  UpdateGroupRequest,
  CreateFeedRequest,
  UpdateFeedRequest,
  ValidateFeedRequest,
  ValidateFeedResponse,
  OnlineFeedResult,
  BuildFeedPreviewRequest,
  BuildFeedPreviewResponse,
  CreateBookmarkRequest,
  MarkItemsReadRequest,
  ListItemsParams,
  ListBookmarksParams,
  FocusFeed,
  CreateFocusFeedRequest,
  UpdateFocusFeedRequest,
  BatchCreateFeedsRequest,
  BatchCreateFeedsResponse,
  SearchResponse,
  OIDCStatusResponse,
  OIDCLoginResponse,
  MonitoredGroup,
  MonitoredPage,
  PageSnapshot,
  CreateMonitoredPageRequest,
  UpdateMonitoredPageRequest,
  PreviewSelectorRequest,
  PreviewSelectorResponse,
  Label,
  CreateLabelRequest,
  BatchItemLabelsRequest,
  BatchBookmarkRequest,
} from "./types";

// Session APIs
export const sessionAPI = {
  login: (data: LoginRequest) =>
    api.post<APIResponse<{ message: string }>>("/sessions", data),

  register: (data: RegisterRequest) =>
    api.post<APIResponse<{ message: string; user_id: number }>>("/register", data),

  getMe: () => api.get<APIResponse<User>>("/me"),

  updateUsername: (data: UpdateUsernameRequest) =>
    api.patch<APIResponse<{ message: string }>>("/me/username", data),

  updatePassword: (data: UpdatePasswordRequest) =>
    api.patch<APIResponse<{ message: string }>>("/me/password", data),

  logout: () => api.delete<void>("/sessions"),
};

// OIDC APIs
export const oidcAPI = {
  status: () => api.get<APIResponse<OIDCStatusResponse>>("/oidc/enabled"),

  login: () => api.get<APIResponse<OIDCLoginResponse>>("/oidc/login"),
};

// Group APIs
export const groupAPI = {
  list: () => api.get<ListAPIResponse<Group>>("/groups"),

  get: (id: number) => api.get<APIResponse<Group>>(`/groups/${id}`),

  create: (data: CreateGroupRequest) =>
    api.post<APIResponse<Group>>("/groups", data),

  update: (id: number, data: UpdateGroupRequest) =>
    api.patch<APIResponse<Group>>(`/groups/${id}`, data),

  delete: (id: number) => api.delete<void>(`/groups/${id}`),
};

// Feed APIs
export const feedAPI = {
  list: () => api.get<ListAPIResponse<Feed>>("/feeds"),

  get: (id: number) => api.get<APIResponse<Feed>>(`/feeds/${id}`),

  create: (data: CreateFeedRequest) =>
    api.post<APIResponse<Feed>>("/feeds", data),

  update: (id: number, data: UpdateFeedRequest) =>
    api.patch<APIResponse<Feed>>(`/feeds/${id}`, data),

  delete: (id: number) => api.delete<void>(`/feeds/${id}`),

  validate: (data: ValidateFeedRequest) =>
    api.post<APIResponse<ValidateFeedResponse>>("/feeds/validate", data),

  searchOnline: (q: string) =>
    api.get<ListAPIResponse<OnlineFeedResult>>(`/feeds/search-online?q=${encodeURIComponent(q)}`),

  previewBuild: (data: BuildFeedPreviewRequest) =>
    api.post<APIResponse<BuildFeedPreviewResponse>>("/feeds/build/preview", data),

  refresh: () => api.post<void>("/feeds/refresh"),

  batchCreate: (data: BatchCreateFeedsRequest) =>
    api.post<APIResponse<BatchCreateFeedsResponse>>("/feeds/batch", data),
};

// Item APIs
export const itemAPI = {
  list: (params?: ListItemsParams) => {
    const query = new URLSearchParams();
    if (params?.feed_id) query.set("feed_id", params.feed_id.toString());
    if (params?.group_id) query.set("group_id", params.group_id.toString());
    if (params?.unread !== undefined)
      query.set("unread", params.unread.toString());
    if (params?.query) query.set("query", params.query);
    if (params?.limit) query.set("limit", params.limit.toString());
    if (params?.before) query.set("before", params.before);
    if (params?.order_by) query.set("order_by", params.order_by);

    const queryString = query.toString();
    return api.get<ListAPIResponse<Item>>(
      `/items${queryString ? `?${queryString}` : ""}`,
    );
  },

  get: (id: number) => api.get<APIResponse<Item>>(`/items/${id}`),

  markRead: (data: MarkItemsReadRequest) =>
    api.patch<void>("/items/-/read", data),

  markUnread: (data: MarkItemsReadRequest) =>
    api.patch<void>("/items/-/unread", data),

  markReadByDate: (data: import("./types").MarkItemsReadByDateRequest) =>
    api.post<void>("/items/mark-read-by-date", data),

  purgeRead: (data: import("./types").PurgeReadItemsRequest) =>
    api.delete<void>("/items/read", { data }),

  translate: (id: number) =>
    api.post<import("./types").TranslateItemResponse>(`/items/${id}/translate`),
};

// Focus Feed APIs (Keyword Focus Feeds)
export const focusFeedAPI = {
  list: () => api.get<ListAPIResponse<FocusFeed>>("/focus-feeds"),

  get: (id: number) => api.get<APIResponse<FocusFeed>>(`/focus-feeds/${id}`),

  create: (data: CreateFocusFeedRequest) =>
    api.post<APIResponse<FocusFeed>>("/focus-feeds", data),

  update: (id: number, data: UpdateFocusFeedRequest) =>
    api.patch<APIResponse<FocusFeed>>(`/focus-feeds/${id}`, data),

  delete: (id: number) => api.delete<void>(`/focus-feeds/${id}`),

  listItems: (id: number, params?: ListItemsParams) => {
    const query = new URLSearchParams();
    if (params?.unread !== undefined)
      query.set("unread", params.unread.toString());
    if (params?.query) query.set("query", params.query);
    if (params?.limit) query.set("limit", params.limit.toString());
    if (params?.before) query.set("before", params.before);
    if (params?.order_by) query.set("order_by", params.order_by);

    const queryString = query.toString();
    return api.get<ListAPIResponse<Item>>(
      `/focus-feeds/${id}/items${queryString ? `?${queryString}` : ""}`,
    );
  },
};

// Translation APIs
export const translateAPI = {
  translateText: (text: string) =>
    api.post<import("./types").TranslateTextResponse>("/translate", { text }),
};

// Bookmark APIs
export const bookmarkAPI = {
  list: (params: ListBookmarksParams = {}) => {
    const query = new URLSearchParams();
    if (params.feed_id) query.set("feed_id", params.feed_id.toString());
    if (params.group_id) query.set("group_id", params.group_id.toString());
    query.set("limit", (params.limit ?? 50).toString());
    if (params.before) query.set("before", params.before);
    return api.get<ListAPIResponse<Bookmark>>(`/bookmarks?${query}`);
  },

  get: (id: number) => api.get<APIResponse<Bookmark>>(`/bookmarks/${id}`),

  create: (data: CreateBookmarkRequest) =>
    api.post<APIResponse<Bookmark>>("/bookmarks", data),

  delete: (id: number) => api.delete<void>(`/bookmarks/${id}`),

  deleteAll: (data?: { feed_id?: number; group_id?: number }) =>
    api.delete<void>("/bookmarks", { data }),

  batchCreate: (data: BatchBookmarkRequest) =>
    api.post<void>("/bookmarks/batch", data),

  batchDelete: (data: BatchBookmarkRequest) =>
    api.post<void>("/bookmarks/batch-delete", data),
};

// Label APIs
export const labelAPI = {
  list: () => api.get<APIResponse<Label[]>>("/labels"),

  create: (data: CreateLabelRequest) =>
    api.post<APIResponse<Label>>("/labels", data),

  delete: (id: number) => api.delete<void>(`/labels/${id}`),

  batchUpdate: (data: BatchItemLabelsRequest) =>
    api.post<void>("/items/labels/batch", data),

  getItemLabels: (data: { item_ids: number[] }) =>
    api.post<APIResponse<Record<number, number[]>>>("/items/labels", data),
};

// Search APIs
export const searchAPI = {
  search: (q: string, limit = 10) =>
    api.get<APIResponse<SearchResponse>>(
      `/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
};

// Monitored Group APIs
export const monitoredGroupAPI = {
  list: () => api.get<APIResponse<MonitoredGroup[]>>("/monitored-groups"),
  create: (data: { name: string }) =>
    api.post<APIResponse<MonitoredGroup>>("/monitored-groups", data),
  update: (id: number, data: { name: string }) =>
    api.patch<APIResponse<MonitoredGroup>>(`/monitored-groups/${id}`, data),
  delete: (id: number) => api.delete<void>(`/monitored-groups/${id}`),
};

// Monitored Page APIs
export const monitoredPageAPI = {
  list: (groupId?: number) =>
    api.get<APIResponse<MonitoredPage[]>>(
      `/monitored-pages${groupId ? `?group_id=${groupId}` : ""}`,
    ),
  get: (id: number) =>
    api.get<APIResponse<MonitoredPage>>(`/monitored-pages/${id}`),
  create: (data: CreateMonitoredPageRequest) =>
    api.post<APIResponse<MonitoredPage>>("/monitored-pages", data),
  update: (id: number, data: UpdateMonitoredPageRequest) =>
    api.patch<APIResponse<MonitoredPage>>(`/monitored-pages/${id}`, data),
  delete: (id: number) => api.delete<void>(`/monitored-pages/${id}`),
  markRead: (id: number, unread: boolean) =>
    api.patch<void>(`/monitored-pages/${id}/read`, { unread }),
  markSnapshotRead: (pageId: number, snapshotId: number, unread: boolean) =>
    api.patch<void>(`/monitored-pages/${pageId}/snapshots/${snapshotId}/read`, {
      unread,
    }),
  checkNow: (id: number) =>
    api.post<APIResponse<MonitoredPage>>(`/monitored-pages/${id}/check`),
  snapshots: (id: number, limit = 50) =>
    api.get<APIResponse<PageSnapshot[]>>(
      `/monitored-pages/${id}/snapshots?limit=${limit}`,
    ),
  deleteSnapshot: (pageId: number, snapshotId: number) =>
    api.delete<void>(`/monitored-pages/${pageId}/snapshots/${snapshotId}`),
  deleteSnapshots: (pageId: number, snapshotIds: number[]) =>
    api.post<APIResponse<{ deleted: number }>>(`/monitored-pages/${pageId}/snapshots/delete`, {
      ids: snapshotIds,
    }),
  preview: (data: PreviewSelectorRequest) =>
    api.post<APIResponse<PreviewSelectorResponse>>(
      "/monitored-pages/preview",
      data,
    ),
  syncCloud: () =>
    api.post<APIResponse<{ message: string; imported_snapshots: number }>>(
      "/monitored-pages/sync",
    ),
  getCloudStatus: () =>
    api.get<APIResponse<{ enabled: boolean; url: string }>>(
      "/monitored-pages/cloud-status",
    ),
};

export * from "./types";
export { APIError, setUnauthorizedCallback } from "./client";
