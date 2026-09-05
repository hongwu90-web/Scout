import { useNavigate, useLocation } from "@tanstack/react-router";
import { FeedList } from "@/components/feed/feed-list";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store";

export function Sidebar() {
  const { t } = useI18n();
  const { setSearchOpen, setSettingsOpen } = useUIStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isFeedsPage = pathname === "/feeds";
  const isMonitorsPage = pathname.startsWith("/monitors");

  return (
    <aside className="font-mono tracking-tight flex h-full w-full flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      {/* Header */}
      <div className="flex h-16 shrink-0 items-center border-b border-sidebar-border px-4">
        <span className="text-sm font-bold tracking-widest uppercase">SCOUT</span>
      </div>

      {/* Search button */}
      <div className="px-3 pt-3">
        <button
          className="flex w-full items-center justify-between border border-sidebar-border bg-transparent px-3 py-1.5 text-neutral-500 dark:text-neutral-400 hover:text-sidebar-foreground transition-colors"
          onClick={() => setSearchOpen(true)}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase font-semibold">{t("sidebar.search")}</span>
          </div>
          <kbd className="px-1.5 py-0.5 font-mono text-[10px] text-neutral-400 dark:text-neutral-500">
            CMD+K
          </kbd>
        </button>
      </div>

      {/* Feed list */}
      <FeedList />

      {/* Footer */}
      <div className="p-3 border-t border-sidebar-border space-y-1">
        <button
          className={cn(
            "flex w-full items-center justify-between px-2 py-1.5 text-xs uppercase font-semibold transition-colors",
            isMonitorsPage
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-neutral-500 dark:text-neutral-400 hover:text-sidebar-foreground",
          )}
          onClick={() => navigate({ to: "/monitors" })}
        >
          <div className="flex items-center gap-2">
            <span>WEBPAGE MONITORS</span>
          </div>
          <span className="text-[10px]">→</span>
        </button>
        <button
          className={cn(
            "flex w-full items-center justify-between px-2 py-1.5 text-xs uppercase font-semibold transition-colors",
            isFeedsPage
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-neutral-500 dark:text-neutral-400 hover:text-sidebar-foreground",
          )}
          onClick={() => navigate({ to: "/feeds" })}
        >
          <span>{t("sidebar.manageFeeds")}</span>
          <span className="text-[10px]">→</span>
        </button>
        <button
          className="flex w-full items-center justify-between px-2 py-1.5 text-xs uppercase font-semibold text-neutral-500 dark:text-neutral-400 hover:text-sidebar-foreground transition-colors"
          onClick={() => setSettingsOpen(true)}
        >
          <span>{t("sidebar.settings")}</span>
          <span className="text-[10px]">⚙</span>
        </button>
      </div>
    </aside>
  );
}
