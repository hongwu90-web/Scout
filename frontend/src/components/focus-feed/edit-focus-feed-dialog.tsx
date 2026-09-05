import { useState, useEffect } from "react";
import { Crosshair, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useGroups } from "@/queries/groups";
import { useFeedLookup } from "@/queries/feeds";
import { useUpdateFocusFeed, useDeleteFocusFeed } from "@/queries/focus_feeds";
import type { FocusFeed } from "@/lib/api";
import { toast } from "sonner";

interface EditFocusFeedDialogProps {
  focusFeed: FocusFeed | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

export function EditFocusFeedDialog({
  focusFeed,
  open,
  onOpenChange,
  onDeleted,
}: EditFocusFeedDialogProps) {
  const { data: groups = [] } = useGroups();
  const { feeds } = useFeedLookup();
  const updateFocusFeed = useUpdateFocusFeed();
  const deleteFocusFeed = useDeleteFocusFeed();

  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [groupId, setGroupId] = useState<string>("");
  const [selectedFeedIds, setSelectedFeedIds] = useState<number[]>([]);
  const [isAllFeeds, setIsAllFeeds] = useState(true);

  useEffect(() => {
    if (focusFeed) {
      setName(focusFeed.name);
      setKeywords(focusFeed.keywords);
      setGroupId(String(focusFeed.group_id));

      if (focusFeed.feed_ids && focusFeed.feed_ids.trim() !== "") {
        setIsAllFeeds(false);
        const ids = focusFeed.feed_ids
          .split(",")
          .map((id) => parseInt(id.trim(), 10))
          .filter((id) => !isNaN(id) && id > 0);
        setSelectedFeedIds(ids);
      } else {
        setIsAllFeeds(true);
        setSelectedFeedIds([]);
      }
    }
  }, [focusFeed]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!focusFeed) return;
    if (!name.trim() || !keywords.trim()) {
      toast.error("Please enter a name and at least one keyword");
      return;
    }

    const targetGroupId = groupId
      ? parseInt(groupId, 10)
      : focusFeed.group_id;

    const feedIDsStr = isAllFeeds ? "" : selectedFeedIds.join(",");

    try {
      await updateFocusFeed.mutateAsync({
        id: focusFeed.id,
        data: {
          name: name.trim(),
          keywords: keywords.trim(),
          feed_ids: feedIDsStr,
          group_id: targetGroupId,
        },
      });
      toast.success(`Updated Focus Feed "${name}"`);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to update Focus Feed");
    }
  };

  const handleDelete = async () => {
    if (!focusFeed) return;
    if (!confirm(`Are you sure you want to delete Focus Feed "${focusFeed.name}"?`)) {
      return;
    }

    try {
      await deleteFocusFeed.mutateAsync(focusFeed.id);
      toast.success(`Deleted Focus Feed "${focusFeed.name}"`);
      onOpenChange(false);
      onDeleted?.();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete Focus Feed");
    }
  };

  const toggleFeedSelection = (feedId: number) => {
    setSelectedFeedIds((prev) =>
      prev.includes(feedId)
        ? prev.filter((id) => id !== feedId)
        : [...prev, feedId],
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] font-mono">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crosshair className="h-5 w-5 text-primary" />
              <DialogTitle className="text-base uppercase tracking-wider">
                Edit Focus Feed
              </DialogTitle>
            </div>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleteFocusFeed.isPending}
              className="gap-1 text-xs"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Modify keyword filters or target feeds for this focus feed.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase font-bold text-foreground">
              Focus Feed Name *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Semiconductor Intel"
              required
              className="text-xs font-mono"
            />
          </div>

          {/* Keywords */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase font-bold text-foreground">
              Target Keywords (Comma or newline separated) *
            </label>
            <Textarea
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="e.g. TSMC, semiconductor, chip, lithography"
              rows={3}
              required
              className="text-xs font-mono"
            />
          </div>

          {/* Group */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase font-bold text-foreground">
              Category Group
            </label>
            <Select value={groupId} onValueChange={(val) => setGroupId(val ?? "")}>
              <SelectTrigger className="text-xs font-mono">
                <SelectValue placeholder="Select group" />
              </SelectTrigger>
              <SelectContent className="font-mono text-xs">
                {groups.map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Feed Scope */}
          <div className="space-y-1.5 pt-1">
            <label className="text-[11px] uppercase font-bold text-foreground">
              Feed Sources Scope
            </label>
            <div className="flex items-center gap-3 text-xs mb-2">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="editFeedScope"
                  checked={isAllFeeds}
                  onChange={() => setIsAllFeeds(true)}
                  className="accent-primary"
                />
                <span>All Feeds (Global)</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="editFeedScope"
                  checked={!isAllFeeds}
                  onChange={() => setIsAllFeeds(false)}
                  className="accent-primary"
                />
                <span>Specific Feeds ({selectedFeedIds.length} selected)</span>
              </label>
            </div>

            {!isAllFeeds && (
              <div className="max-h-36 overflow-y-auto border border-border p-2 rounded space-y-1 bg-muted/20">
                {feeds.map((feed) => (
                  <label
                    key={feed.id}
                    className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/40 p-1 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={selectedFeedIds.includes(feed.id)}
                      onChange={() => toggleFeedSelection(feed.id)}
                      className="accent-primary"
                    />
                    <span className="truncate">{feed.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs uppercase"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={updateFocusFeed.isPending}
              className="text-xs uppercase font-bold"
            >
              {updateFocusFeed.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
