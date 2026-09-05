import { ArticleList } from "@/components/article/article-list";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { CheckCheck, Trash2, Calendar, RefreshCw, FileDown, ChevronDown, Search, X, Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SidebarTrigger } from "@/components/layout/sidebar-trigger";
import { useGroups } from "@/queries/groups";
import { useFocusFeed } from "@/queries/focus_feeds";
import { useMarkItemsReadByDate, usePurgeReadItems } from "@/queries/items";

import { AppLayout } from "@/components/layout/app-layout";
import { ArticleContent } from "@/components/article/article-content";
import { useUrlState } from "@/hooks/use-url-state";
import { useArticleList } from "@/hooks/use-article-list";
import { useFeedLookup, useRefreshFeeds } from "@/queries/feeds";
import { toSafeExternalUrl, openExternalUrl } from "@/lib/safe-url";
import {
  useItem,
  useMarkItemsRead,
  useMarkItemsUnread,
} from "@/queries/items";
import {
  useCreateBookmark,
  useDeleteBookmark,
  useDeleteAllBookmarks,
} from "@/queries/bookmarks";
import { useArticleNavigation } from "@/hooks/use-keyboard";
import { itemAPI, bookmarkAPI, focusFeedAPI, type Item } from "@/lib/api";
import { useSelectionStore } from "@/store/selection";
import { extractSummary, cn } from "@/lib/utils";

