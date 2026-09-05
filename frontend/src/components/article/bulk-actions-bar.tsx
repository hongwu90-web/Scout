import { useState } from "react";
import {
  X,
  CheckCheck,
  Star,
  Tag,
  Mail,
  Printer,
  ExternalLink,
  MoreHorizontal,
  ChevronDown,
  FileDown,
  Copy,
  Languages,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSelectionStore } from "@/store/selection";
import { LabelPopover } from "./label-popover";
import { EmailDigestDialog } from "./email-digest-dialog";
import { printSelectedArticles } from "./article-print-view";
import { useMarkItemsRead, useMarkItemsUnread, useTranslateItemTitle } from "@/queries/items";
import { useBatchCreateBookmarks, useBatchDeleteBookmarks } from "@/queries/bookmarks";
import { openExternalUrl } from "@/lib/safe-url";
import { extractSummary, cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Item } from "@/lib/api";

interface BulkActionsBarProps {
  articles: Item[];
  getFeedName: (feedId: number) => string;
  isItemStarred: (itemId: number) => boolean;
}

export function BulkActionsBar({
  articles,
  getFeedName,
  isItemStarred,
}: BulkActionsBarProps) {
  const {
    isSelectionMode,
    selectedIds,
    selectAll,
    deselectAll,
    clearSelection,
  } = useSelectionStore();

  const [isEmailOpen, setIsEmailOpen] = useState(false);
  const [isBrowserConfirmOpen, setIsBrowserConfirmOpen] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);

  const markRead = useMarkItemsRead();
  const markUnread = useMarkItemsUnread();
  const batchCreateBookmarks = useBatchCreateBookmarks();
  const batchDeleteBookmarks = useBatchDeleteBookmarks();
  const translateTitle = useTranslateItemTitle();

  if (!isSelectionMode && selectedIds.length === 0) {
    return null;
  }

  const selectedArticles = articles.filter((a) => selectedIds.includes(a.id));
  const selectedCount = selectedIds.length;

  // Analysis of selected set
  const allRead = selectedArticles.length > 0 && selectedArticles.every((a) => !a.unread);
  const allStarred = selectedArticles.length > 0 && selectedArticles.every((a) => isItemStarred(a.id));

  // 1. Mark Read / Unread
  const handleToggleRead = async () => {
    if (selectedIds.length === 0) return;
    try {
      if (allRead) {
        await markUnread.mutateAsync(selectedIds);
        toast.success(`Marked ${selectedIds.length} article${selectedIds.length === 1 ? "" : "s"} as unread`);
      } else {
        await markRead.mutateAsync(selectedIds);
        toast.success(`Marked ${selectedIds.length} article${selectedIds.length === 1 ? "" : "s"} as read`);
      }
    } catch {
      toast.error("Failed to update read status");
    }
  };

  // 2. Star / Unstar
  const handleToggleStar = async () => {
    if (selectedIds.length === 0) return;
    try {
      if (allStarred) {
        await batchDeleteBookmarks.mutateAsync(selectedIds);
        toast.success(`Removed ${selectedIds.length} article${selectedIds.length === 1 ? "" : "s"} from starred`);
      } else {
        await batchCreateBookmarks.mutateAsync(selectedIds);
        toast.success(`Starred ${selectedIds.length} article${selectedIds.length === 1 ? "" : "s"}`);
      }
    } catch {
      toast.error("Failed to update stars");
    }
  };

  // 3. Open in Browser
  const executeOpenInBrowser = () => {
    selectedArticles.forEach((item) => {
      if (item.link) {
        openExternalUrl(item.link);
      }
    });
    setIsBrowserConfirmOpen(false);
  };

  const handleOpenInBrowserClick = () => {
    if (selectedArticles.length === 0) return;
    if (selectedArticles.length > 5) {
      setIsBrowserConfirmOpen(true);
      return;
    }
    executeOpenInBrowser();
  };

  // 4. Print
  const handlePrint = () => {
    if (selectedArticles.length === 0) {
      toast.info("No articles selected to print");
      return;
    }
    printSelectedArticles(selectedArticles, getFeedName);
  };

  // 5. Export CSV
  const handleExportCSV = () => {
    if (selectedArticles.length === 0) return;
    const headers = ["Title", "Publication", "Link", "Short Description"];
    const escapeCSV = (val: string) => `"${val.replace(/"/g, '""')}"`;
    const rows = selectedArticles.map((item) => {
      const feedName = getFeedName(item.feed_id);
      const shortDesc = extractSummary(item.content ?? "", 200);
      return [
        escapeCSV(item.title ?? ""),
        escapeCSV(feedName),
        escapeCSV(item.link ?? ""),
        escapeCSV(shortDesc),
      ].join(",");
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\n");
    const filename = `scout_selected_${selectedArticles.length}_export.csv`;

    if (typeof window !== "undefined" && (window as any).webkit?.messageHandlers?.saveDownload) {
      (window as any).webkit.messageHandlers.saveDownload.postMessage({
        filename,
        content: csvContent,
      });
      toast.success(`Export saved to Downloads/${filename}`);
    } else {
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success(`Exported ${selectedArticles.length} article${selectedArticles.length === 1 ? "" : "s"} to CSV`);
    }
  };

  // 6. Copy Links
  const handleCopyLinks = async () => {
    if (selectedArticles.length === 0) return;
    const links = selectedArticles.map((a) => a.link).join("\n");
    try {
      await navigator.clipboard.writeText(links);
      toast.success(`Copied ${selectedArticles.length} link${selectedArticles.length === 1 ? "" : "s"} to clipboard`);
    } catch {
      toast.error("Failed to copy links");
    }
  };

  // 7. Translate Titles
  const handleTranslateSelected = async () => {
    if (selectedArticles.length === 0) return;
    setIsTranslating(true);
    let count = 0;
    try {
      for (const item of selectedArticles) {
        if (!item.translated_title) {
          await translateTitle.mutateAsync(item.id);
          count++;
        }
      }
      toast.success(
        count > 0
          ? `Translated ${count} title${count === 1 ? "" : "s"} to English`
          : "Selected titles are already translated",
      );
    } catch {
      toast.error("Failed to translate some titles");
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <>
      <div className="sticky top-2 z-30 mx-auto w-fit max-w-[95%] shrink-0">
        <div className="flex items-center gap-1 sm:gap-2 px-2.5 py-1.5 rounded-full border border-border/80 bg-card/95 backdrop-blur-md shadow-lg text-foreground font-mono text-xs animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Dismiss button */}
          <button
            type="button"
            onClick={clearSelection}
            className="p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
            title="Exit selection mode (ESC)"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Selection count dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                >
                  <span>
                    {selectedCount === 0
                      ? "NO ARTICLES SELECTED"
                      : `${selectedCount} SELECTED`}
                  </span>
                  <ChevronDown className="h-3 w-3 opacity-70" />
                </button>
              }
            />
            <DropdownMenuContent align="start" className="font-mono text-xs">
              <DropdownMenuItem
                onClick={() => selectAll(articles.map((a) => a.id))}
              >
                Select all visible ({articles.length})
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  selectAll(articles.filter((a) => a.unread).map((a) => a.id))
                }
              >
                Select unread (
                {articles.filter((a) => a.unread).length})
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  selectAll(
                    articles.filter((a) => isItemStarred(a.id)).map((a) => a.id),
                  )
                }
              >
                Select starred (
                {articles.filter((a) => isItemStarred(a.id)).length})
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={deselectAll}>
                Deselect all
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="h-4 w-[1px] bg-border/80 mx-0.5" />

          {/* Star / Unstar */}
          <button
            type="button"
            disabled={selectedCount === 0 || batchCreateBookmarks.isPending || batchDeleteBookmarks.isPending}
            onClick={handleToggleStar}
            className={cn(
              "p-1.5 rounded-full hover:bg-accent/60 transition-colors disabled:opacity-40",
              allStarred ? "text-amber-500" : "text-muted-foreground hover:text-foreground",
            )}
            title={allStarred ? "Unstar selected" : "Star selected"}
          >
            <Star className={cn("h-4 w-4", allStarred && "fill-amber-500")} />
          </button>

          {/* Mark Read / Unread */}
          <button
            type="button"
            disabled={selectedCount === 0 || markRead.isPending || markUnread.isPending}
            onClick={handleToggleRead}
            className={cn(
              "p-1.5 rounded-full hover:bg-accent/60 transition-colors disabled:opacity-40",
              allRead ? "text-muted-foreground hover:text-foreground" : "text-primary",
            )}
            title={allRead ? "Mark selected as unread" : "Mark selected as read"}
          >
            <CheckCheck className="h-4 w-4" />
          </button>

          {/* Label / Tag */}
          <LabelPopover selectedItemIds={selectedIds}>
            <button
              type="button"
              disabled={selectedCount === 0}
              className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors disabled:opacity-40"
              title="Assign labels"
            >
              <Tag className="h-4 w-4" />
            </button>
          </LabelPopover>

          {/* Send to Email */}
          <button
            type="button"
            disabled={selectedCount === 0}
            onClick={() => setIsEmailOpen(true)}
            className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors disabled:opacity-40"
            title="Send articles via email digest"
          >
            <Mail className="h-4 w-4" />
          </button>

          {/* Print / Export PDF */}
          <button
            type="button"
            disabled={selectedCount === 0}
            onClick={handlePrint}
            className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors disabled:opacity-40"
            title="Print or export as PDF"
          >
            <Printer className="h-4 w-4" />
          </button>

          {/* Open in Browser */}
          <button
            type="button"
            disabled={selectedCount === 0}
            onClick={handleOpenInBrowserClick}
            className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors disabled:opacity-40"
            title="Open original links in browser"
          >
            <ExternalLink className="h-4 w-4" />
          </button>

          {/* More actions */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  disabled={selectedCount === 0}
                  className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors disabled:opacity-40"
                  title="More actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              }
            />
            <DropdownMenuContent align="end" className="font-mono text-xs">
              <DropdownMenuItem onClick={handleExportCSV}>
                <FileDown className="h-3.5 w-3.5 mr-2" />
                Export selected to CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCopyLinks}>
                <Copy className="h-3.5 w-3.5 mr-2" />
                Copy links list
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleTranslateSelected}
                disabled={isTranslating}
              >
                {isTranslating ? (
                  <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                ) : (
                  <Languages className="h-3.5 w-3.5 mr-2" />
                )}
                Translate titles to English
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Email Digest Dialog */}
      <EmailDigestDialog
        open={isEmailOpen}
        onOpenChange={setIsEmailOpen}
        articles={selectedArticles}
        getFeedName={getFeedName}
      />

      {/* Confirmation Dialog for opening >5 tabs */}
      <Dialog open={isBrowserConfirmOpen} onOpenChange={setIsBrowserConfirmOpen}>
        <DialogContent className="font-mono">
          <DialogHeader>
            <DialogTitle>Open {selectedArticles.length} tabs in browser?</DialogTitle>
            <DialogDescription>
              Opening many links simultaneously may trigger your browser's popup blocker or consume system resources. Are you sure you want to continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsBrowserConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={executeOpenInBrowser}>
              Open {selectedArticles.length} tabs
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
