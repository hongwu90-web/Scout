import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface FeedOrderState {
  feedOrder: number[];
  setFeedOrder: (order: number[]) => void;
  reorderFeed: (
    sourceFeedId: number,
    targetFeedId: number,
    position: "before" | "after",
    allFeedIds: number[],
  ) => void;
}

export const useFeedOrderStore = create<FeedOrderState>()(
  persist(
    (set) => ({
      feedOrder: [],
      setFeedOrder: (order) => set({ feedOrder: order }),
      reorderFeed: (sourceFeedId, targetFeedId, position, allFeedIds) => {
        if (sourceFeedId === targetFeedId) return;

        set((state) => {
          // Build current normalized order using all known feeds
          const existing = state.feedOrder.filter((id) => allFeedIds.includes(id));
          for (const id of allFeedIds) {
            if (!existing.includes(id)) {
              existing.push(id);
            }
          }

          // Remove source feed
          const withoutSource = existing.filter((id) => id !== sourceFeedId);

          // Find target feed index
          const targetIndex = withoutSource.indexOf(targetFeedId);
          if (targetIndex === -1) {
            return { feedOrder: [...withoutSource, sourceFeedId] };
          }

          const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
          const newOrder = [
            ...withoutSource.slice(0, insertIndex),
            sourceFeedId,
            ...withoutSource.slice(insertIndex),
          ];

          return { feedOrder: newOrder };
        });
      },
    }),
    {
      name: "scout-feed-order",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
