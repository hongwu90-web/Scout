import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, LayoutGrid, List, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArticleItem } from "./article-item";
import { ArticleCompactItem } from "./article-compact-item";
import { BulkActionsBar } from "./bulk-actions-bar";
import { useUrlState, type ArticleFilter } from "@/hooks/use-url-state";
import { useArticleList } from "@/hooks/use-article-list";
import { useMarkItemsRead, useMarkItemsUnread } from "@/queries/items";
import { useFeedLookup } from "@/queries/feeds";
import { useCreateBookmark, useDeleteBookmark } from "@/queries/bookmarks";
import { useSelectionStore } from "@/store/selection";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/store";
import type { Item } from "@/lib/api";

export function ArticleList() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const {
    articleFilter,
    setArticleFilter,
    selectedFeedId,
    selectedGroupId,
    selectedFocusFeedId,
    selectedArticleId,
    keywordQuery,
    setSelectedArticle,
  } = useUrlState();

  const {
    articles,
    hasMore,
    isLoading,
    isLoadingMore,
    fetchNextPage,
    isStarredMode,
    isItemStarred,
    getBookmarkByItemId,
  } = useArticleList({
    feedId: selectedFeedId,
    groupId: selectedGroupId,
    focusFeedId: selectedFocusFeedId,
    articleFilter,
    query: keywordQuery,
  });

  const { feeds, getFeedById, isLoading: isFeedsLoading } = useFeedLookup();
  const markItemsRead = useMarkItemsRead();
  const markItemsUnread = useMarkItemsUnread();
  const createBookmark = useCreateBookmark();
  const deleteBookmark = useDeleteBookmark();

  const hasNoFeeds = !isFeedsLoading && feeds.length === 0;

  const handleToggleRead = useCallback(
    async (article: Item) => {
      if (article.id <= 0) return;
      try {
        if (article.unread) {
          await markItemsRead.mutateAsync([article.id]);
        } else {
          await markItemsUnread.mutateAsync([article.id]);
        }
      } catch (error) {
        console.error("Failed to toggle read status:", error);
      }
    },
    [markItemsRead, markItemsUnread],
  );

  const handleToggleStar = useCallback(
    async (article: Item) => {
      try {
        if (isItemStarred(article.id)) {
          const bookmark = getBookmarkByItemId(article.id);
          if (bookmark) {
            await deleteBookmark.mutateAsync(bookmark.id);
          }
          return;
        }
        await createBookmark.mutateAsync(article);
      } catch (error) {
        console.error("Failed to toggle star:", error);
      }
    },
    [createBookmark, deleteBookmark, getBookmarkByItemId, isItemStarred],
  );

  const { articleViewMode, setArticleViewMode } = usePreferencesStore();
  const {
    isSelectionMode,
    selectedIds,
    toggleSelectionMode,
    toggleItem,
    selectRange,
  } = useSelectionStore();

  const validArticles = articles.filter((a): a is Item => Boolean(a && a.id));
  const orderedIds = validArticles.map((a) => a.id);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Article area with filter tabs & view mode switcher */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 py-3 sm:px-6">
        {/* Filter toolbar */}
        <div className="flex items-center justify-between gap-2 shrink-0">
          {!hasNoFeeds && !isStarredMode ? (
            <Tabs
              value={articleFilter === "all" ? "all" : "unread"}
              onValueChange={(v) => setArticleFilter(v as ArticleFilter)}
            >
              <TabsList>
                <TabsTrigger value="unread">{t("article.filter.unread")}</TabsTrigger>
                <TabsTrigger value="all">{t("article.filter.all")}</TabsTrigger>
              </TabsList>
            </Tabs>
          ) : (
            <div />
          )}

          {/* View mode toggle (Cards vs Compact Headlines) & Selection Mode */}
          <div className="flex items-center border border-border rounded-xs bg-muted/40 p-0.5 font-mono text-[10px]">
            <button
              type="button"
              onClick={() => setArticleViewMode("cards")}
              className={cn(
                "flex items-center gap-1 px-2 py-1 transition-all rounded-xs font-bold uppercase",
                articleViewMode === "cards"
                  ? "bg-card text-foreground shadow-xs border border-border/80"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title="Cards Grid View"
            >
              <LayoutGrid className="w-3 h-3" />
              <span className="hidden sm:inline">CARDS</span>
            </button>
            <button
              type="button"
              onClick={() => setArticleViewMode("compact")}
              className={cn(
                "flex items-center gap-1 px-2 py-1 transition-all rounded-xs font-bold uppercase",
                articleViewMode === "compact"
                  ? "bg-card text-foreground shadow-xs border border-border/80"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title="Compact 1-Line Headline View"
            >
              <List className="w-3 h-3" />
              <span className="hidden sm:inline">COMPACT</span>
            </button>
            <div className="h-3 w-[1px] bg-border mx-0.5" />
            <button
              type="button"
              onClick={toggleSelectionMode}
              className={cn(
                "flex items-center gap-1 px-2 py-1 transition-all rounded-xs font-bold uppercase",
                isSelectionMode
                  ? "bg-primary text-primary-foreground shadow-xs border border-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title="Toggle Multi-Select Mode"
            >
              <CheckSquare className="w-3 h-3" />
              <span className="hidden sm:inline">SELECT</span>
            </button>
          </div>
        </div>

        {/* Floating Bulk Actions Bar */}
        <BulkActionsBar
          articles={validArticles}
          getFeedName={(id) => getFeedById(id)?.name ?? "Unknown"}
          isItemStarred={isItemStarred}
        />

        {/* Article list / Card grid */}
        <ScrollArea className="min-h-0 flex-1">
          <div>
            {isLoading && articles.length === 0 ? (
              <div
                className={cn(
                  articleViewMode === "compact"
                    ? "flex flex-col gap-1 p-2"
                    : selectedArticleId !== null
                    ? "flex flex-col gap-2.5 p-2"
                    : "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5 p-2",
                )}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <div
                    key={i}
                    className={cn(
                      "animate-pulse rounded-xs border border-border/50 bg-neutral-100 dark:bg-neutral-900",
                      articleViewMode === "compact" ? "h-10" : "h-36",
                    )}
                  />
                ))}
              </div>
            ) : articles.length === 0 ? (
              hasNoFeeds ? (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                  <p className="text-sm text-neutral-500">
                    {t("article.list.noFeeds")}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate({ to: "/feeds" })}
                  >
                    {t("article.list.openFeedManagement")}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <p className="text-sm text-neutral-500">
                    {t("article.list.noArticles")}
                  </p>
                </div>
              )
            ) : (
              <>
                {articleViewMode === "compact" ? (
                  <div className="flex flex-col border border-border/70 rounded-xs bg-card overflow-hidden divide-y divide-border/40">
                    {articles
                      .filter((article): article is Item => Boolean(article && article.id))
                      .map((article) => {
                        const feed = getFeedById(article.feed_id);
                        const bookmark = getBookmarkByItemId(article.id);

                        return (
                          <ArticleCompactItem
                            key={article.id}
                            article={article}
                            selectedArticleId={selectedArticleId}
                            onSelectArticle={setSelectedArticle}
                            onToggleRead={handleToggleRead}
                            onToggleStar={handleToggleStar}
                            canToggleRead={article.id > 0}
                            isStarred={isItemStarred(article.id)}
                            isStarredMode={isStarredMode}
                            feedName={feed?.name ?? bookmark?.feed_name ?? t("common.unknown")}
                            isMultiSelected={selectedIds.includes(article.id)}
                            isSelectionMode={isSelectionMode}
                            onToggleSelect={(e) => {
                              if (e.shiftKey) {
                                selectRange(article.id, orderedIds);
                              } else {
                                toggleItem(article.id);
                              }
                            }}
                          />
                        );
                      })}
                  </div>
                ) : (
                  <div
                    className={cn(
                      selectedArticleId !== null
                        ? "flex flex-col gap-2.5 p-2"
                        : "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5 p-2",
                    )}
                  >
                    {articles
                      .filter((article): article is Item => Boolean(article && article.id))
                      .map((article) => {
                        const feed = getFeedById(article.feed_id);
                        const bookmark = getBookmarkByItemId(article.id);

                        return (
                          <ArticleItem
                            key={article.id}
                            article={article}
                            selectedArticleId={selectedArticleId}
                            onSelectArticle={setSelectedArticle}
                            onToggleRead={handleToggleRead}
                            onToggleStar={handleToggleStar}
                            canToggleRead={article.id > 0}
                            isStarred={isItemStarred(article.id)}
                            isStarredMode={isStarredMode}
                            feedName={feed?.name ?? bookmark?.feed_name ?? t("common.unknown")}
                            isMultiSelected={selectedIds.includes(article.id)}
                            isSelectionMode={isSelectionMode}
                            onToggleSelect={(e) => {
                              if (e.shiftKey) {
                                selectRange(article.id, orderedIds);
                              } else {
                                toggleItem(article.id);
                              }
                            }}
                          />
                        );
                      })}
                  </div>
                )}
                {hasMore && (
                  <div className="flex justify-center py-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fetchNextPage()}
                      disabled={isLoadingMore}
                      className="gap-2"
                    >
                      {isLoadingMore && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      {isLoadingMore
                        ? t("article.list.loading")
                        : t("article.list.loadMore")}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
