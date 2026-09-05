import { useState, useRef } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUrlState } from "@/hooks/use-url-state";
import { useUIStore } from "@/store";
import type { Feed } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { getFaviconUrl } from "@/lib/api/favicon";
import { FeedFavicon } from "@/components/feed/feed-favicon";

interface FeedItemProps {
  feed: Feed;
  onContextMenu?: (e: React.MouseEvent, feed: Feed) => void;
  onFeedReorder?: (
    sourceFeedId: number,
    targetFeedId: number,
    position: "before" | "after",
  ) => void;
}

export function FeedItem({ feed, onContextMenu, onFeedReorder }: FeedItemProps) {
  const { t } = useI18n();
  const { selectedFeedId, setSelectedFeed } = useUrlState();
  const { setEditFeedOpen } = useUIStore();
  const [dropPosition, setDropPosition] = useState<"before" | "after" | null>(null);
  const isDraggingRef = useRef(false);

  const isSelected = selectedFeedId === feed.id;
  const feedFavicon = getFaviconUrl(feed.link, feed.site_url);

  const handleSettingsClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditFeedOpen(true, feed);
  };

  const handleDragStart = (e: React.DragEvent) => {
    isDraggingRef.current = true;
    e.dataTransfer.setData(
      "text/plain",
      JSON.stringify({ type: "feed", id: feed.id }),
    );
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEnd = () => {
    // Keep flag briefly to prevent synthetic click upon drag release
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 150);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";

    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const pos = e.clientY < midY ? "before" : "after";
    if (dropPosition !== pos) {
      setDropPosition(pos);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDropPosition(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const finalPos = dropPosition || "after";
    setDropPosition(null);

    try {
      const raw = e.dataTransfer.getData("text/plain");
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.type === "feed" && data.id && onFeedReorder) {
        if (data.id !== feed.id) {
          onFeedReorder(data.id, feed.id, finalPos);
        }
      }
    } catch {}
  };

  const handleButtonClick = () => {
    if (isDraggingRef.current) {
      return;
    }
    setSelectedFeed(feed.id);
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e, feed);
        }
      }}
      className={cn(
        "group relative flex w-full min-w-0 items-center gap-1.5 px-1.5 py-1 text-left text-xs font-mono transition-colors border-b border-sidebar-border/30 rounded-xs",
        isSelected
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
          : "text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
        dropPosition === "before" &&
          "before:absolute before:top-0 before:inset-x-0 before:h-[2px] before:bg-primary before:z-20 bg-primary/10",
        dropPosition === "after" &&
          "after:absolute after:bottom-0 after:inset-x-0 after:h-[2px] after:bg-primary after:z-20 bg-primary/10",
      )}
      title="Click to select feed, or drag the handle to reorder / move"
    >
      {/* Dedicated Drag Handle with Grab Cursor */}
      <div
        draggable={true}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 flex items-center justify-center p-0.5 text-sidebar-foreground/30 group-hover:text-sidebar-foreground/70 hover:!text-sidebar-foreground cursor-grab active:cursor-grabbing transition-colors"
        title="Drag to reorder feed or move to another group"
        aria-label="Drag handle"
      >
        <GripVertical className="h-3 w-3" />
      </div>

      {/* Main Clickable Feed Target with Classic Pointer */}
      <button
        type="button"
        onClick={handleButtonClick}
        className="cursor-pointer flex min-w-0 flex-1 items-center gap-1.5 text-left py-0.5"
      >
        <FeedFavicon
          src={feedFavicon}
          title={feed.name}
          className="w-3.5 h-3.5 shrink-0 pointer-events-none"
        />
        <span className="block min-w-0 max-w-full flex-1 truncate font-medium pointer-events-none">
          {feed.name}
        </span>
      </button>

      {/* Unread Counter and Edit Button */}
      <div className="ml-2 flex h-5 shrink-0 items-center justify-center gap-1">
        {feed.unread_count > 0 && (
          <span className="text-[10px] font-bold text-[#CFAE48] md:group-hover:hidden md:group-focus-within:hidden">
            ({feed.unread_count})
          </span>
        )}
        <button
          type="button"
          className="cursor-pointer hidden md:group-hover:inline-flex md:group-focus-within:inline-flex text-[10px] uppercase text-sidebar-foreground/60 hover:text-sidebar-accent-foreground"
          onClick={handleSettingsClick}
          aria-label={t("feed.edit.title")}
        >
          [EDIT]
        </button>
      </div>
    </div>
  );
}
