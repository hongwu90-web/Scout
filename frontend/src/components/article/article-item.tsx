import { useState } from "react";
import { cn, formatDate, extractSummary } from "@/lib/utils";
import type { Item } from "@/lib/api";
import { useTranslateItemTitle } from "@/queries/items";
import { Languages, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

interface ArticleItemProps {
  article: Item;
  selectedArticleId: number | null;
  onSelectArticle: (articleId: number | null) => void;
  onToggleRead: (article: Item) => Promise<void>;
  onToggleStar: (article: Item) => Promise<void>;
  canToggleRead: boolean;
  isStarred: boolean;
  isStarredMode?: boolean;
  feedName: string;
  isMultiSelected?: boolean;
  isSelectionMode?: boolean;
  onToggleSelect?: (e: React.MouseEvent) => void;
}

export function ArticleItem({
  article,
  selectedArticleId,
  onSelectArticle,
  onToggleRead,
  onToggleStar,
  canToggleRead,
  isStarred,
  isStarredMode = false,
  feedName,
  isMultiSelected = false,
  isSelectionMode = false,
  onToggleSelect,
}: ArticleItemProps) {
  const [showOriginal, setShowOriginal] = useState(false);
  const translateMutation = useTranslateItemTitle();
  const isSelected = selectedArticleId === article.id;

  const hasTranslation = Boolean(article.translated_title && article.translated_title.trim() !== "");
  const isTranslating = translateMutation.isPending;

  const handleToggleRead = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canToggleRead) return;

    try {
      await onToggleRead(article);
    } catch (error) {
      console.error("Failed to toggle read status:", error);
    }
  };

  const handleToggleStar = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await onToggleStar(article);
    } catch (error) {
      console.error("Failed to toggle star:", error);
    }
  };

  const handleTranslate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasTranslation) {
      setShowOriginal((prev) => !prev);
      return;
    }

    try {
      await translateMutation.mutateAsync(article.id);
      setShowOriginal(false);
      toast.success("Title translated to English");
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Translation failed";
      toast.error(msg);
    }
  };

  const wordCount = article.content ? article.content.replace(/<[^>]*>/g, "").split(/\s+/).length : 0;
  const readTime = Math.max(1, Math.ceil(wordCount / 220));

  const displayTitle = hasTranslation && !showOriginal ? article.translated_title : article.title;

  return (
    <div
      className={cn(
        "group relative flex w-full flex-col justify-between gap-3 border border-border p-4 text-left transition-all rounded-xs bg-card hover:border-foreground/40",
        isSelected
          ? "border-primary ring-1 ring-primary bg-accent/40"
          : "hover:bg-accent/20",
        isMultiSelected &&
          "border-primary ring-2 ring-primary/80 bg-primary/5 dark:bg-primary/10 shadow-sm",
      )}
    >
      <div className="flex flex-col gap-2">
        {/* Top Header line */}
        <div className="flex items-center justify-between font-mono text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
          <div className="flex items-center gap-1.5 truncate">
            <span className="text-primary shrink-0">[ {readTime} MIN READ ]</span>
            <span>/</span>
            <span className="truncate text-foreground/80">[ {feedName} ]</span>
            {hasTranslation && !showOriginal && (
              <>
                <span>/</span>
                <span className="text-primary/90 font-bold">[ EN ]</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <span className="text-muted-foreground/70 font-medium">
              {formatDate(article.pub_date)}
            </span>
            <div
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect?.(e);
              }}
              className={cn(
                "p-1 -m-1 transition-opacity cursor-pointer flex items-center justify-center",
                isSelectionMode || isMultiSelected
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100",
              )}
            >
              <Checkbox
                checked={isMultiSelected}
                onClick={(e) => onToggleSelect?.(e)}
                aria-label="Select article"
              />
            </div>
          </div>
        </div>

        {/* Article Title - Click to open reader sidebar */}
        <button
          type="button"
          onClick={() => onSelectArticle(article.id)}
          className="text-left w-full group/title focus:outline-none"
        >
          <h3
            className={cn(
              "line-clamp-2 text-sm font-bold leading-snug tracking-tight font-sans hover:underline cursor-pointer",
              isStarredMode || article.unread ? "text-foreground" : "text-muted-foreground/80 font-medium",
            )}
          >
            {displayTitle}
          </h3>
          {hasTranslation && !showOriginal && (
            <p className="line-clamp-1 text-[11px] text-muted-foreground/70 font-mono mt-1 italic">
              {article.title}
            </p>
          )}
        </button>

        {/* Short Excerpt */}
        <p className="line-clamp-2 text-xs text-muted-foreground leading-relaxed">
          {extractSummary(article.content, 140)}
        </p>
      </div>

      {/* Card Footer Actions */}
      <div className="flex items-center justify-between pt-2 border-t border-border/40 font-mono text-[10px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          {!isStarredMode && (
            <button
              onClick={handleToggleRead}
              disabled={!canToggleRead}
              className="text-muted-foreground hover:text-foreground border border-border hover:border-foreground/80 bg-background px-1.5 py-0.5 transition-colors font-bold uppercase"
            >
              {article.unread ? "[MARK READ]" : "[UNREAD]"}
            </button>
          )}
          <button
            onClick={handleToggleStar}
            className="text-muted-foreground hover:text-foreground border border-border hover:border-foreground/80 bg-background px-1.5 py-0.5 transition-colors font-bold uppercase"
          >
            {isStarred ? "[UNSTAR]" : "[STAR]"}
          </button>
          <button
            onClick={handleTranslate}
            disabled={isTranslating}
            className={cn(
              "flex items-center gap-1 text-muted-foreground hover:text-foreground border border-border hover:border-foreground/80 bg-background px-1.5 py-0.5 transition-colors font-bold uppercase",
              hasTranslation && !showOriginal && "text-primary border-primary/50",
            )}
            title={hasTranslation ? (showOriginal ? "Switch to English translation" : "Show original title") : "Translate title to English"}
          >
            {isTranslating ? (
              <>
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                <span>[TRANSLATING...]</span>
              </>
            ) : hasTranslation ? (
              <>
                <Languages className="w-2.5 h-2.5" />
                <span>{showOriginal ? "[SHOW EN]" : "[ORIG]"}</span>
              </>
            ) : (
              <>
                <Languages className="w-2.5 h-2.5" />
                <span>[TRANSLATE]</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
