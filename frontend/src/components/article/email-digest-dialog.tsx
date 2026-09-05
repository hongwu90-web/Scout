import { useState } from "react";
import { Copy, Mail, Check, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatDate, extractSummary } from "@/lib/utils";
import { openMailtoUrl } from "@/lib/safe-url";
import type { Item } from "@/lib/api";

interface EmailDigestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  articles: Item[];
  getFeedName: (feedId: number) => string;
}

export function EmailDigestDialog({
  open,
  onOpenChange,
  articles,
  getFeedName,
}: EmailDigestDialogProps) {
  const [copied, setCopied] = useState(false);

  const generateDigestText = () => {
    const lines: string[] = [];
    lines.push(`SCOUT DIGEST - ${articles.length} ARTICLE${articles.length === 1 ? "" : "S"}\n`);
    articles.forEach((item, idx) => {
      const source = getFeedName(item.feed_id);
      const date = formatDate(item.pub_date);
      const summary = extractSummary(item.content, 200);
      lines.push(`${idx + 1}. ${item.title}`);
      lines.push(`   Source: ${source} | Date: ${date}`);
      lines.push(`   Link: ${item.link}`);
      if (summary) {
        lines.push(`   Summary: ${summary}`);
      }
      lines.push("");
    });
    return lines.join("\n");
  };

  const handleCopyDigest = async () => {
    const text = generateDigestText();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Digest copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy digest");
    }
  };

  const handleOpenMailApp = () => {
    const fullText = generateDigestText();
    // Prevent overly long URLs that can be rejected by OS URL handlers
    let bodyText = fullText;
    if (bodyText.length > 2000) {
      bodyText = fullText.slice(0, 1900) + "\n\n...[Digest truncated for mailto URL length; use 'Copy Digest' to paste complete digest]...";
    }
    const subject = encodeURIComponent(
      `Scout Digest: ${articles.length} Article${articles.length === 1 ? "" : "s"}`,
    );
    const body = encodeURIComponent(bodyText);
    const mailto = `mailto:?subject=${subject}&body=${body}`;
    openMailtoUrl(mailto);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[580px] max-h-[85vh] flex flex-col font-mono">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Mail className="h-4 w-4 text-primary" />
            <span>Send Articles via Email</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Generate an email digest with links, sources, and summaries for the {articles.length} selected article{articles.length === 1 ? "" : "s"}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 py-2">
          <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1">
            Digest Preview
          </div>
          <div className="max-h-56 overflow-y-auto rounded-xs border border-border bg-card p-3 text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed select-all">
            {generateDigestText()}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopyDigest}
            className="gap-1.5 text-xs uppercase"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-500" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy Digest
              </>
            )}
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleOpenMailApp}
            className="gap-1.5 text-xs uppercase font-bold"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in Mail App
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
