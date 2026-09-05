import { useState } from "react";
import { Crosshair } from "lucide-react";
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
import { useCreateFocusFeed } from "@/queries/focus_feeds";
import { toast } from "sonner";

interface AddFocusFeedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddFocusFeedDialog({ open, onOpenChange }: AddFocusFeedDialogProps) {
  const { data: groups = [] } = useGroups();
  const { feeds } = useFeedLookup();
  const createFocusFeed = useCreateFocusFeed();

  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [groupId, setGroupId] = useState<string>("");
  const [selectedFeedIds, setSelectedFeedIds] = useState<number[]>([]);
  const [isAllFeeds, setIsAllFeeds] = useState(true);

  const resetForm = () => {
    setName("");
    setKeywords("");
    setGroupId("");
    setSelectedFeedIds([]);
    setIsAllFeeds(true);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm();
    }
    onOpenChange(newOpen);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !keywords.trim()) {
      toast.error("Please enter a name and at least one keyword");
      return;
    }

    const targetGroupId = groupId
      ? parseInt(groupId, 10)
      : groups[0]?.id ?? 1;

    const feedIDsStr = isAllFeeds ? "" : selectedFeedIds.join(",");

    try {
      await createFocusFeed.mutateAsync({
        name: name.trim(),
        keywords: keywords.trim(),
        feed_ids: feedIDsStr,
        group_id: targetGroupId,
        icon: "crosshair",
      });
      toast.success(`Created Keyword Focus Feed "${name}"`);
      handleOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to create Keyword Focus Feed");
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px] font-mono">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Crosshair className="h-5 w-5 text-primary" />
            <DialogTitle className="text-base uppercase tracking-wider">
              Create Keyword Focus Feed
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Aggregate and isolate feed articles matching specific keywords into a dedicated focus feed.
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
              placeholder="e.g. Semiconductor Intel / PBOC Policy"
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
              placeholder="e.g. TSMC, semiconductor, chip, lithography, foundry, ASML"
              rows={3}
              required
              className="text-xs font-mono"
            />
            <p className="text-[10px] text-muted-foreground">
              Articles containing any of these keywords in the headline, translated title, or body will match.
            </p>
          </div>

          {/* Group */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase font-bold text-foreground">
              Category Group
            </label>
            <Select
              value={groupId || (groups[0]?.id ? String(groups[0].id) : "")}
              onValueChange={(val) => setGroupId(val ?? "")}
            >
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
                  name="feedScope"
                  checked={isAllFeeds}
                  onChange={() => setIsAllFeeds(true)}
                  className="accent-primary"
                />
                <span>All Feeds (Global)</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="feedScope"
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
              onClick={() => handleOpenChange(false)}
              className="text-xs uppercase"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={createFocusFeed.isPending}
              className="text-xs uppercase font-bold"
            >
              {createFocusFeed.isPending ? "Creating..." : "Create Focus Feed"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
