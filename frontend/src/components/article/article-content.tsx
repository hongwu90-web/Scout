import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Item, Feed } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { processArticleContent } from "@/lib/content";
import { toSafeExternalUrl, openExternalUrl } from "@/lib/safe-url";
import { useTranslateItemTitle } from "@/queries/items";
import { Languages, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ArticleContentProps {
  article: Item | null;
  feed?: Feed | null;
  starred: boolean;
  canToggleRead: boolean;
  isStarredMode?: boolean;
  onToggleRead: () => void;
  onToggleStar: () => void;
  onClose?: () => void;
  goToNext?: () => void;
  goToPrevious?: () => void;
  hasNext?: () => boolean;
  hasPrevious?: () => boolean;
}

export function ArticleContent({
  article,
  feed,
  starred,
  canToggleRead,
  isStarredMode = false,
  onToggleRead,
  onToggleStar,
  onClose,
  goToNext,
  goToPrevious,
  hasNext,
  hasPrevious,
}: ArticleContentProps) {
  const [showOriginal, setShowOriginal] = useState(false);
  const translateMutation = useTranslateItemTitle();

  if (!article) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background text-muted-foreground p-8 text-center font-mono">
        <span className="text-xs uppercase tracking-widest font-bold">03 / READER</span>
        <p className="mt-4 text-xs">SELECT AN ARTICLE TO DECRYPT / READ BRIEFING</p>
      </div>
    );
  }

  const safeArticleLink = toSafeExternalUrl(article.link);
  const getLinkDomain = (url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  };

  const domain = safeArticleLink ? getLinkDomain(safeArticleLink) : "";
  const feedName = feed?.name ?? "Unknown Source";
  
  // Simple word count to estimate read time
  const wordCount = article.content ? article.content.replace(/<[^>]*>/g, "").split(/\s+/).length : 0;
  const readTime = Math.max(1, Math.ceil(wordCount / 220));

  const hasTranslation = Boolean(article.translated_title && article.translated_title.trim() !== "");
  const isTranslating = translateMutation.isPending;

  const handleTranslate = async () => {
    if (hasTranslation) {
      setShowOriginal((prev) => !prev);
      return;
    }

    try {
      await translateMutation.mutateAsync(article.id);
      setShowOriginal(false);
      toast.success("Title translated via Gemini 2.0 Flash");
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Translation failed";
      toast.error(msg);
    }
  };

  const handleOpenOriginal = () => {
    if (!safeArticleLink) return;
    openExternalUrl(safeArticleLink);
  };

  const displayTitle = hasTranslation && !showOriginal ? article.translated_title : article.title;

  return (
    <div className="flex h-full flex-col bg-background text-foreground overflow-hidden">
      {/* Editorial Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-background shrink-0">
        <div className="flex items-center gap-1.5 font-mono flex-wrap">
          {!isStarredMode && (
            <button
              onClick={onToggleRead}
              disabled={!canToggleRead}
              className="flex items-center gap-1 text-[10px] uppercase font-bold border border-border hover:border-foreground/80 px-2 py-1 transition-colors bg-card text-foreground"
            >
              {article.unread ? "[MARK READ]" : "[MARK UNREAD]"}
            </button>
          )}
          <button
            onClick={onToggleStar}
            className="flex items-center gap-1 text-[10px] uppercase font-bold border border-border hover:border-foreground/80 px-2 py-1 transition-colors bg-card text-foreground"
          >
            {starred ? "[UNSTAR]" : "[STAR]"}
          </button>
          <button
            onClick={handleTranslate}
            disabled={isTranslating}
            className="flex items-center gap-1 text-[10px] uppercase font-bold border border-border hover:border-foreground/80 px-2 py-1 transition-colors bg-card text-foreground"
            title={hasTranslation ? (showOriginal ? "Switch to English translation" : "Show original title") : "Translate title to English"}
          >
            {isTranslating ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin text-primary" />
                <span>[TRANSLATING...]</span>
              </>
            ) : hasTranslation ? (
              <>
                <Languages className="w-3 h-3 text-primary" />
                <span>{showOriginal ? "[SHOW TRANSLATED (EN)]" : "[SHOW ORIGINAL]"}</span>
              </>
            ) : (
              <>
                <Languages className="w-3 h-3 text-primary" />
                <span>[TRANSLATE TITLE]</span>
              </>
            )}
          </button>
          {safeArticleLink && (
            <button
              onClick={handleOpenOriginal}
              className="flex items-center gap-1 text-[10px] uppercase font-bold border border-border hover:border-foreground/80 px-2 py-1 transition-colors bg-card text-foreground"
            >
              [OPEN ORIGINAL]
            </button>
          )}
        </div>

        {onClose && (
          <button
            onClick={onClose}
            className="font-mono text-xs text-muted-foreground hover:text-foreground px-2"
          >
            [CLOSE]
          </button>
        )}
      </div>

      {/* Main content scroll area */}
      <ScrollArea className="min-h-0 flex-1">
        <article className="max-w-2xl mx-auto px-6 py-12 lg:py-16">
          {/* Metadata section */}
          <div className="mb-6 font-mono text-[10px] uppercase tracking-wider text-muted-foreground space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-primary font-bold">[ BRIEFING ]</span>
              <span>•</span>
              <span>{readTime} MIN READ</span>
              {hasTranslation && !showOriginal && (
                <>
                  <span>•</span>
                  <span className="text-primary font-semibold">[ GEMINI 2.0 TRANSLATED ]</span>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{formatDate(article.pub_date)}</span>
              <span>•</span>
              <span className="text-foreground font-semibold">{feedName}</span>
              {domain && (
                <>
                  <span>•</span>
                  <a
                    href={safeArticleLink ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline text-primary"
                  >
                    {domain}
                  </a>
                </>
              )}
            </div>
          </div>

          {/* Heading */}
          <div className="mb-8 space-y-3">
            <h1 className="text-3xl lg:text-4xl font-extrabold leading-tight tracking-tight text-foreground font-sans">
              {displayTitle}
            </h1>
            {hasTranslation && !showOriginal && (
              <div className="p-3 bg-muted/40 border border-border/60 rounded font-mono text-xs text-muted-foreground">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-bold uppercase tracking-wider text-[10px] text-foreground/80">[ ORIGINAL HEADLINE ]</span>
                  <button
                    onClick={() => setShowOriginal(true)}
                    className="text-[10px] text-primary hover:underline uppercase font-bold"
                  >
                    View Original
                  </button>
                </div>
                <p className="text-foreground/90">{article.title}</p>
              </div>
            )}
          </div>

          {/* Divider */}
          <hr className="border-border my-8" />

          {/* Article Body */}
          <div
            className="typeset typeset-article font-serif min-w-0"
            dangerouslySetInnerHTML={{
              __html: processArticleContent(
                article.content,
                safeArticleLink ?? undefined,
              ),
            }}
          />
        </article>
      </ScrollArea>

      {/* Footer Navigation */}
      <div className="flex items-center justify-between border-t border-border px-4 py-3 bg-background shrink-0 font-mono text-xs">
        <button
          onClick={goToPrevious}
          disabled={!hasPrevious?.()}
          className="flex items-center gap-1 hover:text-primary disabled:opacity-30 disabled:hover:text-current transition-colors uppercase font-bold text-foreground"
        >
          &lt;&lt; PREV
        </button>
        <button
          onClick={goToNext}
          disabled={!hasNext?.()}
          className="flex items-center gap-1 hover:text-primary disabled:opacity-30 disabled:hover:text-current transition-colors uppercase font-bold text-foreground"
        >
          NEXT &gt;&gt;
        </button>
      </div>
    </div>
  );
}
