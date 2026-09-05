import { useState, useEffect, useCallback } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Bug, Copy, Download, Info, Keyboard, Palette, User } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  articlePageSizeOptions,
  supportedLocales,
  usePreferencesStore,
  useUIStore,
} from "@/store";
import { usePWAInstall } from "@/hooks/use-pwa-install";
import { localeLabels, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { sessionAPI } from "@/lib/api";
import { Input } from "@/components/ui/input";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

type SettingsTab = "appearance" | "about" | "account";

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors sm:w-full sm:gap-2.5 sm:px-2",
        active
          ? "bg-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      {icon}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

function AppearanceContent() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const setShortcutsOpen = useUIStore((s) => s.setShortcutsOpen);
  const { locale, articlePageSize, setLocale, setArticlePageSize } =
    usePreferencesStore();

  return (
    <div className="space-y-5">
      {/* Language */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("settings.language.label")}</p>
          <p className="text-[13px] text-muted-foreground">
            {t("settings.language.description")}
          </p>
        </div>
        <Select value={locale} onValueChange={(v) => { if (v) setLocale(v); }}>
          <SelectTrigger className="w-auto gap-2 border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {supportedLocales.map((localeCode) => (
              <SelectItem key={localeCode} value={localeCode}>
                {localeLabels[localeCode] ?? localeCode}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Articles per load */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {t("settings.articlePageSize.label")}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {t("settings.articlePageSize.description")}
          </p>
        </div>
        <Select
          value={articlePageSize.toString()}
          onValueChange={(value) => {
            if (!value) return;
            const parsed = Number.parseInt(value, 10);
            if (!Number.isNaN(parsed)) {
              setArticlePageSize(parsed);
            }
          }}
        >
          <SelectTrigger className="w-auto gap-2 border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {articlePageSizeOptions.map((size) => (
              <SelectItem key={size} value={size.toString()}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Theme */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("settings.theme.label")}</p>
          <p className="text-[13px] text-muted-foreground">
            {t("settings.theme.description")}
          </p>
        </div>
        <Select value={theme} onValueChange={(v) => { if (v) setTheme(v); }}>
          <SelectTrigger className="w-auto gap-2 border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="light">{t("settings.theme.light")}</SelectItem>
            <SelectItem value="dark">{t("settings.theme.dark")}</SelectItem>
            <SelectItem value="system">{t("settings.theme.system")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Keyboard shortcuts */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("settings.shortcuts.label")}</p>
          <p className="text-[13px] text-muted-foreground">
            {t("settings.shortcuts.description")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setSettingsOpen(false);
            setShortcutsOpen(true);
          }}
        >
          <Keyboard className="h-4 w-4" />
          {t("settings.shortcuts.open")}
        </Button>
      </div>
    </div>
  );
}

