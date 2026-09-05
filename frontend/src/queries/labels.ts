import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { labelAPI } from "@/lib/api";

export const labelKeys = {
  all: ["labels"] as const,
  lists: () => [...labelKeys.all, "list"] as const,
  itemLabels: (ids: number[]) => [...labelKeys.all, "items", ...ids] as const,
};

export function useLabels() {
  return useQuery({
    queryKey: labelKeys.lists(),
    queryFn: async () => {
      const res = await labelAPI.list();
      return res.data ?? [];
    },
    staleTime: 60_000,
  });
}

export function useCreateLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; color?: string }) => {
      const res = await labelAPI.create(data);
      return res.data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: labelKeys.all });
    },
  });
}

export function useDeleteLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await labelAPI.delete(id);
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: labelKeys.all });
    },
  });
}

export function useBatchUpdateItemLabels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      label_id: number;
      item_ids: number[];
      action: "attach" | "detach";
    }) => {
      await labelAPI.batchUpdate(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: labelKeys.all });
    },
  });
}

export function useItemLabels(itemIds: number[]) {
  return useQuery({
    queryKey: labelKeys.itemLabels(itemIds),
    queryFn: async () => {
      if (itemIds.length === 0) return {};
      const res = await labelAPI.getItemLabels({ item_ids: itemIds });
      return res.data ?? {};
    },
    enabled: itemIds.length > 0,
    staleTime: 30_000,
  });
}
