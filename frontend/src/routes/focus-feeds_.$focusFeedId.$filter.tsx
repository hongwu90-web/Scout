import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  defaultArticleFilter,
  isArticleFilter,
} from "@/lib/article-filter";
import { parsePositiveIntegerParam } from "@/lib/route-params";

export const Route = createFileRoute("/focus-feeds_/$focusFeedId/$filter")({
  beforeLoad: ({ params }) => {
    const focusFeedId = parsePositiveIntegerParam(params.focusFeedId);
    if (focusFeedId === null) {
      throw redirect({
        to: "/$filter",
        params: { filter: defaultArticleFilter },
        replace: true,
      });
    }

    if (isArticleFilter(params.filter)) {
      return;
    }

    throw redirect({
      to: "/focus-feeds/$focusFeedId/$filter",
      params: {
        focusFeedId: String(focusFeedId),
        filter: defaultArticleFilter,
      },
      replace: true,
    });
  },
});
