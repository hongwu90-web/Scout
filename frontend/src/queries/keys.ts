export interface ItemFilters {
  feedId?: number | null;
  groupId?: number | null;
  focusFeedId?: number | null;
  unread?: boolean;
  query?: string;
}

export interface NormalizedItemFilters {
  feedId: number | null;
  groupId: number | null;
  focusFeedId: number | null;
  unread: boolean;
  query: string;
}

export function normalizeItemFilters(
  filters: ItemFilters,
): NormalizedItemFilters {
  return {
    feedId: filters.feedId ?? null,
    groupId: filters.groupId ?? null,
    focusFeedId: filters.focusFeedId ?? null,
    unread: filters.unread ?? false,
    query: filters.query ? filters.query.trim() : "",
  };
}

export interface BookmarkFilters {
  feedId?: number | null;
  groupId?: number | null;
}

export interface NormalizedBookmarkFilters {
  feedId: number | null;
  groupId: number | null;
}

export function normalizeBookmarkFilters(
  filters: BookmarkFilters,
): NormalizedBookmarkFilters {
  return {
    feedId: filters.feedId ?? null,
    groupId: filters.groupId ?? null,
  };
}

export const queryKeys = {
  groups: {
    all: ["groups"] as const,
    list: () => [...queryKeys.groups.all, "list"] as const,
  },
  feeds: {
    all: ["feeds"] as const,
    list: () => [...queryKeys.feeds.all, "list"] as const,
  },
  focusFeeds: {
    all: ["focus-feeds"] as const,
    list: () => [...queryKeys.focusFeeds.all, "list"] as const,
    detail: (id: number) => [...queryKeys.focusFeeds.all, "detail", id] as const,
  },
  items: {
    all: ["items"] as const,
    lists: () => [...queryKeys.items.all, "list"] as const,
    list: (filters: ItemFilters) =>
      [...queryKeys.items.all, "list", normalizeItemFilters(filters)] as const,
    details: () => [...queryKeys.items.all, "detail"] as const,
    detail: (id: number) => [...queryKeys.items.all, "detail", id] as const,
  },
  bookmarks: {
    all: ["bookmarks"] as const,
    lists: () => [...queryKeys.bookmarks.all, "list"] as const,
  },
};
