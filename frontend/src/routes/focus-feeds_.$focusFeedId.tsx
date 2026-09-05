import { createFileRoute, redirect } from "@tanstack/react-router";
import { defaultArticleFilter } from "@/lib/article-filter";
import { parsePositiveIntegerParam } from "@/lib/route-params";

export const Route = createFileRoute("/focus-feeds_/$focusFeedId")({
  beforeLoad: ({ params, location }) => {
    const focusFeedId = parsePositiveIntegerParam(params.focusFeedId);
    if (focusFeedId === null) {
      throw redirect({
        to: "/$filter",
        params: { filter: defaultArticleFilter },
        replace: true,
      });
    }

    const currentPath = location.pathname.replace(/\/+$/, "") || "/";
    if (currentPath !== `/focus-feeds/${params.focusFeedId}`) {
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
