import {
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { useCallback } from "react";
import {
  defaultArticleFilter,
  isArticleFilter,
  type ArticleFilter,
} from "@/lib/article-filter";
import { parsePositiveIntegerParam } from "@/lib/route-params";

export type { ArticleFilter } from "@/lib/article-filter";

export function useUrlState() {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as {
    filter?: string;
    feedId?: string;
    groupId?: string;
    focusFeedId?: string;
  };
  const search = useSearch({ strict: false }) as Record<string, unknown>;

  const routeFeedId = parsePositiveIntegerParam(params.feedId);
  const routeGroupId = parsePositiveIntegerParam(params.groupId);
  const routeFocusFeedId = parsePositiveIntegerParam(params.focusFeedId);
  const selectedArticleId = parsePositiveIntegerParam(search.article);
  const keywordQuery = typeof search.q === "string" ? search.q : typeof search.query === "string" ? search.query : "";
  const routeFilter =
    typeof params.filter === "string" && isArticleFilter(params.filter)
      ? params.filter
      : defaultArticleFilter;

  const selectedFeedId = routeFeedId;
  const selectedGroupId = routeGroupId;
  const selectedFocusFeedId = routeFocusFeedId;
  const articleFilter = routeFilter;

  const navigateToList = useCallback(
    ({
      filter,
      feedId,
      groupId,
      focusFeedId,
      articleId,
      query,
      replace,
    }: {
      filter?: ArticleFilter;
      feedId?: number | null;
      groupId?: number | null;
      focusFeedId?: number | null;
      articleId?: number | null;
      query?: string;
      replace?: boolean;
    } = {}) => {
      const nextFilter = filter ?? articleFilter;
      const nextFeedId = feedId === undefined ? selectedFeedId : feedId;
      const nextGroupId = groupId === undefined ? selectedGroupId : groupId;
      const nextFocusFeedId = focusFeedId === undefined ? selectedFocusFeedId : focusFeedId;
      const nextArticleId = articleId === undefined ? selectedArticleId : articleId;
      const nextQuery = query === undefined ? keywordQuery : query;
      
      const nextSearch: Record<string, unknown> = {};
      if (nextArticleId) nextSearch.article = nextArticleId;
      if (nextQuery && nextQuery.trim() !== "") nextSearch.q = nextQuery.trim();

      if (nextFocusFeedId !== null) {
        navigate({
          to: "/focus-feeds/$focusFeedId/$filter",
          params: {
            focusFeedId: String(nextFocusFeedId),
            filter: nextFilter,
          },
          search: nextSearch,
          replace: replace ?? true,
        });
        return;
      }

      if (nextGroupId !== null) {
        navigate({
          to: "/groups/$groupId/$filter",
          params: {
            groupId: String(nextGroupId),
            filter: nextFilter,
          },
          search: nextSearch,
          replace: replace ?? true,
        });
        return;
      }

      if (nextFeedId !== null) {
        navigate({
          to: "/feeds/$feedId/$filter",
          params: {
            feedId: String(nextFeedId),
            filter: nextFilter,
          },
          search: nextSearch,
          replace: replace ?? true,
        });
        return;
      }

      navigate({
        to: "/$filter",
        params: { filter: nextFilter },
        search: nextSearch,
        replace: replace ?? true,
      });
    },
    [
      articleFilter,
      keywordQuery,
      navigate,
      selectedArticleId,
      selectedFeedId,
      selectedFocusFeedId,
      selectedGroupId,
    ],
  );

  const setSelectedFeed = useCallback(
    (feedId: number | null) => {
      navigateToList({
        feedId,
        groupId: null,
        focusFeedId: null,
        articleId: null,
      });
    },
    [navigateToList],
  );

  const setSelectedGroup = useCallback(
    (groupId: number | null) => {
      navigateToList({
        groupId,
        feedId: null,
        focusFeedId: null,
        articleId: null,
      });
    },
    [navigateToList],
  );

  const setSelectedFocusFeed = useCallback(
    (focusFeedId: number | null) => {
      navigateToList({
        focusFeedId,
        feedId: null,
        groupId: null,
        articleId: null,
      });
    },
    [navigateToList],
  );

  const setSelectedArticle = useCallback(
    (articleId: number | null) => {
      if (articleId === null) {
        navigateToList({ articleId: null, replace: true });
        return;
      }

      navigateToList({
        articleId,
        replace: selectedArticleId !== null,
      });
    },
    [navigateToList, selectedArticleId],
  );

  const setArticleFilter = useCallback(
    (filter: ArticleFilter) => {
      navigateToList({
        filter,
        articleId: null,
      });
    },
    [navigateToList],
  );

  const setKeywordQuery = useCallback(
    (query: string) => {
      navigateToList({
        query,
        articleId: null,
        replace: true,
      });
    },
    [navigateToList],
  );

  const selectTopLevelFilter = useCallback(
    (filter: ArticleFilter) => {
      navigateToList({
        filter,
        feedId: null,
        groupId: null,
        focusFeedId: null,
        articleId: null,
      });
    },
    [navigateToList],
  );

  return {
    selectedFeedId,
    selectedGroupId,
    selectedFocusFeedId,
    selectedArticleId,
    articleFilter,
    keywordQuery,
    setSelectedFeed,
    setSelectedGroup,
    setSelectedFocusFeed,
    setSelectedArticle,
    setArticleFilter,
    setKeywordQuery,
    selectTopLevelFilter,
  };
}
