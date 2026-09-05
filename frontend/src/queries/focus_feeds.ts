import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { focusFeedAPI, type CreateFocusFeedRequest, type UpdateFocusFeedRequest } from "@/lib/api";
import { queryKeys } from "./keys";

export function useFocusFeeds() {
  return useQuery({
    queryKey: queryKeys.focusFeeds.list(),
    queryFn: async () => {
      const response = await focusFeedAPI.list();
      return response.data ?? [];
    },
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}

export function useFocusFeed(id: number | null) {
  return useQuery({
    queryKey: queryKeys.focusFeeds.detail(id ?? 0),
    queryFn: async () => {
      if (!id || id <= 0) return null;
      const response = await focusFeedAPI.get(id);
      return response.data ?? null;
    },
    enabled: Boolean(id && id > 0),
  });
}

export function useCreateFocusFeed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateFocusFeedRequest) => focusFeedAPI.create(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.focusFeeds.all });
    },
  });
}

export function useUpdateFocusFeed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateFocusFeedRequest }) =>
      focusFeedAPI.update(id, data),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.focusFeeds.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.focusFeeds.detail(variables.id),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.items.all });
    },
  });
}

export function useDeleteFocusFeed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => focusFeedAPI.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.focusFeeds.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.items.all });
    },
  });
}
