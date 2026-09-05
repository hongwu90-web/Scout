import { useState } from "react";
import { cn } from "@/lib/utils";

interface FeedFaviconProps {
  src?: string | null;
  title?: string;
  className?: string;
}

// Module-level caches: prevent duplicate network requests and duplicate failures across all cards
const failedFaviconCache = new Set<string>();
const loadedFaviconCache = new Set<string>();

export function FeedFavicon({ src, title, className }: FeedFaviconProps) {
  const isKnownFailed = Boolean(src && failedFaviconCache.has(src));
  const isKnownLoaded = Boolean(src && loadedFaviconCache.has(src));

  const [hasLoaded, setHasLoaded] = useState(isKnownLoaded);
  const [hasFailed, setHasFailed] = useState(isKnownFailed || !src);

  // Clean initial letter for instant zero-latency monogram
  const cleanTitle = (title ?? "").replace(/^[\[\s]+/, "");
  const letter = cleanTitle.length > 0 ? cleanTitle[0].toUpperCase() : "•";

  if (!src || hasFailed || isKnownFailed) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex items-center justify-center shrink-0 rounded bg-muted/60 text-[8px] font-mono font-bold text-muted-foreground/70 select-none border border-border/40",
          className,
        )}
      >
        {letter}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-center shrink-0 overflow-hidden rounded",
        className,
      )}
    >
      {/* Instant monogram placeholder while image streams in background */}
      {!hasLoaded && !isKnownLoaded && (
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center bg-muted/60 text-[8px] font-mono font-bold text-muted-foreground/70 select-none border border-border/40"
        >
          {letter}
        </span>
      )}
      <img
        src={src}
        alt=""
        width={16}
        height={16}
        className={cn(
          "h-full w-full object-contain shrink-0 transition-opacity duration-150",
          hasLoaded || isKnownLoaded ? "opacity-100" : "opacity-0",
        )}
        loading="lazy"
        decoding="async"
        // @ts-expect-error fetchPriority is a modern standard attribute
        fetchpriority="low"
        onLoad={() => {
          loadedFaviconCache.add(src);
          setHasLoaded(true);
        }}
        onError={() => {
          failedFaviconCache.add(src);
          setHasFailed(true);
        }}
      />
    </span>
  );
}