export function ArticlePage() {
  const {
    selectedArticleId,
    selectedFeedId,
    selectedGroupId,
    selectedFocusFeedId,
    articleFilter,
    keywordQuery,
    setSelectedArticle,
    setKeywordQuery,
  } = useUrlState();
  const { getFeedById } = useFeedLookup();
  const { data: selectedFocusFeed } = useFocusFeed(selectedFocusFeedId);

  const [localSearch, setLocalSearch] = useState(keywordQuery);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const clearSelection = useSelectionStore((s) => s.clearSelection);

  // Clear multi-selection when navigating feeds or filters
  useEffect(() => {
    clearSelection();
  }, [selectedFeedId, selectedGroupId, selectedFocusFeedId, articleFilter, clearSelection]);

  // Sync local search when URL query changes
  useEffect(() => {
    setLocalSearch(keywordQuery);
  }, [keywordQuery]);

  // Global hotkey / to focus search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f")) &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setKeywordQuery(localSearch);
  };

  const handleClearSearch = () => {
    setLocalSearch("");
    setKeywordQuery("");
  };

  const { articles, isStarredMode, isItemStarred, getBookmarkByItemId } =
    useArticleList({
      feedId: selectedFeedId,
      groupId: selectedGroupId,
      focusFeedId: selectedFocusFeedId,
      articleFilter,
      query: keywordQuery,
    });

  const markRead = useMarkItemsRead();
  const markUnread = useMarkItemsUnread();
  const createBookmark = useCreateBookmark();
  const deleteBookmark = useDeleteBookmark();
  const deleteAllBookmarks = useDeleteAllBookmarks();

  const articleIds = articles.filter((a) => a && a.id).map((a) => a.id);

  const storeArticle = selectedArticleId
    ? (articles.find((i) => i && i.id === selectedArticleId) ?? null)
    : null;

  const shouldFetchArticle =
    selectedArticleId !== null &&
    selectedArticleId > 0 &&
    (isStarredMode || storeArticle === null);
  const { data: fetchedArticle } = useItem(
    selectedArticleId,
    shouldFetchArticle,
  );

  const article: Item | null =
    (isStarredMode ? fetchedArticle ?? storeArticle : storeArticle ?? fetchedArticle) ??
    null;
  const canToggleRead = !isStarredMode && article !== null && article.id > 0;
  const feed = article ? getFeedById(article.feed_id) : null;
  const starred = article ? isItemStarred(article.id) : false;
  const safeArticleLink = article ? toSafeExternalUrl(article.link) : null;

  const handleToggleRead = async () => {
    if (!article || !canToggleRead) return;
    try {
      if (article.unread) {
        await markRead.mutateAsync([article.id]);
      } else {
        await markUnread.mutateAsync([article.id]);
      }
    } catch (error) {
      console.error("Failed to toggle read status:", error);
    }
  };

  const handleToggleStar = async () => {
    if (!article) return;
    try {
      if (starred) {
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
  };

  const handleOpenOriginal = () => {
    if (!safeArticleLink) return;
    openExternalUrl(safeArticleLink);
  };

  const { goToNext, goToPrevious, hasNext, hasPrevious } =
    useArticleNavigation(articleIds, {
      enabled: true,
      onToggleRead: () => {
        void handleToggleRead();
      },
      onToggleStar: () => {
        void handleToggleStar();
      },
      onOpenOriginal: handleOpenOriginal,
      onMarkAllRead: () => {
        void handleMarkAllAsRead();
      },
    });

  const { data: groups = [] } = useGroups();
  const markItemsReadByDate = useMarkItemsReadByDate();
  const purgeReadItems = usePurgeReadItems();
  const refreshFeeds = useRefreshFeeds();

  const [isCustomDateModalOpen, setIsCustomDateModalOpen] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const [isPurgeModalOpen, setIsPurgeModalOpen] = useState(false);
  const [isClearBookmarksOpen, setIsClearBookmarksOpen] = useState(false);

  const selectedFeed = selectedFeedId ? getFeedById(selectedFeedId) : null;
  const selectedGroup = selectedGroupId ? groups.find((g) => g.id === selectedGroupId) : null;

  let title = "All Feeds";
  if (selectedFocusFeed) {
    title = selectedFocusFeed.name;
  } else if (selectedFeed) {
    title = selectedFeed.name;
  } else if (selectedGroup) {
    title = selectedGroup.name;
  } else if (isStarredMode) {
    title = "Starred Articles";
  }

  const handleMarkAllAsRead = async () => {
    try {
      if (isStarredMode) {
        const itemIds = articles.filter((a) => a.unread && a.id > 0).map((a) => a.id);
        if (itemIds.length > 0) {
          await markRead.mutateAsync(itemIds);
          toast.success("Marked starred articles as read");
        } else {
          toast.info("No unread starred articles");
        }
        return;
      }

      if (selectedFocusFeed) {
        // Mark all matching focus feed items as read
        const itemIds = articles.filter((a) => a.unread).map((a) => a.id);
        if (itemIds.length > 0) {
          await markRead.mutateAsync(itemIds);
        }
        toast.success(`Marked articles in "${selectedFocusFeed.name}" as read`);
        return;
      }

      await markItemsReadByDate.mutateAsync({
        feed_id: selectedFeedId ?? undefined,
        group_id: selectedGroupId ?? undefined,
      });
      toast.success(
        selectedFeed
          ? `Marked all articles in ${selectedFeed.name} as read`
          : selectedGroup
          ? `Marked all articles in ${selectedGroup.name} as read`
          : "Marked all articles as read",
      );
    } catch (error) {
      console.error("Failed to mark all as read:", error);
      toast.error("Failed to mark all as read");
    }
  };

  const handleMarkAsReadOlderThan = async (days: number) => {
    const beforeDate = Math.floor(Date.now() / 1000) - (days * 86400);
    try {
      await markItemsReadByDate.mutateAsync({
        feed_id: selectedFeedId ?? undefined,
        group_id: selectedGroupId ?? undefined,
        before_date: beforeDate,
      });
      toast.success(`Marked articles older than ${days} ${days === 1 ? "day" : "days"} as read`);
    } catch (error) {
      console.error("Failed to mark read older than:", error);
      toast.error("Failed to mark articles as read");
    }
  };

  const handleCustomDateMarkAsRead = async () => {
    if (!customDate) return;
    const parsedDate = new Date(`${customDate}T23:59:59`);
    const beforeDate = Math.floor((isNaN(parsedDate.getTime()) ? new Date(customDate).getTime() : parsedDate.getTime()) / 1000);
    try {
      await markItemsReadByDate.mutateAsync({
        feed_id: selectedFeedId ?? undefined,
        group_id: selectedGroupId ?? undefined,
        before_date: beforeDate,
      });
      toast.success(`Marked articles before ${customDate} as read`);
      setIsCustomDateModalOpen(false);
    } catch (error) {
      console.error("Failed to mark custom date as read:", error);
      toast.error("Failed to mark articles as read");
    }
  };

  const handlePurge = async () => {
    try {
      await purgeReadItems.mutateAsync({
        feed_id: selectedFeedId ?? undefined,
        group_id: selectedGroupId ?? undefined,
      });
      toast.success(
        selectedFeed
          ? `Read articles purged for ${selectedFeed.name}`
          : selectedGroup
          ? `Read articles purged for ${selectedGroup.name}`
          : "Read articles purged",
      );
      setIsPurgeModalOpen(false);
    } catch (error) {
      console.error("Failed to purge read items:", error);
      toast.error("Failed to purge read items");
    }
  };

  const handleExportToExcel = async () => {
    try {
      let exportItems: Item[] = [];

      if (selectedFocusFeedId) {
        const res = await focusFeedAPI.listItems(selectedFocusFeedId, {
          unread: articleFilter === "unread" ? true : undefined,
          query: keywordQuery || undefined,
          limit: 1000,
        });
        exportItems = res.data ?? [];
      } else if (articleFilter === "starred") {
        const res = await bookmarkAPI.list({
          feed_id: selectedFeedId ?? undefined,
          group_id: selectedGroupId ?? undefined,
          limit: 1000,
        });
        exportItems = (res.data ?? []).map((b) => ({
          id: b.item_id ?? 0,
          feed_id: b.feed_id ?? 0,
          guid: "",
          title: b.title,
          link: b.link,
          content: b.content,
          pub_date: b.pub_date,
          unread: false,
          created_at: 0,
          updated_at: 0,
        }));
      } else {
        const res = await itemAPI.list({
          feed_id: selectedFeedId ?? undefined,
          group_id: selectedGroupId ?? undefined,
          unread: articleFilter === "unread" ? true : undefined,
          query: keywordQuery || undefined,
          limit: 1000,
        });
        exportItems = res.data ?? [];
      }

      const headers = ["Title", "Publication", "Link", "Short Description"];
      const escapeCSV = (val: string) => `"${val.replace(/"/g, '""')}"`;

      const rows = exportItems.map((item) => {
        const feedName = getFeedById(item.feed_id)?.name ?? "Unknown Source";
        const shortDesc = extractSummary(item.content ?? "", 200);
        return [
          escapeCSV(item.title ?? ""),
          escapeCSV(feedName),
          escapeCSV(item.link ?? ""),
          escapeCSV(shortDesc),
        ].join(",");
      });

      const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\n");
      const filename = `articles_${selectedFocusFeed ? "focus_" + selectedFocusFeed.name : articleFilter}_export.csv`;

      if (typeof window !== "undefined" && (window as any).webkit?.messageHandlers?.saveDownload) {
        (window as any).webkit.messageHandlers.saveDownload.postMessage({
          filename,
          content: csvContent,
        });
        toast.success(`Export saved to Downloads/${filename}`);
      } else {
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success(`Export saved to Downloads/${filename}`);
      }
    } catch (error) {
      console.error("Failed to export articles:", error);
      toast.error("Failed to export articles");
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-col h-full w-full overflow-hidden bg-background text-foreground">
        {/* Unified Sticky Header */}
        <div className="flex flex-col border-b border-border px-4 py-3 shrink-0 z-10 glass-header">
          {/* Line 1: Title & In-Line Filter Bar */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 min-w-0">
              <SidebarTrigger />
              {selectedFocusFeed && (
                <Crosshair className="h-4 w-4 text-primary shrink-0" />
              )}
              <h2 className="truncate text-lg font-semibold">{title}</h2>
              {selectedFocusFeed && (
                <span className="hidden sm:inline-flex text-[10px] font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20">
                  {selectedFocusFeed.keywords}
                </span>
              )}
            </div>

            {/* In-Line Monospace Filter Bar */}
            <form
              onSubmit={handleSearchSubmit}
              className="flex items-center gap-1.5 font-mono text-xs"
            >
              <div className="relative flex items-center">
                <Search className="absolute left-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={localSearch}
                  onChange={(e) => setLocalSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      handleClearSearch();
                      searchInputRef.current?.blur();
                    }
                  }}
                  onBlur={() => {
                    if (localSearch !== keywordQuery) {
                      setKeywordQuery(localSearch);
                    }
                  }}
                  placeholder="Filter articles... [/]"
                  className="h-7 w-40 sm:w-56 pl-7 pr-6 rounded border border-border bg-card text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary focus:w-64 transition-all"
                />
                {localSearch && (
                  <button
                    type="button"
                    onClick={handleClearSearch}
                    className="absolute right-1.5 text-muted-foreground hover:text-foreground"
                    title="Clear filter (ESC)"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {keywordQuery && (
                <span className="text-[10px] font-bold text-primary bg-primary/15 border border-primary/30 px-1.5 py-0.5 rounded">
                  {articles.length} MATCH{articles.length === 1 ? "" : "ES"}
                </span>
              )}
            </form>
          </div>

          {/* Line 2: Actions */}
          <div className="flex items-center justify-between mt-2 font-mono flex-wrap gap-2">
            {isStarredMode ? (
              <div className="flex items-center gap-4 flex-wrap">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setIsClearBookmarksOpen(true)}
                  disabled={deleteAllBookmarks.isPending || articles.length === 0}
                  className="gap-1.5 text-xs"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove all bookmarked
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleExportToExcel()}
                  className="gap-1.5 text-xs"
                >
                  <FileDown className="h-4 w-4" />
                  Export
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-4 flex-wrap">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                        <CheckCheck className="h-4 w-4" />
                        Mark all as read
                        <ChevronDown className="h-3 w-3 opacity-50" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={handleMarkAllAsRead}>
                      {selectedFocusFeed
                        ? `All in ${selectedFocusFeed.name}`
                        : selectedFeed
                        ? `All in ${selectedFeed.name}`
                        : selectedGroup
                        ? `All in ${selectedGroup.name}`
                        : "All articles"}
                    </DropdownMenuItem>
                    {!selectedFocusFeed && (
                      <>
                        <DropdownMenuItem onClick={() => handleMarkAsReadOlderThan(1)}>
                          Older than 1 day
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleMarkAsReadOlderThan(2)}>
                          Older than 2 days
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setIsCustomDateModalOpen(true)}>
                          <Calendar className="h-3.5 w-3.5 mr-2" />
                          Custom date...
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                {!selectedFocusFeed && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setIsPurgeModalOpen(true)}
                    className="gap-1.5 text-xs"
                  >
                    <Trash2 className="h-4 w-4" />
                    {selectedFeed
                      ? `Purge ${selectedFeed.name}`
                      : selectedGroup
                      ? `Purge ${selectedGroup.name}`
                      : "Purge"}
                  </Button>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refreshFeeds.mutate()}
                  disabled={refreshFeeds.isPending}
                  className="gap-1.5 text-xs"
                >
                  <RefreshCw className={`h-4 w-4 ${refreshFeeds.isPending ? "animate-spin" : ""}`} />
                  Check for updates
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleExportToExcel()}
                  className="gap-1.5 text-xs"
                >
                  <FileDown className="h-4 w-4" />
                  Export
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Content Area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Column 2: Feed List / Cards Dashboard */}
          <div
            className={cn(
              "h-full overflow-hidden transition-all duration-200",
              selectedArticleId !== null
                ? "w-full lg:w-[42%] border-r border-border"
                : "w-full",
            )}
          >
            <ArticleList />
          </div>
          
          {/* Column 3: Reader View (opens when article is selected) */}
          {selectedArticleId !== null && (
            <div className="hidden lg:block lg:w-[58%] h-full overflow-hidden animate-in fade-in duration-150">
              <ArticleContent
                article={article}
                feed={feed}
                starred={starred}
                canToggleRead={canToggleRead}
                isStarredMode={isStarredMode}
                onToggleRead={handleToggleRead}
                onToggleStar={handleToggleStar}
                onClose={() => setSelectedArticle(null)}
                goToNext={goToNext}
                goToPrevious={goToPrevious}
                hasNext={hasNext}
                hasPrevious={hasPrevious}
              />
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <Dialog open={isCustomDateModalOpen} onOpenChange={setIsCustomDateModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as read before date</DialogTitle>
            <DialogDescription>
              Mark all unread articles published before the selected date as read.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 font-mono">
            <label className="text-xs uppercase text-muted-foreground block mb-2 font-bold">
              Target Cut-Off Date
            </label>
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="w-full border border-border bg-card px-3 py-2 text-sm text-foreground rounded font-mono"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCustomDateModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCustomDateMarkAsRead}
              disabled={!customDate || markItemsReadByDate.isPending}
            >
              {markItemsReadByDate.isPending ? "Marking..." : "Mark as read"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Purge Modal */}
      <Dialog open={isPurgeModalOpen} onOpenChange={setIsPurgeModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Purge Read Articles</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete all read articles from the database? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsPurgeModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handlePurge}
              disabled={purgeReadItems.isPending}
            >
              {purgeReadItems.isPending ? "Purging..." : "Confirm Purge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear Bookmarks Modal */}
      <Dialog open={isClearBookmarksOpen} onOpenChange={setIsClearBookmarksOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove All Bookmarks</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete all starred articles? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsClearBookmarksOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                try {
                  await deleteAllBookmarks.mutateAsync(undefined);
                  toast.success("All bookmarked articles removed");
                  setIsClearBookmarksOpen(false);
                } catch {
                  toast.error("Failed to remove bookmarks");
                }
              }}
              disabled={deleteAllBookmarks.isPending}
            >
              {deleteAllBookmarks.isPending ? "Removing..." : "Remove All"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
