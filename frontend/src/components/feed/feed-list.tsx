import { useState, useEffect } from "react";
import { useLocation } from "@tanstack/react-router";
import { ScrollArea } from "@/components/ui/scroll-area";
import { isArticleFilter } from "@/lib/article-filter";
import { useGroups, useDeleteGroup, useUpdateGroup } from "@/queries/groups";
import {
  useFeedLookup,
  useUnreadCounts,
  useUpdateFeed,
  useDeleteFeed,
  useRefreshFeeds,
} from "@/queries/feeds";
import { useFocusFeeds } from "@/queries/focus_feeds";
import { useMarkItemsReadByDate } from "@/queries/items";
import { useBookmarkLookup } from "@/queries/bookmarks";
import { useUrlState } from "@/hooks/use-url-state";
import { useUIStore, useFeedOrderStore } from "@/store";
import { cn } from "@/lib/utils";
import type { Feed, FocusFeed } from "@/lib/api";
import { FeedGroup } from "./feed-group";
import { FeedItem } from "./feed-item";
import { AddFocusFeedDialog } from "@/components/focus-feed/add-focus-feed-dialog";
import { EditFocusFeedDialog } from "@/components/focus-feed/edit-focus-feed-dialog";
import { Edit3, RefreshCw, CheckCircle2, Trash2, Plus, Crosshair, Settings2 } from "lucide-react";

