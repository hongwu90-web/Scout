import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useUrlState } from "@/hooks/use-url-state";
import type { Item } from "@/lib/api";
import {
  useItem,
  useMarkItemsRead,
  useMarkItemsUnread,
} from "@/queries/items";
import { useFeedLookup } from "@/queries/feeds";
import {
  useCreateBookmark,
  useDeleteBookmark,
} from "@/queries/bookmarks";
import { useArticleList } from "@/hooks/use-article-list";
import { useArticleNavigation } from "@/hooks/use-keyboard";
import { toSafeExternalUrl, openExternalUrl } from "@/lib/safe-url";
import { useIsCompactScreen } from "@/hooks/use-mobile";

import { ArticleContent } from "./article-content";

export function ArticleDrawer() {
  const {
    selectedArticleId,
    setSelectedArticle,
    selectedFeedId,
    selectedGroupId,
    articleFilter,
  } = useUrlState();
  const { getFeedById } = useFeedLookup();

  const { articles, isStarredMode, isItemStarred, getBookmarkByItemId } =
    useArticleList({
      feedId: selectedFeedId,
      groupId: selectedGroupId,
      articleFilter,
    });

  const markRead = useMarkItemsRead();
  const markUnread = useMarkItemsUnread();
  const createBookmark = useCreateBookmark();
  const deleteBookmark = useDeleteBookmark();

  const articleIds = articles.map((a) => a.id);

  const storeArticle = selectedArticleId
    ? (articles.find((i) => i.id === selectedArticleId) ?? null)
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
  const canToggleRead = article !== null && article.id > 0;
  const feed = article ? getFeedById(article.feed_id) : null;
  const starred = article ? isItemStarred(article.id) : false;
  const safeArticleLink = article ? toSafeExternalUrl(article.link) : null;

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSelectedArticle(null);
    }
  };

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
      } else {
        await createBookmark.mutateAsync(article);
      }
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
      enabled: selectedArticleId !== null,
      onToggleRead: () => {
        void handleToggleRead();
      },
      onToggleStar: () => {
        void handleToggleStar();
      },
      onOpenOriginal: handleOpenOriginal,
    });

  const isCompact = useIsCompactScreen();

  return (
    <Sheet open={isCompact && selectedArticleId !== null} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-[max(840px,65vw)] p-0"
        showCloseButton={false}
      >
        <SheetTitle className="sr-only">
          {article?.title ?? "Reader View"}
        </SheetTitle>
        <ArticleContent
          article={article}
          feed={feed}
          starred={starred}
          canToggleRead={canToggleRead}
          onToggleRead={handleToggleRead}
          onToggleStar={handleToggleStar}
          onClose={() => setSelectedArticle(null)}
          goToNext={goToNext}
          goToPrevious={goToPrevious}
          hasNext={hasNext}
          hasPrevious={hasPrevious}
        />
      </SheetContent>
    </Sheet>
  );
}