function AccountContent() {
  const { t } = useI18n();

  // Current user state
  const [username, setUsername] = useState("");
  const [feverKey, setFeverKey] = useState("");

  // Username form state
  const [newUsername, setNewUsername] = useState("");
  const [usernameSaving, setUsernameSaving] = useState(false);

  // Load current user on mount
  const loadUser = useCallback(async () => {
    try {
      const res = await sessionAPI.getMe();
      if (!res.data) return;
      setUsername(res.data.username);
      setNewUsername(res.data.username);
      setFeverKey(res.data.fever_api_key ?? "");
    } catch {
      // silently fail – user will see empty fields
    }
  }, []);

  useEffect(() => { void loadUser(); }, [loadUser]);

  const handleUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newUsername.trim();
    if (!trimmed) {
      toast.error(t("settings.account.usernameEmpty"));
      return;
    }
    setUsernameSaving(true);
    try {
      await sessionAPI.updateUsername({ username: trimmed });
      setUsername(trimmed);
      toast.success(t("settings.account.usernameSaved"));
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? "";
      if (msg.includes("already taken")) {
        toast.error(t("settings.account.usernameTaken"));
      } else {
        toast.error(msg || "Failed to update username");
      }
    } finally {
      setUsernameSaving(false);
    }
  };

  const copyFeverKey = async () => {
    if (!feverKey) return;
    await navigator.clipboard.writeText(feverKey);
    toast.success(t("settings.account.feverKeyCopied"));
  };

  return (
    <div className="space-y-7">
      {/* Username */}
      <form onSubmit={(e) => { void handleUsernameSubmit(e); }} className="space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("settings.account.username")}</p>
          <p className="text-[13px] text-muted-foreground">
            {t("settings.account.usernameDescription")}
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            id="account-username"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder={username}
            className="max-w-xs"
          />
          <Button type="submit" size="sm" disabled={usernameSaving || newUsername.trim() === username}>
            {usernameSaving ? t("settings.account.saving") : t("settings.account.save")}
          </Button>
        </div>
      </form>

      <div className="border-t border-border" />

      {/* Fever API Key */}
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("settings.account.feverKey")}</p>
          <p className="text-[13px] text-muted-foreground">
            {t("settings.account.feverKeyDescription")}
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            id="account-fever-key"
            value={feverKey || t("settings.account.feverKeyNone")}
            readOnly
            className="max-w-xs font-mono text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { void copyFeverKey(); }}
            disabled={!feverKey}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function AboutContent() {
  const { t } = useI18n();
  const { isInstallAvailable, promptInstall } = usePWAInstall();
  const [isInstalling, setIsInstalling] = useState(false);

  const handleInstall = async () => {
    setIsInstalling(true);
    try {
      const isInstalled = await promptInstall();
      if (!isInstalled) {
        toast.info(t("settings.installCancelled"));
      }
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 pb-8">
      <img
        src="/icon-96.png"
        alt={t("common.fusionLogo")}
        width={64}
        height={64}
        className="h-16 w-16 rounded-2xl"
      />
      <div className="text-center">
        <h3 className="text-xl font-semibold">Fusion</h3>
        <p className="mt-1 text-xs text-muted-foreground">{__APP_VERSION__}</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t("settings.about.description")}
        </p>
      </div>
      <div className="flex gap-2">
        {isInstallAvailable && (
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              void handleInstall();
            }}
            disabled={isInstalling}
          >
            <Download className="h-4 w-4" />
            {isInstalling
              ? t("settings.about.installing")
              : t("settings.about.install")}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          render={
            <a
              href="https://github.com/0x2e/fusion"
              target="_blank"
              rel="noopener noreferrer"
            />
          }
        >
          <GithubIcon className="h-4 w-4" />
          {t("settings.about.github")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          render={
            <a
              href="https://github.com/0x2e/fusion/issues"
              target="_blank"
              rel="noopener noreferrer"
            />
          }
        >
          <Bug className="h-4 w-4" />
          {t("settings.about.reportIssue")}
        </Button>
      </div>
      <p className="mt-auto text-xs text-muted-foreground">
        {t("settings.about.license")}
      </p>
    </div>
  );
}

export function SettingsDialog() {
  const { t } = useI18n();
  const { isSettingsOpen, setSettingsOpen } = useUIStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");

  const tabTitles: Record<SettingsTab, string> = {
    account: t("settings.tab.account"),
    appearance: t("settings.tab.appearance"),
    about: t("settings.tab.about"),
  };

  return (
    <Dialog open={isSettingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:flex-row h-auto sm:h-[560px] sm:max-w-4xl gap-0 overflow-hidden p-0">
        {/* Sidebar (desktop) / Tab bar (mobile) */}
        <div className="flex shrink-0 flex-row border-b border-border bg-muted/30 px-3 pt-3 sm:w-[200px] sm:flex-col sm:border-b-0 sm:border-r sm:pt-4">
          <h2 className="hidden px-2 text-sm font-semibold sm:block">
            {t("common.settings")}
          </h2>
          <nav className="flex gap-0.5 sm:mt-2 sm:flex-col">
            <NavItem
              icon={<User className="h-4 w-4" />}
              label={t("settings.tab.account")}
              active={activeTab === "account"}
              onClick={() => setActiveTab("account")}
            />
            <NavItem
              icon={<Palette className="h-4 w-4" />}
              label={t("settings.tab.appearance")}
              active={activeTab === "appearance"}
              onClick={() => setActiveTab("appearance")}
            />
            <NavItem
              icon={<Info className="h-4 w-4" />}
              label={t("settings.tab.about")}
              active={activeTab === "about"}
              onClick={() => setActiveTab("about")}
            />
          </nav>
        </div>

        {/* Content */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-5 sm:p-6">
          <h2 className="mb-4 shrink-0 text-lg font-semibold sm:mb-6">
            {tabTitles[activeTab]}
          </h2>

          <div className="flex-1 overflow-y-auto">
            {activeTab === "account" && <AccountContent />}
            {activeTab === "appearance" && <AppearanceContent />}
            {activeTab === "about" && <AboutContent />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
