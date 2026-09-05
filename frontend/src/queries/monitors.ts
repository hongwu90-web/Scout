import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  monitoredGroupAPI,
  monitoredPageAPI,
  type CreateMonitoredPageRequest,
  type UpdateMonitoredPageRequest,
} from "@/lib/api";

export const monitorQueryKeys = {
  all: ["monitors"] as const,
  groups: () => [...monitorQueryKeys.all, "groups"] as const,
  pages: (groupId?: number) =>
    [...monitorQueryKeys.all, "pages", { groupId }] as const,
  page: (id: number) => [...monitorQueryKeys.all, "page", id] as const,
  snapshots: (pageId: number) =>
    [...monitorQueryKeys.all, "snapshots", pageId] as const,
};

export function useMonitoredGroups() {
  return useQuery({
    queryKey: monitorQueryKeys.groups(),
    queryFn: async () => {
      const res = await monitoredGroupAPI.list();
      return res.data ?? [];
    },
  });
}

export function useCreateMonitoredGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => monitoredGroupAPI.create({ name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: monitorQueryKeys.groups() });
    },
  });
}

export function useUpdateMonitoredGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      monitoredGroupAPI.update(id, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: monitorQueryKeys.groups() });
    },
  });
}

export function useDeleteMonitoredGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => monitoredGroupAPI.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: monitorQueryKeys.groups() });
      qc.invalidateQueries({ queryKey: monitorQueryKeys.pages() });
    },
  });
}

export function useMonitoredPages(groupId?: number) {
  return useQuery({
    queryKey: monitorQueryKeys.pages(groupId),
    queryFn: async () => {
      const res = await monitoredPageAPI.list(groupId);
      return res.data ?? [];
    },
  });
}

export function useMonitoredPage(id: number | null) {
  return useQuery({
    queryKey: monitorQueryKeys.page(id ?? 0),
    queryFn: async () => {
      if (!id) return null;
      const res = await monitoredPageAPI.get(id);
      return res.data ?? null;
    },
    enabled: !!id,
  });
}

export function useMonitoredPageSnapshots(pageId: number | null) {
  return useQuery({
    queryKey: monitorQueryKeys.snapshots(pageId ?? 0),
    queryFn: async () => {
      if (!pageId) return [];
      const res = await monitoredPageAPI.snapshots(pageId);
      return res.data ?? [];
    },
    enabled: !!pageId,
  });
}

export function useCreateMonitoredPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMonitoredPageRequest) =>
      monitoredPageAPI.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: monitorQueryKeys.pages() });
    },
  });
}

export function useUpdateMonitoredPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: UpdateMonitoredPageRequest;
    }) => monitoredPageAPI.update(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: monitorQueryKeys.pages() });
      qc.invalidateQueries({ queryKey: monitorQueryKeys.page(id) });
    },
  });
}

export function useDeleteMonitoredPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => monitoredPageAPI.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: monitorQueryKeys.pages() });
    },
  });
}

export function useCheckMonitoredPageNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => monitoredPageAPI.checkNow(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: monitorQueryKeys.pages() });
      qc.invalidateQueries({ queryKey: monitorQueryKeys.page(id) });
      qc.invalidateQueries({ queryKey: monitorQueryKeys.snapshots(id) });
    },
  });
}

export function useMarkMonitoredPageRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, unread }: { id: number; unread: boolean }) =>
      monitoredPageAPI.markRead(id, unread),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: monitorQueryKeys.pages() });
      qc.invalidateQueries({ queryKey: monitorQueryKeys.page(id) });
      qc.invalidateQueries({ queryKey: monitorQueryKeys.snapshots(id) });
    },
  });
}

export function useMarkPageSnapshotRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      pageId,
      snapshotId,
      unread,
    }: {
      pageId: number;
      snapshotId: number;
      unread: boolean;
    }) => monitoredPageAPI.markSnapshotRead(pageId, snapshotId, unread),
    onSuccess: (_, { pageId }) => {
      qc.invalidateQueries({ queryKey: monitorQueryKeys.pages() });
      qc.invalidateQueries({ queryKey: monitorQueryKeys.page(pageId) });
      qc.invalidateQueries({ queryKey: monitorQueryKeys.snapshots(pageId) });
    },
  });
}

export function useDeletePageSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      pageId,
      snapshotId,
    }: {
      pageId: number;
      snapshotId: number;
    }) => monitoredPageAPI.deleteSnapshot(pageId, snapshotId),
    onSuccess: (_, { pageId }) => {
      qc.invalidateQueries({ queryKey: monitorQueryKeys.pages() });
      qc.invalidateQueries({ queryKey: monitorQueryKeys.page(pageId) });
      qc.invalidateQueries({ queryKey: monitorQueryKeys.snapshots(pageId) });
    },
  });
}

export function useDeletePageSnapshots() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      pageId,
      snapshotIds,
    }: {
      pageId: number;
      snapshotIds: number[];
    }) => monitoredPageAPI.deleteSnapshots(pageId, snapshotIds),
    onSuccess: (_, { pageId }) => {
      qc.invalidateQueries({ queryKey: monitorQueryKeys.pages() });
      qc.invalidateQueries({ queryKey: monitorQueryKeys.page(pageId) });
      qc.invalidateQueries({ queryKey: monitorQueryKeys.snapshots(pageId) });
    },
  });
}

export function useCloudMonitorStatus() {
  return useQuery({
    queryKey: [...monitorQueryKeys.all, "cloud-status"] as const,
    queryFn: async () => {
      const res = await monitoredPageAPI.getCloudStatus();
      return res.data ?? { enabled: false, url: "" };
    },
  });
}

export function useSyncCloudMonitors() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => monitoredPageAPI.syncCloud(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: monitorQueryKeys.all });
    },
  });
}


