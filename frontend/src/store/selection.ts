import { create } from "zustand";

interface SelectionState {
  isSelectionMode: boolean;
  selectedIds: number[];
  lastSelectedId: number | null;

  setSelectionMode: (enabled: boolean) => void;
  toggleSelectionMode: () => void;
  toggleItem: (id: number) => void;
  selectRange: (targetId: number, orderedIds: number[]) => void;
  selectAll: (ids: number[]) => void;
  deselectAll: () => void;
  clearSelection: () => void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  isSelectionMode: false,
  selectedIds: [],
  lastSelectedId: null,

  setSelectionMode: (enabled: boolean) =>
    set({
      isSelectionMode: enabled,
      selectedIds: enabled ? get().selectedIds : [],
      lastSelectedId: enabled ? get().lastSelectedId : null,
    }),

  toggleSelectionMode: () => {
    const next = !get().isSelectionMode;
    set({
      isSelectionMode: next,
      selectedIds: next ? get().selectedIds : [],
      lastSelectedId: next ? get().lastSelectedId : null,
    });
  },

  toggleItem: (id: number) => {
    const current = get().selectedIds;
    const exists = current.includes(id);
    const updated = exists ? current.filter((i) => i !== id) : [...current, id];
    set({
      selectedIds: updated,
      lastSelectedId: id,
      isSelectionMode: true,
    });
  },

  selectRange: (targetId: number, orderedIds: number[]) => {
    const { lastSelectedId, selectedIds } = get();
    if (lastSelectedId === null || !orderedIds.includes(lastSelectedId) || !orderedIds.includes(targetId)) {
      get().toggleItem(targetId);
      return;
    }

    const idx1 = orderedIds.indexOf(lastSelectedId);
    const idx2 = orderedIds.indexOf(targetId);
    const start = Math.min(idx1, idx2);
    const end = Math.max(idx1, idx2);

    const rangeIds = orderedIds.slice(start, end + 1);
    const newSet = new Set([...selectedIds, ...rangeIds]);

    set({
      selectedIds: Array.from(newSet),
      lastSelectedId: targetId,
      isSelectionMode: true,
    });
  },

  selectAll: (ids: number[]) =>
    set({
      selectedIds: [...ids],
      isSelectionMode: true,
    }),

  deselectAll: () =>
    set({
      selectedIds: [],
      lastSelectedId: null,
    }),

  clearSelection: () =>
    set({
      isSelectionMode: false,
      selectedIds: [],
      lastSelectedId: null,
    }),
}));