export function FeedList() {
  const { data: groups = [], isLoading } = useGroups();
  const { feeds, getFeedsByGroup } = useFeedLookup();
  const { data: focusFeeds = [] } = useFocusFeeds();
  const { getTotalUnreadCount } = useUnreadCounts();
  const { total: starredTotal } = useBookmarkLookup();
  const updateFeed = useUpdateFeed();
  const deleteFeed = useDeleteFeed();
  const refreshFeeds = useRefreshFeeds();
  const markReadByDate = useMarkItemsReadByDate();
  const deleteGroup = useDeleteGroup();
  const updateGroup = useUpdateGroup();
  const { setEditFeedOpen } = useUIStore();
  const reorderFeed = useFeedOrderStore((state) => state.reorderFeed);

  const {
    selectedFeedId,
    selectedGroupId,
    selectedFocusFeedId,
    articleFilter,
    selectTopLevelFilter,
    setSelectedFocusFeed,
  } = useUrlState();
  const { pathname } = useLocation();

  const [dragOverUngrouped, setDragOverUngrouped] = useState(false);
  const [isAddFocusFeedOpen, setIsAddFocusFeedOpen] = useState(false);
  const [editingFocusFeed, setEditingFocusFeed] = useState<FocusFeed | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "feed" | "group";
    feed?: Feed;
    groupId?: number;
    name?: string;
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

  const firstPathSegment = pathname.split("/").filter(Boolean)[0];
  const isOnHomePage =
    typeof firstPathSegment === "string" && isArticleFilter(firstPathSegment);
  const isTopLevelSelected =
    isOnHomePage && selectedFeedId === null && selectedGroupId === null && selectedFocusFeedId === null;
  const totalUnread = getTotalUnreadCount();
  const starredCount = starredTotal;

  const topFilters: Array<{
    value: "unread" | "starred";
    label: string;
    count: number;
  }> = [
    {
      value: "unread",
      label: "01 / UNREAD",
      count: totalUnread,
    },
    {
      value: "starred",
      label: "02 / STARRED",
      count: starredCount,
    },
  ];

  if (isLoading && groups.length === 0) {
    return (
      <div className="flex-1 p-4">
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 animate-pulse bg-neutral-100" />
          ))}
        </div>
      </div>
    );
  }

  const handleFeedDrop = (feedId: number, targetGroupId: number) => {
    updateFeed.mutate({ id: feedId, group_id: targetGroupId });
  };

  const handleFeedReorder = (
    sourceFeedId: number,
    targetFeedId: number,
    position: "before" | "after",
  ) => {
    const sourceFeed = feeds.find((f) => f.id === sourceFeedId);
    const targetFeed = feeds.find((f) => f.id === targetFeedId);
    if (!sourceFeed || !targetFeed) return;

    if (sourceFeed.group_id !== targetFeed.group_id) {
      updateFeed.mutate({ id: sourceFeedId, group_id: targetFeed.group_id });
    }

    const allFeedIds = feeds.map((f) => f.id);
    reorderFeed(sourceFeedId, targetFeedId, position, allFeedIds);
  };

  const handleFeedContextMenu = (e: React.MouseEvent, feed: Feed) => {
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      type: "feed",
      feed,
    });
  };

  const handleGroupContextMenu = (
    e: React.MouseEvent,
    groupId: number,
    name: string,
  ) => {
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      type: "group",
      groupId,
      name,
    });
  };

  return (
    <>
      <ScrollArea className="min-h-0 flex-1 w-full min-w-0 overflow-hidden [&_[data-slot=scroll-area-viewport]>div]:!block">
        <div className="w-full min-w-0 p-3 space-y-0.5">
          {/* Top-level filters */}
          <div className="space-y-1">
            {topFilters.map(({ value, label, count }) => (
              <button
                key={value}
                onClick={() => selectTopLevelFilter(value)}
                className={cn(
                  "flex w-full min-w-0 items-center justify-between px-2 py-1 text-left text-xs font-semibold uppercase transition-colors rounded-xs",
                  isTopLevelSelected && articleFilter === value
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-bold"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {count > 0 && (
                  <span className="shrink-0 text-[11px] font-mono text-[#CFAE48] font-bold">
                    ({count})
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Keyword Focus Feeds Header */}
          <div className="mt-4 flex items-center justify-between px-2 py-1 border-b border-sidebar-border/60 mb-2">
            <span className="text-[11px] font-bold text-sidebar-foreground/60 tracking-wider uppercase font-mono">
              03 / KEYWORD FOCUS
            </span>
            <button
              onClick={() => setIsAddFocusFeedOpen(true)}
              className="text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 p-0.5 rounded transition-colors"
              title="Add Keyword Focus Feed"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Keyword Focus Feed Items */}
          <div className="w-full min-w-0 space-y-0.5">
            {focusFeeds
              .filter((ff): ff is FocusFeed => Boolean(ff && typeof ff.id === "number"))
              .map((ff) => {
              const isSelected = selectedFocusFeedId === ff.id;
              return (
                <div
                  key={ff.id}
                  className={cn(
                    "group flex w-full min-w-0 items-center justify-between px-2 py-1 text-xs font-medium uppercase transition-colors rounded-xs cursor-pointer",
                    isSelected
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-bold"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                  )}
                  onClick={() => setSelectedFocusFeed(ff.id)}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <Crosshair className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="truncate">{ff.name}</span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 ml-1">
                    {ff.unread_count > 0 && (
                      <span className="text-[10px] font-mono font-bold bg-[#CFAE48]/15 text-[#CFAE48] border border-[#CFAE48]/30 px-1 rounded">
                        {ff.unread_count}
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingFocusFeed(ff);
                      }}
                      className="opacity-0 group-hover:opacity-100 hover:text-foreground text-muted-foreground p-0.5 rounded transition-opacity"
                      title="Edit Focus Feed"
                    >
                      <Settings2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
            {focusFeeds.length === 0 && (
              <button
                onClick={() => setIsAddFocusFeedOpen(true)}
                className="w-full text-left px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground italic"
              >
                + Create first Keyword Focus feed
              </button>
            )}
          </div>

          {/* Feeds header */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDragOverUngrouped(true);
            }}
            onDragLeave={() => setDragOverUngrouped(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverUngrouped(false);
              try {
                const raw = e.dataTransfer.getData("text/plain");
                if (!raw) return;
                const data = JSON.parse(raw);
                if (data.type === "feed" && data.id) {
                  handleFeedDrop(data.id, 0);
                }
              } catch {}
            }}
            className={cn(
              "mt-4 flex items-center justify-between px-2 py-1 border-b border-sidebar-border/60 mb-2 transition-all",
              dragOverUngrouped ? "bg-emerald-500/20 border-emerald-500 font-bold text-emerald-600 dark:text-emerald-400" : "",
            )}
            title="Drag a feed here to unassign from group"
          >
            <span className="text-[11px] font-bold text-sidebar-foreground/60 tracking-wider uppercase font-mono">
              04 / FEEDS
            </span>
          </div>

          {/* Feed groups */}
          <div className="w-full min-w-0 space-y-0.5">
            {groups.map((group, idx) => {
              const groupFeeds = getFeedsByGroup(group.id);

              return (
                <FeedGroup
                  key={group.id}
                  groupId={group.id}
                  name={group.name}
                  feeds={groupFeeds}
                  index={idx + 1}
                  onFeedDrop={handleFeedDrop}
                  onFeedReorder={handleFeedReorder}
                  onGroupContextMenu={handleGroupContextMenu}
                  onFeedContextMenu={handleFeedContextMenu}
                />
              );
            })}

            {/* Ungrouped feeds (group_id = 0) */}
            {feeds
              .filter((f) => f.group_id === 0)
              .map((feed) => (
                <FeedItem
                  key={feed.id}
                  feed={feed}
                  onFeedReorder={handleFeedReorder}
                  onContextMenu={handleFeedContextMenu}
                />
              ))}
          </div>
        </div>

        {/* Right-Click Context Menu Popup for Feeds & Groups */}
        {contextMenu && (
          <div
            style={{ top: contextMenu.y, left: contextMenu.x }}
            className="fixed z-50 min-w-[160px] bg-card border border-border shadow-lg rounded py-1 font-mono text-xs text-foreground animate-in fade-in zoom-in-95 duration-100"
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.type === "feed" && contextMenu.feed && (
              <>
                <div className="px-3 py-1 font-bold text-[10px] text-muted-foreground uppercase border-b border-border truncate max-w-[180px]">
                  {contextMenu.feed.name}
                </div>
                <button
                  onClick={() => {
                    setEditFeedOpen(true, contextMenu.feed);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-accent flex items-center gap-2"
                >
                  <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
                  Edit / Rename Feed
                </button>
                <button
                  onClick={() => {
                    refreshFeeds.mutate();
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-accent flex items-center gap-2"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                  Refresh Feeds Now
                </button>
                <button
                  onClick={() => {
                    markReadByDate.mutate({ feed_id: contextMenu.feed!.id });
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-accent flex items-center gap-2"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                  Mark All as Read
                </button>
                <div className="my-1 border-t border-border" />
                <button
                  onClick={() => {
                    if (confirm(`Delete feed "${contextMenu.feed?.name}"?`)) {
                      deleteFeed.mutate(contextMenu.feed!.id);
                    }
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-destructive/10 text-destructive flex items-center gap-2"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Feed
                </button>
              </>
            )}

            {contextMenu.type === "group" && contextMenu.groupId && (
              <>
                <div className="px-3 py-1 font-bold text-[10px] text-muted-foreground uppercase border-b border-border truncate max-w-[180px]">
                  {contextMenu.name}
                </div>
                <button
                  onClick={() => {
                    const newName = prompt("Enter new group name:", contextMenu.name);
                    if (newName && newName.trim()) {
                      updateGroup.mutate({ id: contextMenu.groupId!, name: newName.trim() });
                    }
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-accent flex items-center gap-2"
                >
                  <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
                  Rename Group
                </button>
                <button
                  onClick={() => {
                    markReadByDate.mutate({ group_id: contextMenu.groupId! });
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-accent flex items-center gap-2"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                  Mark All as Read
                </button>
                <div className="my-1 border-t border-border" />
                <button
                  onClick={() => {
                    if (confirm(`Delete group "${contextMenu.name}"? Feeds in this group will be ungrouped.`)) {
                      deleteGroup.mutate(contextMenu.groupId!);
                    }
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-destructive/10 text-destructive flex items-center gap-2"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Group
                </button>
              </>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Focus Feed Modals */}
      <AddFocusFeedDialog
        open={isAddFocusFeedOpen}
        onOpenChange={setIsAddFocusFeedOpen}
      />
      <EditFocusFeedDialog
        focusFeed={editingFocusFeed}
        open={Boolean(editingFocusFeed)}
        onOpenChange={(open) => {
          if (!open) setEditingFocusFeed(null);
        }}
        onDeleted={() => {
          setEditingFocusFeed(null);
          selectTopLevelFilter("unread");
        }}
      />
    </>
  );
}
