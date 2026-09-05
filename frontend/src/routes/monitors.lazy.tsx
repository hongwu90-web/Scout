import { createLazyFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { SidebarTrigger } from "@/components/layout/sidebar-trigger";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useMonitoredGroups,
  useMonitoredPages,
  useMonitoredPageSnapshots,
  useDeleteMonitoredGroup,
  useCheckMonitoredPageNow,
  useMarkMonitoredPageRead,
  useDeleteMonitoredPage,
  useUpdateMonitoredPage,
  useDeletePageSnapshots,
  useMarkPageSnapshotRead,
  useCloudMonitorStatus,
  useSyncCloudMonitors,
} from "@/queries/monitors";
import {
  AddEditMonitorDialog,
  CreateMonitorGroupDialog,
  RenameMonitorGroupDialog,
} from "@/components/monitor/monitor-dialog";
import { MonitorDiffView } from "@/components/monitor/monitor-diff-view";
import { formatDate } from "@/lib/utils";
import type { MonitoredGroup, MonitoredPage, PageSnapshot } from "@/lib/api";
import {
  Plus,
  Globe,
  AlertTriangle,
  RefreshCw,
  FolderPlus,
  Edit3,
  Trash2,
  ExternalLink,
  CheckCircle2,
  Folder,
  CheckSquare,
  Square,
  Cloud,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createLazyFileRoute("/monitors")({
  component: MonitorsPage,
});

function MonitorsPage() {
  const { data: groups = [] } = useMonitoredGroups();
  const { data: pages = [], isLoading, refetch, isRefetching } = useMonitoredPages();
  const cloudStatus = useCloudMonitorStatus();
  const syncCloudMutation = useSyncCloudMonitors();
  const deleteGroupMutation = useDeleteMonitoredGroup();
  const checkNowMutation = useCheckMonitoredPageNow();
  const markReadMutation = useMarkMonitoredPageRead();
  const deletePageMutation = useDeleteMonitoredPage();
  const updatePageMutation = useUpdateMonitoredPage();
  const deleteSnapshotsMutation = useDeletePageSnapshots();
  const markSnapshotReadMutation = useMarkPageSnapshotRead();

  const [selectedPageId, setSelectedPageId] = useState<number | null>(null);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(
    null,
  );
  const [selectedSnapshotIds, setSelectedSnapshotIds] = useState<number[]>([]);
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);

  const [filterMode, setFilterMode] = useState<"all" | "unread" | "error">(
    "all",
  );

  // Drag and drop state
  const [dragOverGroupId, setDragOverGroupId] = useState<number | null>(null);

  // Dialogs & Context Menu state
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<MonitoredGroup | null>(null);
  const [isRenameGroupOpen, setIsRenameGroupOpen] = useState(false);
  const [editingPage, setEditingPage] = useState<MonitoredPage | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "page" | "group" | "snapshot";
    page?: MonitoredPage;
    group?: MonitoredGroup;
    snapshot?: PageSnapshot;
  } | null>(null);

  // Close context menu on outside click or scroll
  useEffect(() => {
    const handleClose = () => setContextMenu(null);
    window.addEventListener("click", handleClose);
    window.addEventListener("scroll", handleClose, true);
    return () => {
      window.removeEventListener("click", handleClose);
      window.removeEventListener("scroll", handleClose, true);
    };
  }, []);

  const selectedPage = selectedPageId
    ? (pages.find((p) => p.id === selectedPageId) ?? null)
    : pages[0] ?? null;
  const activePageId = selectedPage?.id ?? null;

  const { data: snapshots = [] } = useMonitoredPageSnapshots(activePageId);
  const selectedSnapshot =
    snapshots.find((s) => s.id === selectedSnapshotId) ??
    snapshots[0] ??
    null;

  // Reset selected snapshots when active page changes
  useEffect(() => {
    setSelectedSnapshotIds([]);
    setLastClickedIndex(null);
  }, [activePageId]);

  const handleSnapshotSelect = (
    e: React.MouseEvent,
    snap: PageSnapshot,
    index: number,
  ) => {
    const snapId = snap.id;
    setSelectedSnapshotId(snapId);

    if (e.shiftKey && lastClickedIndex !== null) {
      // Range selection (Shift + Click)
      const start = Math.min(lastClickedIndex, index);
      const end = Math.max(lastClickedIndex, index);
      const rangeIds = snapshots.slice(start, end + 1).map((s) => s.id);
      setSelectedSnapshotIds((prev) => {
        const set = new Set(prev);
        rangeIds.forEach((id) => set.add(id));
        return Array.from(set);
      });
    } else if (e.metaKey || e.ctrlKey) {
      // Toggle selection (Cmd/Ctrl + Click)
      setSelectedSnapshotIds((prev) => {
        if (prev.includes(snapId)) {
          return prev.filter((id) => id !== snapId);
        } else {
          return [...prev, snapId];
        }
      });
      setLastClickedIndex(index);
    } else {
      // Single select
      setSelectedSnapshotIds([snapId]);
      setLastClickedIndex(index);
    }
  };

  const handleSelectAllSnapshots = () => {
    if (selectedSnapshotIds.length === snapshots.length) {
      setSelectedSnapshotIds([]);
    } else {
      setSelectedSnapshotIds(snapshots.map((s) => s.id));
    }
  };

  const handleDeleteSelectedSnapshots = async (idsToDelete?: number[]) => {
    if (!activePageId) return;
    const targetIds = idsToDelete || selectedSnapshotIds;
    if (targetIds.length === 0) return;

    const count = targetIds.length;
    const confirmMsg =
      count === 1
        ? "Delete this snapshot?"
        : `Delete ${count} selected snapshots?`;

    if (!confirm(confirmMsg)) return;

    try {
      await deleteSnapshotsMutation.mutateAsync({
        pageId: activePageId,
        snapshotIds: targetIds,
      });
      setSelectedSnapshotIds((prev) =>
        prev.filter((id) => !targetIds.includes(id)),
      );
      if (selectedSnapshotId && targetIds.includes(selectedSnapshotId)) {
        const remaining = snapshots.filter((s) => !targetIds.includes(s.id));
        setSelectedSnapshotId(remaining[0]?.id ?? null);
      }
      toast.success(
        count === 1 ? "Snapshot deleted" : `${count} snapshots deleted`,
      );
    } catch (err: any) {
      console.error("Failed to delete snapshots", err);
      toast.error(err?.message || "Failed to delete snapshot(s)");
    }
  };

  // Keyboard shortcut listener (Delete/Backspace to delete selected snapshots)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        selectedSnapshotIds.length > 0
      ) {
        const target = e.target as HTMLElement;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        handleDeleteSelectedSnapshots();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedSnapshotIds, activePageId, snapshots, selectedSnapshotId]);

  const filteredPages = pages.filter((p) => {
    if (filterMode === "unread") return p.unread;
    if (filterMode === "error") return p.last_status >= 400 || !!p.last_error;
    return true;
  });

  return (
    <AppLayout>
      <div className="flex flex-col h-full w-full overflow-hidden bg-background text-foreground">
        {/* Sticky Header Bar */}
        <div className="border-b border-border bg-background px-4 py-3 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <h2 className="text-lg font-bold font-mono uppercase tracking-tight">
              05 / WEBPAGE MONITORS
            </h2>
            {cloudStatus.data?.enabled && (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/30">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                CLOUD 24/7
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {cloudStatus.data?.enabled && (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const res = await syncCloudMutation.mutateAsync();
                    const count = (res as any)?.data?.imported_snapshots ?? 0;
                    toast.success(
                      count > 0
                        ? `Cloud sync completed: ${count} new snapshot(s) imported`
                        : "Cloud sync completed: Already up to date",
                    );
                  } catch (err: any) {
                    toast.error(err.message || "Failed to sync with cloud");
                  }
                }}
                disabled={syncCloudMutation.isPending}
                className="gap-1.5 text-xs font-mono border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
              >
                <Cloud className={`h-3.5 w-3.5 ${syncCloudMutation.isPending ? "animate-bounce" : ""}`} />
                {syncCloudMutation.isPending ? "Syncing..." : "Sync Cloud"}
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isRefetching}
              className="gap-1.5 text-xs font-mono"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCreateGroupOpen(true)}
              className="gap-1.5 text-xs font-mono"
            >
              <FolderPlus className="h-3.5 w-3.5 text-muted-foreground" />
              + Group
            </Button>

            <Button
              size="sm"
              onClick={() => {
                setEditingPage(null);
                setIsAddDialogOpen(true);
              }}
              className="gap-1 text-xs font-mono"
            >
              <Plus className="h-4 w-4" />
              Add Monitor
            </Button>
          </div>
        </div>

        {/* 3-Pane View Layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* Pane 1: Monitors Navigation List (25% width on desktop) */}
          <div className="w-full md:w-[28%] lg:w-[25%] h-full overflow-hidden border-r border-border flex flex-col bg-card">
            {/* Filter Tabs */}
            <div className="flex items-center border-b border-border p-2 font-mono text-[10px] uppercase gap-1 shrink-0">
              <button
                onClick={() => setFilterMode("all")}
                className={`flex-1 py-1 text-center font-bold transition-colors ${
                  filterMode === "all"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                ALL ({pages.length})
              </button>
              <button
                onClick={() => setFilterMode("unread")}
                className={`flex-1 py-1 text-center font-bold transition-colors ${
                  filterMode === "unread"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                UNREAD ({pages.filter((p) => p.unread).length})
              </button>
            </div>

            {/* Monitors Tree */}
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-2 space-y-3 font-mono text-xs">
                {isLoading ? (
                  <div className="p-4 text-center text-neutral-400 text-xs">
                    Loading monitors...
                  </div>
                ) : filteredPages.length === 0 ? (
                  <div className="p-6 text-center text-neutral-400 text-xs">
                    No monitored pages found. Click "+ Add Monitor" to start tracking.
                  </div>
                ) : (
                  <>
                    {/* Render Grouped Pages */}
                    {groups.map((group, idx) => {
                      const groupPages = filteredPages.filter(
                        (p) => p.group_id === group.id,
                      );
                      const isDragOver = dragOverGroupId === group.id;

                      return (
                        <div
                          key={group.id}
                          className={`space-y-0.5 rounded transition-all ${
                            isDragOver
                              ? "bg-emerald-50 ring-2 ring-emerald-500 p-1"
                              : ""
                          }`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            setDragOverGroupId(group.id);
                          }}
                          onDragLeave={() => setDragOverGroupId(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDragOverGroupId(null);
                            try {
                              const raw = e.dataTransfer.getData("text/plain");
                              if (!raw) return;
                              const data = JSON.parse(raw);
                              if (data.type === "monitor" && data.id) {
                                updatePageMutation.mutate({
                                  id: data.id,
                                  data: { group_id: group.id },
                                });
                              }
                            } catch {}
                          }}
                        >
                          <div
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                type: "group",
                                group,
                              });
                            }}
                            className="px-2 py-1 text-[10px] font-bold text-neutral-500 uppercase tracking-wider border-b border-neutral-100 flex items-center justify-between cursor-context-menu hover:bg-neutral-50 rounded transition-colors group"
                            title="Right-click for group options or drop monitor here"
                          >
                            <span className="flex items-center gap-1">
                              <Folder className="h-3 w-3 text-neutral-400" />
                              0{idx + 1} / {group.name}
                            </span>
                            <span className="text-[9px] font-normal text-neutral-400 font-mono">
                              ({groupPages.length})
                            </span>
                          </div>
                          {groupPages.length === 0 ? (
                            <div className="px-3 py-1.5 text-[10px] text-neutral-400 font-mono italic">
                              No monitors in this group (drag a monitor here)
                            </div>
                          ) : (
                            groupPages.map((page) => {
                              const isSelected = activePageId === page.id;
                              const hasErr =
                                page.last_status >= 400 || !!page.last_error;

                              return (
                                <button
                                  key={page.id}
                                  draggable={true}
                                  onDragStart={(e) => {
                                    e.dataTransfer.setData(
                                      "text/plain",
                                      JSON.stringify({
                                        type: "monitor",
                                        id: page.id,
                                      }),
                                    );
                                    e.dataTransfer.effectAllowed = "move";
                                  }}
                                  onClick={() => {
                                    setSelectedPageId(page.id);
                                    setSelectedSnapshotId(null);
                                  }}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setContextMenu({
                                      x: e.clientX,
                                      y: e.clientY,
                                      type: "page",
                                      page,
                                    });
                                  }}
                                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left rounded cursor-grab active:cursor-grabbing transition-colors ${
                                    isSelected
                                      ? "bg-neutral-100 font-bold text-neutral-900"
                                      : "hover:bg-neutral-50 text-neutral-700"
                                  }`}
                                  title="Drag to move to group, or right-click for options"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    {hasErr ? (
                                      <AlertTriangle className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                                    ) : (
                                      <Globe className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
                                    )}
                                    <span className="truncate">{page.name}</span>
                                  </div>

                                  {page.unread && (
                                    <span className="h-2 w-2 rounded-full bg-[#B83A26] shrink-0" />
                                  )}
                                </button>
                              );
                            })
                          )}
                        </div>
                      );
                    })}

                    {/* Ungrouped Pages */}
                    {(() => {
                      const ungrouped = filteredPages.filter(
                        (p) => !p.group_id || p.group_id === 0,
                      );
                      const isDragOver = dragOverGroupId === 0;

                      return (
                        <div
                          className={`space-y-0.5 rounded transition-all ${
                            isDragOver
                              ? "bg-emerald-50 ring-2 ring-emerald-500 p-1"
                              : ""
                          }`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            setDragOverGroupId(0);
                          }}
                          onDragLeave={() => setDragOverGroupId(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDragOverGroupId(null);
                            try {
                              const raw = e.dataTransfer.getData("text/plain");
                              if (!raw) return;
                              const data = JSON.parse(raw);
                              if (data.type === "monitor" && data.id) {
                                updatePageMutation.mutate({
                                  id: data.id,
                                  data: { group_id: 0 },
                                });
                              }
                            } catch {}
                          }}
                        >
                          {groups.length > 0 && (
                            <div className="px-2 py-1 text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-100">
                              UNGROUPED
                            </div>
                          )}
                          {ungrouped.map((page) => {
                            const isSelected = activePageId === page.id;
                            const hasErr =
                              page.last_status >= 400 || !!page.last_error;

                            return (
                              <button
                                key={page.id}
                                draggable={true}
                                onDragStart={(e) => {
                                  e.dataTransfer.setData(
                                    "text/plain",
                                    JSON.stringify({
                                      type: "monitor",
                                      id: page.id,
                                    }),
                                  );
                                  e.dataTransfer.effectAllowed = "move";
                                }}
                                onClick={() => {
                                  setSelectedPageId(page.id);
                                  setSelectedSnapshotId(null);
                                }}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setContextMenu({
                                    x: e.clientX,
                                    y: e.clientY,
                                    type: "page",
                                    page,
                                  });
                                }}
                                className={`flex w-full items-center justify-between px-3 py-1.5 text-left rounded cursor-grab active:cursor-grabbing transition-colors ${
                                  isSelected
                                    ? "bg-accent font-bold text-accent-foreground"
                                    : "hover:bg-accent/60 text-foreground"
                                }`}
                                title="Drag to move to group, or right-click for options"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {hasErr ? (
                                    <AlertTriangle className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                                  ) : (
                                    <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                  )}
                                  <span className="truncate">{page.name}</span>
                                </div>

                                {page.unread && (
                                  <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Pane 2: Snapshot Timeline History (25% width on desktop) */}
          <div className="hidden md:flex md:w-[25%] lg:w-[22%] h-full overflow-hidden border-r border-border flex-col bg-background">
            <div className="p-2.5 border-b border-border font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground shrink-0 flex items-center justify-between gap-1">
              <span className="truncate">
                SNAPSHOTS ({snapshots.length})
                {selectedSnapshotIds.length > 0 && (
                  <span className="ml-1 text-primary">[{selectedSnapshotIds.length}]</span>
                )}
              </span>

              <div className="flex items-center gap-1 shrink-0">
                {snapshots.length > 0 && (
                  <button
                    onClick={handleSelectAllSnapshots}
                    className="px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase rounded border border-border hover:border-foreground/60 text-muted-foreground hover:text-foreground transition-colors"
                    title="Select/Deselect all snapshots (Cmd+Click / Shift+Click supported)"
                  >
                    {selectedSnapshotIds.length === snapshots.length ? "CLEAR" : "ALL"}
                  </button>
                )}

                {selectedSnapshotIds.length > 0 && (
                  <button
                    onClick={() => handleDeleteSelectedSnapshots()}
                    disabled={deleteSnapshotsMutation.isPending}
                    className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 transition-colors"
                    title="Delete selected snapshots (or press Backspace/Delete)"
                  >
                    <Trash2 className="h-3 w-3" />
                    DEL ({selectedSnapshotIds.length})
                  </button>
                )}
              </div>
            </div>

            <ScrollArea className="flex-1 min-h-0">
              <div className="p-2 space-y-1 font-mono text-xs">
                {snapshots.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground text-xs">
                    No captured snapshots yet.
                  </div>
                ) : (
                  snapshots.map((snap, idx) => {
                    const isCardActive = selectedSnapshot?.id === snap.id;
                    const isMultiSelected = selectedSnapshotIds.includes(snap.id);
                    const isUnread = snap.unread && snap.has_change;

                    return (
                      <div
                        key={snap.id}
                        onClick={(e) => handleSnapshotSelect(e, snap, idx)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!selectedSnapshotIds.includes(snap.id)) {
                            setSelectedSnapshotIds([snap.id]);
                            setSelectedSnapshotId(snap.id);
                          }
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            type: "snapshot",
                            snapshot: snap,
                          });
                        }}
                        className={`group flex w-full flex-col p-2.5 text-left rounded border transition-colors cursor-pointer select-none relative ${
                          isMultiSelected
                            ? "bg-sidebar-accent/80 border-primary ring-1 ring-primary text-foreground font-bold shadow-xs"
                            : isUnread
                              ? isCardActive
                                ? "bg-neutral-200 dark:bg-neutral-800 border-neutral-900 dark:border-neutral-100 ring-2 ring-neutral-900 dark:ring-neutral-100 shadow-md text-neutral-900 dark:text-neutral-100 font-extrabold"
                                : "bg-neutral-200 dark:bg-neutral-800/80 border-neutral-300 dark:border-neutral-700 text-neutral-900 dark:text-neutral-100 font-semibold hover:bg-neutral-300/80 dark:hover:bg-neutral-700/80"
                              : isCardActive
                                ? "bg-card border-foreground shadow-xs ring-1 ring-foreground text-foreground font-bold"
                                : "bg-background border-border hover:border-foreground/40 text-muted-foreground"
                        }`}
                        title="Click to view. Shift+Click for range, Cmd+Click for multi-select, Right-click to delete."
                      >
                        <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground mb-1">
                          <div className="flex items-center gap-1.5">
                            {isMultiSelected ? (
                              <CheckSquare className="h-3.5 w-3.5 text-primary shrink-0" />
                            ) : (
                              <Square className="h-3.5 w-3.5 opacity-0 group-hover:opacity-40 shrink-0" />
                            )}
                            <span>{formatDate(snap.created_at)}</span>
                          </div>
                          {snap.has_change ? (
                            <span
                              className={`font-bold uppercase ${
                                isUnread
                                  ? "text-emerald-700 dark:text-emerald-400 font-extrabold"
                                  : "text-emerald-600 dark:text-emerald-500"
                              }`}
                            >
                              CHANGED {isUnread ? "• UNREAD" : ""}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60">BASELINE</span>
                          )}
                        </div>

                        <div className="flex items-center justify-between text-[11px] pl-5">
                          <div className="flex gap-2">
                            <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                              +{snap.added_count}
                            </span>
                            <span className="text-rose-600 dark:text-rose-400 font-bold">
                              -{snap.removed_count}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSelectedSnapshots([snap.id]);
                            }}
                            className="hidden group-hover:inline-flex text-[9px] uppercase text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400 p-0.5 rounded"
                            title="Delete snapshot"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Pane 3: Visual Diff & Content Reader (Remaining width) */}
          <div className="flex-1 h-full overflow-hidden">
            <MonitorDiffView
              page={selectedPage}
              snapshot={selectedSnapshot}
              onClose={() => setSelectedPageId(null)}
              onEdit={() => {
                setEditingPage(selectedPage);
                setIsAddDialogOpen(true);
              }}
            />
          </div>
        </div>
      </div>

      {/* Right-Click Context Menu Popup */}
      {contextMenu && (
        <div
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 min-w-[170px] bg-card border border-border shadow-lg rounded py-1 font-mono text-xs text-foreground animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === "page" && contextMenu.page && (
            <>
              <div className="px-3 py-1 font-bold text-[10px] text-muted-foreground uppercase border-b border-border truncate max-w-[180px]">
                {contextMenu.page.name}
              </div>
              <button
                onClick={() => {
                  setEditingPage(contextMenu.page!);
                  setIsAddDialogOpen(true);
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2"
              >
                <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
                Rename / Edit
              </button>
              <button
                onClick={() => {
                  checkNowMutation.mutate(contextMenu.page!.id);
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2"
              >
                <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                Re-check Now
              </button>
              <button
                onClick={() => {
                  markReadMutation.mutate({
                    id: contextMenu.page!.id,
                    unread: !contextMenu.page!.unread,
                  });
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                {contextMenu.page.unread ? "Mark as Read" : "Mark as Unread"}
              </button>
              <a
                href={contextMenu.page.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setContextMenu(null)}
                className="w-full px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2"
              >
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                Open Webpage
              </a>
              <div className="my-1 border-t border-border" />
              <button
                onClick={() => {
                  if (
                    confirm(
                      `Delete webpage monitor "${contextMenu.page!.name}"?`,
                    )
                  ) {
                    deletePageMutation.mutate(contextMenu.page!.id);
                  }
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-700 dark:text-rose-400 flex items-center gap-2"
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
                Delete Monitor
              </button>
            </>
          )}

          {contextMenu.type === "snapshot" && contextMenu.snapshot && (
            <>
              <div className="px-3 py-1 font-bold text-[10px] text-muted-foreground uppercase border-b border-border truncate max-w-[180px]">
                Snapshot ({formatDate(contextMenu.snapshot.created_at)})
              </div>
              <button
                onClick={() => {
                  if (activePageId) {
                    markSnapshotReadMutation.mutate({
                      pageId: activePageId,
                      snapshotId: contextMenu.snapshot!.id,
                      unread: !contextMenu.snapshot!.unread,
                    });
                  }
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                {contextMenu.snapshot.unread ? "Mark as Read" : "Mark as Unread"}
              </button>
              <div className="my-1 border-t border-border" />
              <button
                onClick={() => {
                  const toDelete = selectedSnapshotIds.includes(
                    contextMenu.snapshot!.id,
                  )
                    ? selectedSnapshotIds
                    : [contextMenu.snapshot!.id];
                  handleDeleteSelectedSnapshots(toDelete);
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-700 dark:text-rose-400 flex items-center gap-2"
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
                {selectedSnapshotIds.length > 1 &&
                selectedSnapshotIds.includes(contextMenu.snapshot.id)
                  ? `Delete ${selectedSnapshotIds.length} Selected Snapshots`
                  : "Delete Snapshot"}
              </button>
            </>
          )}

          {contextMenu.type === "group" && contextMenu.group && (
            <>
              <div className="px-3 py-1 font-bold text-[10px] text-muted-foreground uppercase border-b border-border truncate max-w-[180px]">
                Group: {contextMenu.group.name}
              </div>
              <button
                onClick={() => {
                  setEditingGroup(contextMenu.group!);
                  setIsRenameGroupOpen(true);
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2"
              >
                <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
                Rename Group
              </button>
              <div className="my-1 border-t border-border" />
              <button
                onClick={() => {
                  if (
                    confirm(
                      `Delete monitor group "${contextMenu.group!.name}"?`,
                    )
                  ) {
                    deleteGroupMutation.mutate(contextMenu.group!.id);
                  }
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-700 dark:text-rose-400 flex items-center gap-2"
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
                Delete Group
              </button>
            </>
          )}
        </div>
      )}

      {/* Add / Edit Monitor Dialog */}
      <AddEditMonitorDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        initialPage={editingPage}
      />

      {/* Create Monitor Group Dialog */}
      <CreateMonitorGroupDialog
        open={isCreateGroupOpen}
        onOpenChange={setIsCreateGroupOpen}
      />

      {/* Rename Monitor Group Dialog */}
      <RenameMonitorGroupDialog
        open={isRenameGroupOpen}
        group={editingGroup}
        onOpenChange={setIsRenameGroupOpen}
      />
    </AppLayout>
  );
}
