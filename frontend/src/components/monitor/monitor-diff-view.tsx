import { useState, useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, formatDate } from "@/lib/utils";
import type { MonitoredPage, PageSnapshot, SectionChange } from "@/lib/api";
import {
  useCheckMonitoredPageNow,
  useMarkMonitoredPageRead,
  useMarkPageSnapshotRead,
  useDeleteMonitoredPage,
  useMonitoredPageSnapshots,
} from "@/queries/monitors";
import {
  ExternalLink,
  RefreshCw,
  Edit3,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Columns2,
  FileText,
  GitCompare,
  SlidersHorizontal,
  History,
} from "lucide-react";

interface MonitorDiffViewProps {
  page: MonitoredPage | null;
  snapshot: PageSnapshot | null;
  onEdit: () => void;
  onClose?: () => void;
}

import DOMPurify from "dompurify";

const purify = typeof window !== "undefined" ? DOMPurify(window) : DOMPurify;

export function safeDiffHtml(html: string): string {
  if (!html) return "";
  return purify.sanitize(html, {
    ALLOWED_TAGS: ["div", "span", "ins", "del", "mark", "p", "br", "b", "strong", "i", "em", "code", "pre"],
    ALLOWED_ATTR: ["class"],
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Generate HTML for the NEW version with additions highlighted in green
function getNewVersionHighlightedHtml(diffHtml?: string, fallbackText?: string): string {
  if (!diffHtml) return fallbackText ? escapeHtml(fallbackText) : "";
  // Remove all <del>...</del> tags and contents (what was removed)
  const withoutDeletions = diffHtml.replace(/<del\b[^>]*>[\s\S]*?<\/del>/gi, "");
  // Format <ins> tags with vibrant green highlight
  const highlighted = withoutDeletions.replace(
    /<ins\b[^>]*>([\s\S]*?)<\/ins>/gi,
    '<mark class="bg-emerald-500/25 dark:bg-emerald-500/35 text-emerald-950 dark:text-emerald-100 border-b-2 border-emerald-500 font-semibold px-1 py-0.5 rounded not-italic">$1</mark>'
  );
  return safeDiffHtml(highlighted);
}

// Generate HTML for the OLD/BEFORE version with deletions highlighted in red
function getOldVersionHighlightedHtml(diffHtml?: string, fallbackText?: string): string {
  if (!diffHtml) return fallbackText ? escapeHtml(fallbackText) : "";
  // Remove all <ins>...</ins> tags and contents (what was added)
  const withoutInsertions = diffHtml.replace(/<ins\b[^>]*>[\s\S]*?<\/ins>/gi, "");
  // Format <del> tags with vibrant red highlight and strikethrough
  const highlighted = withoutInsertions.replace(
    /<del\b[^>]*>([\s\S]*?)<\/del>/gi,
    '<mark class="bg-rose-500/25 dark:bg-rose-500/35 text-rose-950 dark:text-rose-100 border-b-2 border-rose-500 font-semibold px-1 py-0.5 rounded line-through opacity-90 not-italic">$1</mark>'
  );
  return safeDiffHtml(highlighted);
}

export function MonitorDiffView({
  page,
  snapshot,
  onEdit,
  onClose,
}: MonitorDiffViewProps) {
  const [viewMode, setViewMode] = useState<
    "section_changes" | "side_by_side" | "full_diff" | "raw"
  >("section_changes");
  const checkNow = useCheckMonitoredPageNow();
  const markRead = useMarkMonitoredPageRead();
  const markSnapshotRead = useMarkPageSnapshotRead();
  const deletePage = useDeleteMonitoredPage();

  const { data: snapshotList } = useMonitoredPageSnapshots(page?.id ?? 0);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(null);
  const [filterNoise, setFilterNoise] = useState(false);

  // Active snapshot: from history dropdown, or prop snapshot, or latest from query
  const activeSnapshot = useMemo(() => {
    if (selectedSnapshotId !== null && snapshotList) {
      const found = snapshotList.find((s: PageSnapshot) => s.id === selectedSnapshotId);
      if (found) return found;
    }
    return snapshot ?? (snapshotList && snapshotList.length > 0 ? snapshotList[0] : null);
  }, [selectedSnapshotId, snapshotList, snapshot]);

  const rawSections: SectionChange[] = activeSnapshot?.sections || [];

  const sections = useMemo(() => {
    if (!filterNoise) return rawSections;
    return rawSections.filter((s) => {
      const oldClean = (s.old_text || "").trim();
      const newClean = (s.new_text || "").trim();
      const isNoise = (t: string) => /^[0-9:\s./,-]+$/.test(t) || (t.length <= 3 && !/[a-zA-Z]/.test(t));
      if (isNoise(oldClean) && isNoise(newClean)) {
        return false;
      }
      return true;
    });
  }, [rawSections, filterNoise]);

  if (!page) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#FAF9F6] dark:bg-background text-neutral-400 p-8 text-center font-mono">
        <span className="text-xs uppercase tracking-widest font-bold">
          05 / MONITOR READER
        </span>
        <p className="mt-4 text-xs">
          SELECT A WEBPAGE MONITOR TO VIEW VISUAL DIFF & SNAPSHOTS
        </p>
      </div>
    );
  }

  const handleCheckNow = () => {
    checkNow.mutate(page.id);
  };

  const isCurrentUnread = activeSnapshot ? activeSnapshot.unread : page.unread;

  const handleToggleRead = () => {
    if (activeSnapshot) {
      markSnapshotRead.mutate({
        pageId: page.id,
        snapshotId: activeSnapshot.id,
        unread: !activeSnapshot.unread,
      });
    } else {
      markRead.mutate({ id: page.id, unread: !page.unread });
    }
  };

  const handleDelete = () => {
    if (confirm(`Are you sure you want to delete monitor "${page.name}"?`)) {
      deletePage.mutate(page.id);
    }
  };

  const hasError = page.last_status >= 400 || !!page.last_error;

  // Extract inserted text blocks for legacy snapshots lacking structured sections
  const getInsertedBlocks = (diffHtml: string): string[] => {
    if (!diffHtml) return [];
    if (typeof window === "undefined") return [];
    const div = document.createElement("div");
    div.innerHTML = diffHtml;
    const insNodes = div.querySelectorAll("ins");
    const result: string[] = [];
    insNodes.forEach((node) => {
      const text = node.textContent?.trim();
      if (text) {
        result.push(text);
      }
    });
    return result;
  };

  const insertedBlocks = activeSnapshot?.diff_html
    ? getInsertedBlocks(activeSnapshot.diff_html)
    : [];

  return (
    <div className="flex h-full flex-col bg-background text-foreground overflow-hidden">
      {/* Header Actions Line */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-background shrink-0 font-mono text-xs flex-wrap gap-2">
        {/* Left Toggles */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setViewMode("section_changes")}
            className={`flex items-center gap-1 px-2.5 py-1 text-[10px] uppercase font-bold border transition-colors ${
              viewMode === "section_changes"
                ? "bg-emerald-800 dark:bg-emerald-700 text-white border-emerald-900 dark:border-emerald-600 shadow-xs"
                : "border-border hover:border-foreground/80 text-foreground bg-card"
            }`}
          >
            <Layers className="h-3 w-3" />
            [CHANGES BY SECTION]
          </button>

          <button
            onClick={() => setViewMode("side_by_side")}
            className={`flex items-center gap-1 px-2.5 py-1 text-[10px] uppercase font-bold border transition-colors ${
              viewMode === "side_by_side"
                ? "bg-foreground text-background border-foreground shadow-xs"
                : "border-border hover:border-foreground/80 text-foreground bg-card"
            }`}
          >
            <Columns2 className="h-3 w-3" />
            [SIDE BY SIDE]
          </button>

          <button
            onClick={() => setViewMode("full_diff")}
            className={`flex items-center gap-1 px-2.5 py-1 text-[10px] uppercase font-bold border transition-colors ${
              viewMode === "full_diff"
                ? "bg-foreground text-background border-foreground shadow-xs"
                : "border-border hover:border-foreground/80 text-foreground bg-card"
            }`}
          >
            <GitCompare className="h-3 w-3" />
            [FULL DIFF]
          </button>

          <button
            onClick={() => setViewMode("raw")}
            className={`flex items-center gap-1 px-2.5 py-1 text-[10px] uppercase font-bold border transition-colors ${
              viewMode === "raw"
                ? "bg-foreground text-background border-foreground shadow-xs"
                : "border-border hover:border-foreground/80 text-foreground bg-card"
            }`}
          >
            <FileText className="h-3 w-3" />
            [RAW TEXT]
          </button>
        </div>

        {/* Right Action Buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={handleCheckNow}
            disabled={checkNow.isPending}
            className="flex items-center gap-1 text-[10px] uppercase font-bold border border-border hover:border-foreground/80 px-2 py-1 transition-colors disabled:opacity-50 bg-card text-foreground"
          >
            <RefreshCw
              className={`h-3 w-3 ${checkNow.isPending ? "animate-spin" : ""}`}
            />
            [RE-CHECK]
          </button>

          <button
            onClick={handleToggleRead}
            className="flex items-center gap-1 text-[10px] uppercase font-bold border border-border hover:border-foreground/80 px-2 py-1 transition-colors bg-card text-foreground"
          >
            {isCurrentUnread ? "[MARK READ]" : "[MARK UNREAD]"}
          </button>

          <a
            href={page.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] uppercase font-bold border border-border hover:border-foreground/80 px-2 py-1 transition-colors text-foreground hover:text-primary bg-card"
          >
            <ExternalLink className="h-3 w-3" />
            [OPEN PAGE]
          </a>

          <button
            onClick={onEdit}
            className="flex items-center gap-1 text-[10px] uppercase font-bold border border-border hover:border-foreground/80 px-2 py-1 transition-colors bg-card text-foreground"
          >
            <Edit3 className="h-3 w-3" />
            [EDIT]
          </button>

          <button
            onClick={handleDelete}
            className="flex items-center gap-1 text-[10px] uppercase font-bold border border-rose-300 dark:border-rose-900 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 px-2 py-1 transition-colors bg-card"
          >
            <Trash2 className="h-3 w-3" />
            [DELETE]
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="font-mono text-xs text-muted-foreground hover:text-foreground px-2 ml-1"
            >
              [CLOSE]
            </button>
          )}
        </div>
      </div>

      {/* Snapshot History & Noise Filter Sub-Header */}
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-2 bg-muted/20 shrink-0 font-mono text-[11px] flex-wrap gap-2">
        {/* Left: Active Snapshot details & word count badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-foreground">
            SNAPSHOT: {formatDate(activeSnapshot?.created_at ?? page.updated_at)}
          </span>
          {activeSnapshot && (
            <>
              <span className="text-emerald-700 dark:text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/30 text-[10px]">
                +{activeSnapshot.added_count} words
              </span>
              <span className="text-rose-700 dark:text-rose-400 font-bold bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/30 text-[10px]">
                -{activeSnapshot.removed_count} words
              </span>
            </>
          )}
          {page.last_status > 0 && (
            <span className="text-muted-foreground text-[10px]">
              [HTTP {page.last_status}]
            </span>
          )}
        </div>

        {/* Right: History Selector & Noise Filter Toggle */}
        <div className="flex items-center gap-2 flex-wrap">
          {snapshotList && snapshotList.length > 1 && (
            <div className="flex items-center gap-1.5">
              <History className="h-3 w-3 text-muted-foreground shrink-0" />
              <select
                value={activeSnapshot?.id ?? ""}
                onChange={(e) => setSelectedSnapshotId(Number(e.target.value))}
                className="bg-card border border-border text-[10px] font-mono px-2 py-1 rounded-xs text-foreground cursor-pointer"
                title="Select historical snapshot to compare"
              >
                {snapshotList.map((s: PageSnapshot, idx: number) => (
                  <option key={s.id} value={s.id}>
                    {idx === 0 ? "Latest: " : "Snapshot: "} {formatDate(s.created_at)} (+{s.added_count} / -{s.removed_count})
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            onClick={() => setFilterNoise((prev) => !prev)}
            className={cn(
              "flex items-center gap-1 text-[10px] uppercase font-bold border px-2 py-1 transition-colors rounded-xs",
              filterNoise
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border hover:border-foreground/80 text-muted-foreground bg-card hover:text-foreground",
            )}
            title="Filter out trivial single-number and timestamp changes"
          >
            <SlidersHorizontal className="h-2.5 w-2.5" />
            <span>{filterNoise ? "[NOISE FILTER: ON]" : "[NOISE FILTER: OFF]"}</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <ScrollArea className="min-h-0 flex-1">
        <article className="max-w-4xl mx-auto px-6 py-8 lg:py-12">
          {/* Metadata Section */}
          <div className="mb-6 font-mono text-[10px] uppercase tracking-wider text-muted-foreground space-y-1 border-b border-border pb-4">
            <div className="flex items-center gap-2">
              <span className="text-primary font-bold">[ WEBPAGE MONITOR ]</span>
              <span>•</span>
              {hasError ? (
                <span className="text-rose-600 dark:text-rose-400 font-bold flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> ERROR{" "}
                  {page.last_status || "FETCH FAILED"}
                </span>
              ) : (
                <span className="text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> STATUS 200 OK
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                LAST CHECKED:{" "}
                {page.last_checked_at
                  ? formatDate(page.last_checked_at)
                  : "Never"}
              </span>
              <span>•</span>
              <a
                href={page.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline text-primary font-medium truncate max-w-md"
              >
                {page.url}
              </a>
            </div>

            {page.css_selector && (
              <div className="text-muted-foreground">
                CSS SELECTOR:{" "}
                <code className="bg-muted px-1 py-0.5 rounded text-foreground">
                  {page.css_selector}
                </code>
              </div>
            )}
          </div>

          {/* Title */}
          <h1 className="text-2xl lg:text-3xl font-extrabold leading-tight tracking-tight text-foreground mb-6 font-sans">
            {page.name}
          </h1>

          {/* Error Notice if any */}
          {page.last_error && (
            <div className="mb-6 p-3 border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 text-xs font-mono rounded">
              <strong>Fetch Error:</strong> {page.last_error}
            </div>
          )}

          {/* Diff / Snapshot Content */}
          {!activeSnapshot ? (
            <div className="py-12 text-center text-xs font-mono text-muted-foreground">
              No snapshot recorded yet. Click [RE-CHECK] to capture the first version.
            </div>
          ) : viewMode === "section_changes" ? (
            /* Mode 1: Changes Grouped by Semantic Section with Before & After Structure */
            <div className="space-y-6">
              {/* Summary Stats Line */}
              <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border pb-2 mb-4 font-mono flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-foreground uppercase">
                    STRUCTURED CHANGES:
                  </span>
                  <span className="text-emerald-700 dark:text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                    +{activeSnapshot.added_count} words added
                  </span>
                  <span className="text-rose-700 dark:text-rose-400 font-bold bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/30">
                    -{activeSnapshot.removed_count} words removed
                  </span>
                </div>
                {sections.length > 0 ? (
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {sections.length} {sections.length === 1 ? "section" : "sections"} modified
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground font-mono">
                    Snapshot captured {formatDate(activeSnapshot.created_at)}
                  </span>
                )}
              </div>

              {sections.length > 0 ? (
                <div className="space-y-6">
                  {sections.map((sec, idx) => (
                    <div
                      key={idx}
                      className="border border-border bg-card rounded-lg shadow-xs overflow-hidden"
                    >
                      {/* Section Title Header */}
                      <div className="bg-muted/70 px-4 py-2.5 border-b border-border flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-[10px] uppercase font-extrabold text-muted-foreground shrink-0">
                            SECTION #{idx + 1}:
                          </span>
                          <span className="font-sans font-bold text-foreground text-sm truncate">
                            {sec.section_title || "General Content"}
                          </span>
                        </div>

                        <span
                          className={`text-[10px] font-mono font-bold uppercase px-2.5 py-0.5 rounded border shrink-0 ${
                            sec.change_type === "added"
                              ? "bg-emerald-100 dark:bg-emerald-950/70 text-emerald-900 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800"
                              : sec.change_type === "removed"
                                ? "bg-rose-100 dark:bg-rose-950/70 text-rose-900 dark:text-rose-300 border-rose-300 dark:border-rose-800"
                                : "bg-amber-100 dark:bg-amber-950/70 text-amber-900 dark:text-amber-300 border-amber-300 dark:border-amber-800"
                          }`}
                        >
                          {sec.change_type === "added"
                            ? "+ NEW SECTION"
                            : sec.change_type === "removed"
                              ? "- REMOVED SECTION"
                              : "MODIFIED"}
                        </span>
                      </div>

                      {/* Section Content: What Changed & What Was Before */}
                      <div className="p-4 space-y-3 font-sans text-sm">
                        {sec.change_type === "modified" ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                            {/* Left Column: What Was Before */}
                            <div className="p-3.5 bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 rounded-md text-xs space-y-1.5 flex flex-col">
                              <div className="font-mono text-[10px] text-rose-800 dark:text-rose-400 font-bold uppercase flex items-center justify-between pb-1 border-b border-rose-200/60 dark:border-rose-900/40">
                                <span>🔴 WHAT WAS BEFORE (PREVIOUS / REPLACED):</span>
                                <span className="text-[9px] opacity-75 font-normal">BEFORE</span>
                              </div>
                              <div
                                className="text-rose-950 dark:text-rose-200 font-normal whitespace-pre-wrap leading-relaxed flex-1"
                                dangerouslySetInnerHTML={{
                                  __html: getOldVersionHighlightedHtml(sec.diff_html, sec.old_text),
                                }}
                              />
                            </div>

                            {/* Right Column: What It Was Changed To */}
                            <div className="p-3.5 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800/80 rounded-md text-xs space-y-1.5 flex flex-col">
                              <div className="font-mono text-[10px] text-emerald-800 dark:text-emerald-400 font-bold uppercase flex items-center justify-between pb-1 border-b border-emerald-300/60 dark:border-emerald-800/40">
                                <span>🟢 WHAT IT WAS CHANGED TO (CURRENT / NEW):</span>
                                <span className="text-[9px] opacity-75 font-normal">AFTER</span>
                              </div>
                              <div
                                className="text-emerald-950 dark:text-emerald-200 font-medium whitespace-pre-wrap leading-relaxed flex-1"
                                dangerouslySetInnerHTML={{
                                  __html: getNewVersionHighlightedHtml(sec.diff_html, sec.new_text),
                                }}
                              />
                            </div>
                          </div>
                        ) : sec.change_type === "added" ? (
                          <div className="p-3.5 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800/80 rounded-md text-xs space-y-1.5">
                            <div className="font-mono text-[10px] text-emerald-800 dark:text-emerald-400 font-bold uppercase pb-1 border-b border-emerald-300/60 dark:border-emerald-800/40">
                              🟢 NEW CONTENT (ADDED):
                            </div>
                            <div
                              className="whitespace-pre-wrap text-emerald-950 dark:text-emerald-200 font-medium leading-relaxed"
                              dangerouslySetInnerHTML={{
                                __html: getNewVersionHighlightedHtml(sec.diff_html, sec.new_text),
                              }}
                            />
                          </div>
                        ) : (
                          <div className="p-3.5 bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 rounded-md text-xs space-y-1.5">
                            <div className="font-mono text-[10px] text-rose-800 dark:text-rose-400 font-bold uppercase pb-1 border-b border-rose-200/60 dark:border-rose-900/40">
                              🔴 PREVIOUS CONTENT (REMOVED):
                            </div>
                            <div
                              className="whitespace-pre-wrap text-rose-950 dark:text-rose-200 font-normal leading-relaxed"
                              dangerouslySetInnerHTML={{
                                __html: getOldVersionHighlightedHtml(sec.diff_html, sec.old_text),
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : activeSnapshot.has_change && (activeSnapshot.prev_content_text || activeSnapshot.diff_html) ? (
                /* Structured change fallback for unstructured page snapshots */
                <div className="border border-border bg-card rounded-lg shadow-xs overflow-hidden">
                  <div className="bg-muted/70 px-4 py-2.5 border-b border-border flex items-center justify-between gap-2">
                    <span className="font-sans font-bold text-foreground text-sm">
                      Full Content Modification
                    </span>
                    <span className="text-[10px] font-mono font-bold uppercase px-2.5 py-0.5 rounded border bg-amber-100 dark:bg-amber-950/70 text-amber-900 dark:text-amber-300 border-amber-300 dark:border-amber-800">
                      MODIFIED
                    </span>
                  </div>
                  <div className="p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      {/* Left: What Was Before */}
                      <div className="p-3.5 bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 rounded-md text-xs space-y-1.5 flex flex-col">
                        <div className="font-mono text-[10px] text-rose-800 dark:text-rose-400 font-bold uppercase flex items-center justify-between pb-1 border-b border-rose-200/60 dark:border-rose-900/40">
                          <span>🔴 WHAT WAS BEFORE (PREVIOUS VERSION):</span>
                          <span className="text-[9px] opacity-75 font-normal">BEFORE</span>
                        </div>
                        <div
                          className="text-rose-950 dark:text-rose-200 font-normal whitespace-pre-wrap leading-relaxed flex-1 font-mono"
                          dangerouslySetInnerHTML={{
                            __html: getOldVersionHighlightedHtml(
                              activeSnapshot.diff_html,
                              activeSnapshot.prev_content_text || "",
                            ),
                          }}
                        />
                      </div>

                      {/* Right: What It Was Changed To */}
                      <div className="p-3.5 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800/80 rounded-md text-xs space-y-1.5 flex flex-col">
                        <div className="font-mono text-[10px] text-emerald-800 dark:text-emerald-400 font-bold uppercase flex items-center justify-between pb-1 border-b border-emerald-300/60 dark:border-emerald-800/40">
                          <span>🟢 WHAT IT WAS CHANGED TO (NEW VERSION):</span>
                          <span className="text-[9px] opacity-75 font-normal">AFTER</span>
                        </div>
                        <div
                          className="text-emerald-950 dark:text-emerald-200 font-medium whitespace-pre-wrap leading-relaxed flex-1 font-mono"
                          dangerouslySetInnerHTML={{
                            __html: getNewVersionHighlightedHtml(
                              activeSnapshot.diff_html,
                              activeSnapshot.content_text || "",
                            ),
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ) : insertedBlocks.length > 0 ? (
                /* Fallback for legacy snapshots with insertedBlocks */
                <div className="space-y-3">
                  {insertedBlocks.map((block, idx) => (
                    <div
                      key={idx}
                      className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border-l-4 border-emerald-500 text-emerald-950 dark:text-emerald-200 font-sans text-sm rounded shadow-xs leading-relaxed"
                    >
                      <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-400 font-bold uppercase tracking-wider block mb-1">
                        🟢 NEW CONTENT #{idx + 1}
                      </span>
                      <p className="whitespace-pre-wrap font-medium">{block}</p>
                    </div>
                  ))}
                </div>
              ) : (
                /* Baseline initial capture */
                <div className="space-y-4">
                  <div className="bg-muted/40 p-3 border border-border rounded text-muted-foreground text-xs font-mono text-center">
                    BASELINE SNAPSHOT (INITIAL CAPTURE)
                  </div>
                  {activeSnapshot.content_text && (
                    <div className="border border-border rounded-lg bg-card p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed">
                      {activeSnapshot.content_text}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : viewMode === "side_by_side" ? (
            /* Mode 2: User Story 2 Side-by-Side: Left (New in green) vs Right (Before in red) */
            <div className="space-y-4 font-mono text-sm leading-relaxed">
              {/* Header Stats & Legend */}
              <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border pb-2 mb-4 flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <span className="font-bold uppercase text-foreground">
                    SIDE-BY-SIDE COMPARISON:
                  </span>
                  <span className="text-emerald-700 dark:text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                    +{activeSnapshot.added_count} words
                  </span>
                  <span className="text-rose-700 dark:text-rose-400 font-bold bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/30">
                    -{activeSnapshot.removed_count} words
                  </span>
                </div>
                <div className="text-[11px] flex items-center gap-3 font-mono">
                  <span className="text-emerald-700 dark:text-emerald-400 flex items-center gap-1 font-semibold">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> Left: New (Green)
                  </span>
                  <span className="text-rose-700 dark:text-rose-400 flex items-center gap-1 font-semibold">
                    <span className="h-2 w-2 rounded-full bg-rose-500" /> Right: Before (Red)
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* LEFT COLUMN: NEW / CURRENT VERSION HIGHLIGHTED IN GREEN */}
                <div className="border border-border rounded-lg bg-card overflow-hidden flex flex-col shadow-xs">
                  <div className="bg-emerald-50 dark:bg-emerald-950/50 px-3.5 py-2.5 border-b border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200 font-mono text-xs font-bold flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span>🟢 CURRENT SNAPSHOT (NEW)</span>
                    </div>
                    <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 px-2 py-0.5 rounded font-mono font-medium">
                      LATEST ({formatDate(activeSnapshot.created_at)})
                    </span>
                  </div>
                  <div className="bg-emerald-500/10 px-3.5 py-1.5 border-b border-emerald-500/20 text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
                    <span className="font-bold">Highlight:</span> New additions shown in green
                  </div>
                  <div
                    className="p-4 text-xs font-mono text-foreground whitespace-pre-wrap leading-relaxed max-h-[650px] overflow-y-auto flex-1"
                    dangerouslySetInnerHTML={{
                      __html: getNewVersionHighlightedHtml(
                        activeSnapshot.diff_html,
                        activeSnapshot.content_text,
                      ),
                    }}
                  />
                </div>

                {/* RIGHT COLUMN: PREVIOUS / BEFORE VERSION HIGHLIGHTED IN RED */}
                <div className="border border-border rounded-lg bg-card overflow-hidden flex flex-col shadow-xs">
                  <div className="bg-rose-50/90 dark:bg-rose-950/50 px-3.5 py-2.5 border-b border-rose-200 dark:border-rose-900 text-rose-900 dark:text-rose-200 font-mono text-xs font-bold flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-rose-500" />
                      <span>🔴 PREVIOUS SNAPSHOT (BEFORE)</span>
                    </div>
                    <span className="text-[10px] bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-300 px-2 py-0.5 rounded font-mono font-medium">
                      BASELINE
                    </span>
                  </div>
                  <div className="bg-rose-500/10 px-3.5 py-1.5 border-b border-rose-500/20 text-[11px] font-mono text-rose-700 dark:text-rose-400">
                    <span className="font-bold">Highlight:</span> Replaced / removed content shown in red strikethrough
                  </div>
                  <div
                    className="p-4 text-xs font-mono text-foreground whitespace-pre-wrap leading-relaxed max-h-[650px] overflow-y-auto flex-1"
                    dangerouslySetInnerHTML={{
                      __html: activeSnapshot.prev_content_text
                        ? getOldVersionHighlightedHtml(
                            activeSnapshot.diff_html,
                            activeSnapshot.prev_content_text,
                          )
                        : '<span class="text-muted-foreground italic">(Initial baseline snapshot - no previous version)</span>',
                    }}
                  />
                </div>
              </div>
            </div>
          ) : viewMode === "full_diff" ? (
            /* Mode 3: Unified Full Diff */
            <div className="space-y-4 font-mono text-sm leading-relaxed">
              <div className="flex items-center gap-4 text-xs text-muted-foreground border-b border-border pb-2 mb-4">
                <span>FULL PAGE DIFFERENCES ({formatDate(activeSnapshot.created_at)}):</span>
                <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                  +{activeSnapshot.added_count} words
                </span>
                <span className="text-rose-700 dark:text-rose-400 font-bold">
                  -{activeSnapshot.removed_count} words
                </span>
              </div>

              {activeSnapshot.diff_html ? (
                <div
                  className="diff-container bg-card p-6 border border-border rounded text-foreground whitespace-pre-wrap font-sans text-sm leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: safeDiffHtml(activeSnapshot.diff_html) }}
                />
              ) : (
                <div className="bg-card p-6 border border-border rounded text-foreground whitespace-pre-wrap font-sans text-sm">
                  {activeSnapshot.content_text}
                </div>
              )}
            </div>
          ) : (
            /* Mode 4: Raw Text */
            <div className="bg-card p-6 border border-border rounded text-foreground whitespace-pre-wrap font-mono text-xs leading-relaxed">
              {activeSnapshot.content_text}
            </div>
          )}
        </article>
      </ScrollArea>
    </div>
  );
}

