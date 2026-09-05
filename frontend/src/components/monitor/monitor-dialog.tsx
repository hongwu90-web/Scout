import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useMonitoredGroups,
  useCreateMonitoredGroup,
  useUpdateMonitoredGroup,
  useCreateMonitoredPage,
  useUpdateMonitoredPage,
} from "@/queries/monitors";
import {
  monitoredPageAPI,
  type MonitoredGroup,
  type MonitoredPage,
} from "@/lib/api";
import { Loader2, Eye, Check } from "lucide-react";

interface AddEditMonitorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPage?: MonitoredPage | null;
}

export function AddEditMonitorDialog({
  open,
  onOpenChange,
  initialPage,
}: AddEditMonitorDialogProps) {
  const { data: groups = [] } = useMonitoredGroups();
  const createPage = useCreateMonitoredPage();
  const updatePage = useUpdateMonitoredPage();
  const createGroup = useCreateMonitoredGroup();

  const isEditing = !!initialPage;

  const [name, setName] = useState(initialPage?.name ?? "");
  const [url, setUrl] = useState(initialPage?.url ?? "");
  const [groupId, setGroupId] = useState<number | null>(
    initialPage?.group_id ?? null,
  );
  const [cssSelector, setCssSelector] = useState(
    initialPage?.css_selector ?? "",
  );
  const [stripSelectors, setStripSelectors] = useState(
    initialPage?.strip_selectors ?? "",
  );
  const [checkInterval, setCheckInterval] = useState(
    initialPage?.check_interval ?? 3600,
  );

  // Group Creation Inline
  const [isAddingGroup, setIsAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  // Preview state
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<{
    text: string;
    count: number;
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      const res = await createGroup.mutateAsync(newGroupName.trim());
      if (res.data) {
        setGroupId(res.data.id);
      }
      setIsAddingGroup(false);
      setNewGroupName("");
    } catch (e: any) {
      console.error(e);
    }
  };

  const handlePreview = async () => {
    if (!url.trim()) return;
    setIsPreviewing(true);
    setPreviewError(null);
    setPreviewResult(null);

    try {
      const res = await monitoredPageAPI.preview({
        url: url.trim(),
        css_selector: cssSelector.trim(),
        strip_selectors: stripSelectors.trim(),
      });
      if (res.data) {
        setPreviewResult({
          text: res.data.extracted_text,
          count: res.data.elements_count,
        });
      }
    } catch (err: any) {
      setPreviewError(err?.message ?? "Failed to fetch selector preview");
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;
    setSubmitError(null);

    try {
      if (isEditing && initialPage) {
        await updatePage.mutateAsync({
          id: initialPage.id,
          data: {
            name: name.trim(),
            url: url.trim(),
            group_id: groupId,
            css_selector: cssSelector.trim(),
            strip_selectors: stripSelectors.trim(),
            check_interval: checkInterval,
          },
        });
      } else {
        await createPage.mutateAsync({
          name: name.trim(),
          url: url.trim(),
          group_id: groupId,
          css_selector: cssSelector.trim(),
          strip_selectors: stripSelectors.trim(),
          check_interval: checkInterval,
        });
      }
      onOpenChange(false);
    } catch (err: any) {
      console.error("Failed to save monitor:", err);
      setSubmitError(err?.message ?? "Failed to save webpage monitor");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl font-sans bg-card border border-border">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-wider font-bold">
            {isEditing ? "Edit Webpage Monitor" : "Add Webpage Monitor"}
          </DialogTitle>
          <DialogDescription className="text-xs text-neutral-500 font-mono">
            Track visual & text changes on any webpage with optional CSS selector isolation.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2 text-xs">
          {/* Title & URL */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase font-bold text-neutral-500">
                Monitor Title *
              </label>
              <Input
                placeholder="e.g. AWS EC2 Pricing"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase font-bold text-neutral-500">
                Target URL *
              </label>
              <Input
                type="url"
                placeholder="https://example.com/pricing"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Group & Interval */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase font-bold text-neutral-500 flex justify-between">
                <span>Group / Category</span>
                {!isAddingGroup && (
                  <button
                    type="button"
                    onClick={() => setIsAddingGroup(true)}
                    className="text-[#B83A26] hover:underline"
                  >
                    + New Group
                  </button>
                )}
              </label>

              {isAddingGroup ? (
                <div className="flex gap-1">
                  <Input
                    placeholder="Group name"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleCreateGroup}
                    className="px-2"
                  >
                    <Check className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <select
                  value={groupId ?? ""}
                  onChange={(e) =>
                    setGroupId(e.target.value ? Number(e.target.value) : null)
                  }
                  className="w-full h-9 rounded-md border border-input bg-card text-foreground px-3 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                >
                  <option value="">(No Group)</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase font-bold text-neutral-500">
                Check Frequency
              </label>
              <select
                value={checkInterval}
                onChange={(e) => setCheckInterval(Number(e.target.value))}
                className="w-full h-9 rounded-md border border-input bg-card text-foreground px-3 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring font-mono"
              >
                <option value={900}>Every 15 minutes</option>
                <option value={1800}>Every 30 minutes</option>
                <option value={3600}>Every 1 hour</option>
                <option value={21600}>Every 6 hours</option>
                <option value={43200}>Every 12 hours</option>
                <option value={86400}>Every 24 hours</option>
              </select>
            </div>
          </div>

          {/* CSS Selectors */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="font-mono text-[10px] uppercase font-bold text-neutral-500">
                Target CSS Selector (Optional)
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handlePreview}
                disabled={isPreviewing || !url.trim()}
                className="h-6 text-[10px] font-mono gap-1"
              >
                {isPreviewing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Eye className="h-3 w-3" />
                )}
                Preview Selector
              </Button>
            </div>
            <Input
              placeholder="e.g. #pricing-table, .main-content, article"
              value={cssSelector}
              onChange={(e) => setCssSelector(e.target.value)}
              className="font-mono"
            />
          </div>

          {/* Strip Selectors */}
          <div className="space-y-1">
            <label className="font-mono text-[10px] uppercase font-bold text-neutral-500">
              Strip Selectors to Ignore (Comma Separated)
            </label>
            <Input
              placeholder="e.g. .nav, footer, .ads, .timestamp"
              value={stripSelectors}
              onChange={(e) => setStripSelectors(e.target.value)}
              className="font-mono"
            />
          </div>

          {/* Preview Output Result */}
          {previewResult && (
            <div className="p-3 border border-neutral-200 bg-neutral-50 rounded space-y-1 font-mono text-[11px]">
              <div className="flex justify-between text-neutral-500 font-bold">
                <span>PREVIEW RESULT ({previewResult.count} elements matched):</span>
              </div>
              <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-neutral-800 text-[10px]">
                {previewResult.text.slice(0, 500)}
                {previewResult.text.length > 500 && "..."}
              </p>
            </div>
          )}

          {previewError && (
            <div className="p-2 border border-rose-200 bg-rose-50 text-rose-800 text-xs font-mono rounded">
              {previewError}
            </div>
          )}

          {submitError && (
            <div className="p-2 border border-rose-200 bg-rose-50 text-rose-800 text-xs font-mono rounded">
              <strong>Error:</strong> {submitError}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createPage.isPending || updatePage.isPending}
            >
              {createPage.isPending || updatePage.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isEditing ? (
                "Save Changes"
              ) : (
                "Add Monitor"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface CreateMonitorGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateMonitorGroupDialog({
  open,
  onOpenChange,
}: CreateMonitorGroupDialogProps) {
  const createGroup = useCreateMonitoredGroup();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);

    try {
      await createGroup.mutateAsync(name.trim());
      setName("");
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.message ?? "Failed to create group");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md font-sans bg-card border border-border">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-wider font-bold">
            Create Monitor Group
          </DialogTitle>
          <DialogDescription className="text-xs text-neutral-500 font-mono">
            Organize webpage monitors into categories (e.g. Competitors, Pricing, News).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2 text-xs">
          <div className="space-y-1">
            <label className="font-mono text-[10px] uppercase font-bold text-neutral-500">
              Group Name *
            </label>
            <Input
              placeholder="e.g. Competitor Pricing"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          {error && (
            <div className="p-2 border border-rose-200 bg-rose-50 text-rose-800 text-xs font-mono rounded">
              {error}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createGroup.isPending}>
              {createGroup.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Create Group"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface RenameMonitorGroupDialogProps {
  open: boolean;
  group: MonitoredGroup | null;
  onOpenChange: (open: boolean) => void;
}

export function RenameMonitorGroupDialog({
  open,
  group,
  onOpenChange,
}: RenameMonitorGroupDialogProps) {
  const updateGroup = useUpdateMonitoredGroup();
  const [name, setName] = useState(group?.name ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (group) setName(group.name);
  }, [group]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!group || !name.trim()) return;
    setError(null);

    try {
      await updateGroup.mutateAsync({ id: group.id, name: name.trim() });
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.message ?? "Failed to rename group");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md font-sans bg-card border border-border">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-wider font-bold">
            Rename Monitor Group
          </DialogTitle>
          <DialogDescription className="text-xs text-neutral-500 font-mono">
            Change group title for "{group?.name}".
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2 text-xs">
          <div className="space-y-1">
            <label className="font-mono text-[10px] uppercase font-bold text-neutral-500">
              New Group Name *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          {error && (
            <div className="p-2 border border-rose-200 bg-rose-50 text-rose-800 text-xs font-mono rounded">
              {error}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={updateGroup.isPending}>
              {updateGroup.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Save Name"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
