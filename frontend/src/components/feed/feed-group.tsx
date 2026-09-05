import { useState } from "react";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useUrlState } from "@/hooks/use-url-state";
import { FeedItem } from "./feed-item";
import type { Feed } from "@/lib/api";

interface FeedGroupProps {
  groupId: number;
  name: string;
  feeds: Feed[];
  index: number;
  onFeedDrop?: (feedId: number, targetGroupId: number) => void;
  onFeedReorder?: (
    sourceFeedId: number,
    targetFeedId: number,
    position: "before" | "after",
  ) => void;
  onGroupContextMenu?: (e: React.MouseEvent, groupId: number, name: string) => void;
  onFeedContextMenu?: (e: React.MouseEvent, feed: Feed) => void;
}

export function FeedGroup({
  groupId,
  name,
  feeds,
  index,
  onFeedDrop,
  onFeedReorder,
  onGroupContextMenu,
  onFeedContextMenu,
}: FeedGroupProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);
  const { selectedGroupId, setSelectedGroup } = useUrlState();
  const isSelected = selectedGroupId === groupId;

  const unreadCount = feeds.reduce(
    (sum, feed) => sum + (feed.unread_count || 0),
    0,
  );

  const prefix = String(index).padStart(2, "0");
  const displayName = `${prefix} / ${name.toUpperCase()}`;

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="w-full min-w-0"
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          try {
            const raw = e.dataTransfer.getData("text/plain");
            if (!raw) return;
            const data = JSON.parse(raw);
            if (data.type === "feed" && data.id && onFeedDrop) {
              onFeedDrop(data.id, groupId);
            }
          } catch {}
        }}
        onContextMenu={(e) => {
          if (onGroupContextMenu) {
            e.preventDefault();
            e.stopPropagation();
            onGroupContextMenu(e, groupId, name);
          }
        }}
        className={cn(
          "flex w-full min-w-0 items-center justify-between px-2 py-1.5 text-xs font-semibold tracking-tight transition-all border-b border-sidebar-border/50 cursor-context-menu rounded-xs",
          isDragOver
            ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold border-dashed border-emerald-500"
            : isSelected
              ? "bg-sidebar-accent text-sidebar-accent-foreground font-bold"
              : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
        )}
        title="Drag a feed here to add to this group, or right-click for options"
      >
        <button
          type="button"
          onClick={() => setSelectedGroup(groupId)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-mono"
        >
          <span className="block min-w-0 flex-1 truncate">{displayName}</span>
          {unreadCount > 0 && (
            <span className="shrink-0 text-[11px] text-[#CFAE48] font-mono font-bold">
              ({unreadCount})
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(!isOpen);
          }}
          className="shrink-0 ml-2 font-mono text-[10px] text-sidebar-foreground/60 hover:text-sidebar-accent-foreground px-1"
        >
          {isOpen ? "[-]" : "[+]"}
        </button>
      </div>
      <CollapsibleContent>
        <div className="w-full min-w-0 pl-4 border-l border-sidebar-border/60 ml-2 mt-1 space-y-0.5">
          {feeds.map((feed) => (
            <FeedItem
              key={feed.id}
              feed={feed}
              onContextMenu={onFeedContextMenu}
              onFeedReorder={onFeedReorder}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
