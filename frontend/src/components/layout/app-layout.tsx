import { useEffect, useState, useRef } from "react";
import { useLocation } from "@tanstack/react-router";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Sidebar } from "./sidebar";
import { ArticleDrawer } from "@/components/article/article-drawer";
import { SearchDialog } from "@/components/search/search-dialog";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { AddGroupDialog } from "@/components/group/add-group-dialog";
import { AddFeedDialog } from "@/components/feed/add-feed-dialog";
import { EditFeedDialog } from "@/components/feed/edit-feed-dialog";
import { ImportOpmlDialog } from "@/components/feed/import-opml-dialog";
import { ShortcutsDialog } from "@/components/layout/shortcuts-dialog";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard";
import { useI18n } from "@/lib/i18n";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUIStore } from "@/store/ui";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

  // Custom resizing logic
  const [sidebarWidth, setSidebarWidth] = useState(256); // default to 256px
  const isResizing = useRef(false);

  const startResizing = (mouseDownEvent: React.MouseEvent) => {
    isResizing.current = true;
    mouseDownEvent.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      // Constraints: sidebar min width 180px, max width 1/3 of the screen width
      const maxWidth = window.innerWidth / 3;
      const newWidth = Math.max(180, Math.min(maxWidth, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // Register global keyboard shortcuts
  useKeyboardShortcuts();

  // Close mobile sidebar on navigation
  const location = useLocation();
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname, location.searchStr, setSidebarOpen]);

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* Desktop sidebar */}
      {!isMobile && (
        <div style={{ width: sidebarWidth }} className="flex-none h-full relative group/sidebar">
          <Sidebar />
          {/* Resize Handle */}
          <div
            onMouseDown={startResizing}
            className="absolute top-0 right-0 w-[4px] h-full cursor-col-resize hover:bg-neutral-400 active:bg-neutral-500 transition-colors z-50"
          />
        </div>
      )}

      {/* Mobile sidebar */}
      {isMobile && (
        <Sheet open={isSidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent
            side="left"
            className="w-[260px] p-0"
            showCloseButton={false}
          >
            <SheetTitle className="sr-only">{t("common.navigation")}</SheetTitle>
            <Sidebar />
          </SheetContent>
        </Sheet>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-hidden">{children}</main>

      {/* Modals and drawers */}
      <ArticleDrawer />
      <SearchDialog />
      <SettingsDialog />
      <AddGroupDialog />
      <AddFeedDialog />
      <EditFeedDialog />
      <ImportOpmlDialog />
      <ShortcutsDialog />
    </div>
  );
}
