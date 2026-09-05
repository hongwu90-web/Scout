import { useState } from "react";
import { Plus, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useLabels,
  useCreateLabel,
  useBatchUpdateItemLabels,
  useItemLabels,
} from "@/queries/labels";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const PRESET_COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // purple
  "#ec4899", // pink
];

interface LabelPopoverProps {
  selectedItemIds: number[];
  children?: React.ReactNode;
}

export function LabelPopover({ selectedItemIds, children }: LabelPopoverProps) {
  const { data: labels = [] } = useLabels();
  const createLabel = useCreateLabel();
  const batchUpdate = useBatchUpdateItemLabels();
  const { data: itemLabelsMap = {} } = useItemLabels(selectedItemIds);

  const [isCreating, setIsCreating] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);

  // Check which labels are attached to ALL or SOME of the selected items
  const getLabelAttachmentState = (labelId: number) => {
    if (selectedItemIds.length === 0) return "none";
    let count = 0;
    for (const itemId of selectedItemIds) {
      const itemLabels = itemLabelsMap[itemId] || [];
      if (itemLabels.includes(labelId)) {
        count++;
      }
    }
    if (count === selectedItemIds.length) return "all";
    if (count > 0) return "some";
    return "none";
  };

  const handleToggleLabel = async (labelId: number) => {
    const currentState = getLabelAttachmentState(labelId);
    const action = currentState === "all" ? "detach" : "attach";
    try {
      await batchUpdate.mutateAsync({
        label_id: labelId,
        item_ids: selectedItemIds,
        action,
      });
      toast.success(
        action === "attach"
          ? "Label added to selected articles"
          : "Label removed from selected articles",
      );
    } catch {
      toast.error("Failed to update labels");
    }
  };

  const handleCreateLabel = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newLabelName.trim();
    if (!trimmed) return;

    try {
      const created = await createLabel.mutateAsync({
        name: trimmed,
        color: selectedColor,
      });
      if (created && selectedItemIds.length > 0) {
        await batchUpdate.mutateAsync({
          label_id: created.id,
          item_ids: selectedItemIds,
          action: "attach",
        });
      }
      setNewLabelName("");
      setIsCreating(false);
      toast.success(`Label "${trimmed}" created`);
    } catch {
      toast.error("Failed to create label");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={children as any} />
      <DropdownMenuContent align="center" className="w-64 p-2 font-mono text-xs">
        <div className="px-2 py-1 font-bold uppercase tracking-wider text-[10px] text-muted-foreground flex items-center justify-between">
          <span>Assign Labels</span>
          <span className="text-primary">[{selectedItemIds.length} ITEMS]</span>
        </div>
        <DropdownMenuSeparator />

        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {labels.length === 0 && !isCreating && (
            <p className="px-2 py-3 text-center text-muted-foreground italic text-xs">
              No labels created yet.
            </p>
          )}

          {labels.map((l) => {
            const state = getLabelAttachmentState(l.id);
            return (
              <div
                key={l.id}
                onClick={(e) => {
                  e.preventDefault();
                  void handleToggleLabel(l.id);
                }}
                className="flex items-center justify-between px-2 py-1.5 rounded-xs hover:bg-accent/50 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2 truncate">
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: l.color || "#3b82f6" }}
                  />
                  <span className="truncate font-sans font-medium text-xs">
                    {l.name}
                  </span>
                </div>
                <div className="shrink-0 flex items-center">
                  {state === "all" && (
                    <Check className="h-3.5 w-3.5 text-primary stroke-[3]" />
                  )}
                  {state === "some" && (
                    <span className="h-1.5 w-2 bg-primary rounded-xs" />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <DropdownMenuSeparator />

        {isCreating ? (
          <form onSubmit={handleCreateLabel} className="p-1 space-y-2">
            <input
              type="text"
              autoFocus
              value={newLabelName}
              onChange={(e) => setNewLabelName(e.target.value)}
              placeholder="Label name..."
              className="w-full h-7 px-2 border border-border bg-card rounded-xs text-xs focus:outline-none focus:ring-1 focus:ring-primary font-sans"
            />
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setSelectedColor(c)}
                    className={cn(
                      "h-4 w-4 rounded-full transition-transform",
                      selectedColor === c && "ring-2 ring-foreground ring-offset-1 scale-110",
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setIsCreating(false)}
                  className="h-6 px-1.5 text-[10px]"
                >
                  <X className="h-3 w-3" />
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!newLabelName.trim() || createLabel.isPending}
                  className="h-6 px-2 text-[10px] uppercase font-bold"
                >
                  Add
                </Button>
              </div>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/40 rounded-xs transition-colors font-bold uppercase"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Create New Label</span>
          </button>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
