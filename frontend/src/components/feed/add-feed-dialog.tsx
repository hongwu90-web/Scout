import { useState } from "react";
import {
  ChevronDown,
  Plus,
  Radar,
  X,
  Newspaper,
  Rss,
  Search,
  Wand2,
  Users,
  Globe,
  Loader2,
  Check,
  Copy,
  HelpCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useUIStore } from "@/store";
import { useGroups } from "@/queries/groups";
import { useCreateFeed } from "@/queries/feeds";
import {
  feedAPI,
  type CreateFeedRequest,
  type DiscoveredFeed,
  type OnlineFeedResult,
  type BuildFeedPreviewResponse,
} from "@/lib/api";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const GOOGLE_NEWS_LOCALES = [
  { id: "us-en", label: "United States (English)", hl: "en-US", gl: "US", ceid: "US:en" },
  { id: "gb-en", label: "United Kingdom (English)", hl: "en-GB", gl: "GB", ceid: "GB:en" },
  { id: "cn-zh", label: "China (简体中文)", hl: "zh-CN", gl: "CN", ceid: "CN:zh-Hans" },
  { id: "tw-zh", label: "Taiwan (繁體中文)", hl: "zh-TW", gl: "TW", ceid: "TW:zh-Hant" },
  { id: "hk-zh", label: "Hong Kong (繁體中文)", hl: "zh-HK", gl: "HK", ceid: "HK:zh-Hant" },
  { id: "jp-ja", label: "Japan (日本語)", hl: "ja", gl: "JP", ceid: "JP:ja" },
  { id: "it-it", label: "Italy (Italiano)", hl: "it", gl: "IT", ceid: "IT:it" },
  { id: "de-de", label: "Germany (Deutsch)", hl: "de", gl: "DE", ceid: "DE:de" },
  { id: "fr-fr", label: "France (Français)", hl: "fr", gl: "FR", ceid: "FR:fr" },
  { id: "es-es", label: "Spain (Español)", hl: "es", gl: "ES", ceid: "ES:es" },
  { id: "global-en", label: "International (English)", hl: "en-US", gl: "US", ceid: "US:en" },
];

export function AddFeedDialog() {
  const { t } = useI18n();
  const { isAddFeedOpen, setAddFeedOpen } = useUIStore();
  const { data: groups = [] } = useGroups();
  const createFeed = useCreateFeed();

  const [mode, setMode] = useState<"rss" | "search" | "gnews">("rss");

  // RSS & Scout State
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");

  // Feed Builder State (when site has no RSS)
  const [showBuilder, setShowBuilder] = useState(false);
  const [builderSelector, setBuilderSelector] = useState("");
  const [isBuilding, setIsBuilding] = useState(false);
  const [builtPreview, setBuiltPreview] = useState<BuildFeedPreviewResponse | null>(null);

  // Online Search State
  const [onlineQuery, setOnlineQuery] = useState("");
  const [isSearchingOnline, setIsSearchingOnline] = useState(false);
  const [onlineResults, setOnlineResults] = useState<OnlineFeedResult[]>([]);
  const [hasSearchedOnline, setHasSearchedOnline] = useState(false);

  // Google News State
  const [gnewsQuery, setGnewsQuery] = useState("");
  const [gnewsLocale, setGnewsLocale] = useState("us-en");
  const [gnewsName, setGnewsName] = useState("");

  // Common State
  const [groupId, setGroupId] = useState<string>("");
  const [proxy, setProxy] = useState("");
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [detectedFeeds, setDetectedFeeds] = useState<DiscoveredFeed[]>([]);
  const [isFeedSelectOpen, setIsFeedSelectOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  const resetForm = () => {
    setUrl("");
    setName("");
    setShowBuilder(false);
    setBuilderSelector("");
    setBuiltPreview(null);
    setOnlineQuery("");
    setOnlineResults([]);
    setHasSearchedOnline(false);
    setGnewsQuery("");
    setGnewsLocale("us-en");
    setGnewsName("");
    setGroupId("");
    setProxy("");
    setIsAdvancedOpen(false);
    setDetectedFeeds([]);
    setIsFeedSelectOpen(false);
    setIsHelpOpen(false);
    setMode("rss");
  };

  const handleClose = () => {
    setAddFeedOpen(false);
    resetForm();
  };

  const handleSelectDetectedFeed = (feed: DiscoveredFeed) => {
    setUrl(feed.link);
    setName((prev) => {
      if (prev.trim() || !feed.title.trim()) {
        return prev;
      }
      return feed.title.trim();
    });
    setIsFeedSelectOpen(false);
    setDetectedFeeds([]);
    setShowBuilder(false);
    toast.success(t("feed.toast.detected"));
  };

  const extractRealUrl = (raw: string): string => {
    const trimmed = raw.trim();
    if (trimmed.includes("/api/feeds/synthetic") && trimmed.includes("url=")) {
      try {
        const parsed = new URL(trimmed, window.location.origin);
        const u = parsed.searchParams.get("url");
        if (u) return u;
      } catch {
        // fallback
      }
    }
    return trimmed;
  };

  const handleBuildFeedAuto = async (targetUrl: string) => {
    const cleanUrl = extractRealUrl(targetUrl);
    if (!cleanUrl) return;

    setIsBuilding(true);
    try {
      const response = await feedAPI.previewBuild({
        url: cleanUrl,
      });
      const data = response.data;
      if (data) {
        setBuiltPreview(data);
        if (data.selector_used) {
          setBuilderSelector(data.selector_used);
        }
        if (!name.trim()) {
          setName(`${data.page_title} (Scout Feed)`);
        }
      }
    } catch {
      // Ignored for auto preview
    } finally {
      setIsBuilding(false);
    }
  };

  const handleValidate = async () => {
    const cleanUrl = extractRealUrl(url);
    if (!cleanUrl) return;
    if (cleanUrl !== url) {
      setUrl(cleanUrl);
    }

    setIsValidating(true);
    setShowBuilder(false);
    setBuiltPreview(null);

    try {
      const response = await feedAPI.validate({ url: cleanUrl });
      const feeds = response.data?.feeds ?? [];

      if (feeds.length === 0) {
        setShowBuilder(true);
        toast.info("No standard RSS feed found. You can build a custom feed for this site below.");
        void handleBuildFeedAuto(cleanUrl);
        return;
      }

      if (feeds.length === 1) {
        handleSelectDetectedFeed(feeds[0]);
        return;
      }

      setDetectedFeeds(feeds);
      setIsFeedSelectOpen(true);
    } catch {
      setShowBuilder(true);
      toast.error(t("feed.toast.detectFailed"));
    } finally {
      setIsValidating(false);
    }
  };

  const handleBuildFeed = async (overrideSelector?: string) => {
    let cleanUrl = extractRealUrl(url);
    if (!cleanUrl) return;
    if (cleanUrl !== url) {
      setUrl(cleanUrl);
    }

    const selToUse = overrideSelector !== undefined ? overrideSelector : builderSelector;
    setIsBuilding(true);
    try {
      const response = await feedAPI.previewBuild({
        url: cleanUrl,
        selector: selToUse.trim() || undefined,
      });
      const data = response.data;
      if (data) {
        setBuiltPreview(data);
        if (selToUse) {
          setBuilderSelector(selToUse);
        } else if (data.selector_used) {
          setBuilderSelector(data.selector_used);
        }
        if (!name.trim()) {
          setName(`${data.page_title} (Scout Feed)`);
        }
        toast.success(`Scout successfully extracted ${data.items_count} articles!`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to build feed from webpage";
      toast.error(msg);
    } finally {
      setIsBuilding(false);
    }
  };

  const handleSearchOnline = async () => {
    if (!onlineQuery.trim()) return;

    setIsSearchingOnline(true);
    setHasSearchedOnline(true);
    try {
      const response = await feedAPI.searchOnline(onlineQuery.trim());
      setOnlineResults(response.data ?? []);
    } catch {
      toast.error("Failed to search public feeds online");
    } finally {
      setIsSearchingOnline(false);
    }
  };

  const handleSubscribeOnlineFeed = async (feed: OnlineFeedResult) => {
    const selectedGroupId = groupId
      ? parseInt(groupId, 10)
      : (groups[0]?.id ?? 1);

    setIsSubmitting(true);
    try {
      await createFeed.mutateAsync({
        link: feed.link,
        name: feed.title || feed.link,
        group_id: selectedGroupId,
        site_url: feed.website || undefined,
      });
      toast.success(t("feed.toast.added"));
      handleClose();
    } catch {
      toast.error(t("feed.toast.addFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    const selectedGroupId = groupId
      ? parseInt(groupId, 10)
      : (groups[0]?.id ?? 1);

    if (mode === "rss") {
      if (!url.trim()) {
        toast.error(t("feed.toast.enterUrl"));
        return;
      }

      setIsSubmitting(true);
      try {
        const cleanUrl = extractRealUrl(url);
        let linkToSubmit = cleanUrl;
        let siteUrlToSubmit: string | undefined = undefined;

        if (showBuilder && builtPreview) {
          const chosenSelector = builderSelector.trim() || builtPreview.selector_used;
          let synth = `/api/feeds/synthetic?url=${encodeURIComponent(cleanUrl)}`;
          if (chosenSelector) {
            synth += `&selector=${encodeURIComponent(chosenSelector)}`;
          }
          linkToSubmit = synth;
          siteUrlToSubmit = cleanUrl;
        }

        const request: CreateFeedRequest = {
          link: linkToSubmit,
          name: name.trim() || cleanUrl,
          group_id: selectedGroupId,
          site_url: siteUrlToSubmit,
        };

        if (proxy.trim()) {
          request.proxy = proxy.trim();
        }

        await createFeed.mutateAsync(request);
        toast.success(t("feed.toast.added"));
        handleClose();
      } catch (err: unknown) {
        let msg = t("feed.toast.addFailed");
        if (err && typeof err === "object") {
          const axiosErr = err as { response?: { data?: { error?: string; message?: string } }; message?: string };
          if (axiosErr.response?.data?.error) {
            msg = axiosErr.response.data.error;
          } else if (axiosErr.response?.data?.message) {
            msg = axiosErr.response.data.message;
          } else if (axiosErr.message) {
            msg = axiosErr.message;
          }
        }
        toast.error(msg);
      } finally {
        setIsSubmitting(false);
      }
    } else if (mode === "gnews") {
      if (!gnewsQuery.trim()) {
        toast.error("Please enter a Google News search query");
        return;
      }

      const localeConfig =
        GOOGLE_NEWS_LOCALES.find((l) => l.id === gnewsLocale) ??
        GOOGLE_NEWS_LOCALES[0];

      const gnewsUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(
        gnewsQuery.trim(),
      )}&hl=${localeConfig.hl}&gl=${localeConfig.gl}&ceid=${localeConfig.ceid}`;

      const feedTitle =
        gnewsName.trim() || `Google News: ${gnewsQuery.trim()}`;

      setIsSubmitting(true);
      try {
        const request: CreateFeedRequest = {
          link: gnewsUrl,
          name: feedTitle,
          group_id: selectedGroupId,
        };

        if (proxy.trim()) {
          request.proxy = proxy.trim();
        }

        await createFeed.mutateAsync(request);
        toast.success("Google News feed added successfully");
        handleClose();
      } catch {
        toast.error("Failed to add Google News feed");
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <>
      <Dialog open={isAddFeedOpen} onOpenChange={setAddFeedOpen}>
        <DialogContent
          className="flex w-full max-w-[560px] flex-col gap-0 overflow-hidden p-0 bg-card border-border text-foreground font-sans"
          showCloseButton={false}
        >
          {/* Header */}
          <DialogHeader className="flex flex-row items-center justify-between border-b border-border px-5 py-4">
            <DialogTitle className="text-base font-semibold">
              {t("feed.add.title")}
            </DialogTitle>
            <Button variant="ghost" size="icon-sm" onClick={handleClose}>
              <span className="sr-only">{t("common.cancel")}</span>
              <X className="h-[18px] w-[18px] text-muted-foreground" />
            </Button>
          </DialogHeader>

          {/* Mode Switcher Tabs */}
          <div className="flex border-b border-border px-5 pt-3 pb-0 bg-muted/20 gap-1 overflow-x-auto">
            <button
              type="button"
              onClick={() => setMode("rss")}
              className={cn(
                "flex items-center gap-1.5 pb-2 px-3 text-xs font-mono font-medium border-b-2 uppercase tracking-wide transition-colors whitespace-nowrap",
                mode === "rss"
                  ? "border-foreground text-foreground font-semibold"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Rss className="h-3.5 w-3.5" />
              {t("feed.add.tab.rss")}
            </button>
            <button
              type="button"
              onClick={() => setMode("search")}
              className={cn(
                "flex items-center gap-1.5 pb-2 px-3 text-xs font-mono font-medium border-b-2 uppercase tracking-wide transition-colors whitespace-nowrap",
                mode === "search"
                  ? "border-foreground text-foreground font-semibold"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Search className="h-3.5 w-3.5" />
              {t("feed.add.tab.search")}
            </button>
            <button
              type="button"
              onClick={() => setMode("gnews")}
              className={cn(
                "flex items-center gap-1.5 pb-2 px-3 text-xs font-mono font-medium border-b-2 uppercase tracking-wide transition-colors whitespace-nowrap",
                mode === "gnews"
                  ? "border-foreground text-foreground font-semibold"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Newspaper className="h-3.5 w-3.5" />
              {t("feed.add.tab.gnews")}
            </button>
          </div>

          {/* Form Content */}
          <div className="space-y-4 p-5 max-h-[65vh] overflow-y-auto">
            {mode === "rss" && (
              <>
                {/* RSS / Website URL Section */}
                <div className="space-y-1.5">
                  <label htmlFor="add-feed-url" className="text-[13px] font-medium">
                    {t("feed.add.urlLabel")}
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="add-feed-url"
                      name="feed-url"
                      type="url"
                      inputMode="url"
                      placeholder={t("feed.add.urlPlaceholder")}
                      value={url}
                      onChange={(e) => {
                        setUrl(e.target.value);
                        setShowBuilder(false);
                      }}
                      className="h-10"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-10 w-10 shrink-0"
                      onClick={handleValidate}
                      disabled={isValidating || !url.trim()}
                      aria-label={t("feed.add.validateTitle")}
                      title={t("feed.add.validateTitle")}
                    >
                      <Radar
                        className={cn(
                          "h-[18px] w-[18px]",
                          isValidating && "animate-pulse text-primary",
                        )}
                      />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Enter direct feed XML or website address. Click radar to thoroughly scout the whole site.
                  </p>
                </div>

                {/* Built-in RSS Feed Builder Prompt (if site has no RSS) */}
                {showBuilder && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
                    <div className="flex items-start gap-2">
                      <Wand2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <div className="text-xs font-semibold text-foreground">
                          {t("feed.add.builder.prompt")}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Scout will dynamically scrape and monitor this webpage as a live updating RSS feed.
                        </p>
                      </div>
                    </div>

                    {/* Detected Candidate Selectors Chips */}
                    {builtPreview?.suggested_selectors && builtPreview.suggested_selectors.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-foreground">
                            {t("feed.add.builder.suggestionsTitle")}
                          </span>
                          <button
                            type="button"
                            onClick={() => setIsHelpOpen(true)}
                            className="text-[11px] text-primary hover:underline flex items-center gap-1"
                          >
                            <HelpCircle className="h-3 w-3" />
                            {t("feed.add.builder.helpLink")}
                          </button>
                        </div>
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                          {builtPreview.suggested_selectors.slice(0, 4).map((sug) => {
                            const isSelected = builderSelector === sug.selector;
                            return (
                              <button
                                key={sug.selector}
                                type="button"
                                onClick={() => {
                                  setBuilderSelector(sug.selector);
                                  handleBuildFeed(sug.selector);
                                }}
                                className={cn(
                                  "flex flex-col items-start gap-1 p-2 rounded-md border text-left transition-all text-xs",
                                  isSelected
                                    ? "border-primary bg-primary/10 text-foreground font-medium ring-1 ring-primary"
                                    : "border-border/70 bg-card hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                                )}
                              >
                                <div className="flex items-center justify-between w-full">
                                  <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-muted text-foreground border border-border/40 font-semibold flex items-center gap-1">
                                    {isSelected && <Check className="h-3 w-3 text-primary" />}
                                    {sug.selector}
                                  </span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                                    {sug.count} articles
                                  </span>
                                </div>
                                {sug.sample && (
                                  <span className="text-[10px] text-muted-foreground/90 truncate w-full pt-0.5">
                                    "{sug.sample}"
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="space-y-2 pt-1">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-muted-foreground">
                          {t("feed.add.builder.selectorLabel")}
                        </label>
                        {(!builtPreview?.suggested_selectors || builtPreview.suggested_selectors.length === 0) && (
                          <button
                            type="button"
                            onClick={() => setIsHelpOpen(true)}
                            className="text-[11px] text-primary hover:underline flex items-center gap-1"
                          >
                            <HelpCircle className="h-3 w-3" />
                            {t("feed.add.builder.helpLink")}
                          </button>
                        )}
                      </div>
                      <Input
                        placeholder={t("feed.add.builder.selectorPlaceholder")}
                        value={builderSelector}
                        onChange={(e) => setBuilderSelector(e.target.value)}
                        className="h-8 text-xs font-mono"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="default"
                        onClick={() => handleBuildFeed()}
                        disabled={isBuilding}
                        className="w-full h-8 text-xs gap-1.5"
                      >
                        {isBuilding ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {t("feed.add.builder.building")}
                          </>
                        ) : (
                          <>
                            <Wand2 className="h-3.5 w-3.5" />
                            {t("feed.add.builder.button")}
                          </>
                        )}
                      </Button>
                    </div>

                    {builtPreview && (
                      <div className="rounded border bg-card p-2 text-xs space-y-1">
                        <div className="font-semibold text-primary flex items-center gap-1">
                          <Check className="h-3.5 w-3.5" /> Extracted {builtPreview.items_count} articles ({builtPreview.selector_used})
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {builtPreview.items[0]?.title}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Feed Name Section */}
                <div className="space-y-1.5">
                  <label htmlFor="add-feed-name" className="text-[13px] font-medium">
                    {t("feed.add.nameLabel")}
                  </label>
                  <Input
                    id="add-feed-name"
                    name="feed-name"
                    placeholder={t("feed.add.namePlaceholder")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-10"
                    autoComplete="off"
                  />
                </div>
              </>
            )}

            {mode === "search" && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium">
                    Keywords or Topic
                  </label>
                  <div className="flex gap-2">
                    <Input
                      placeholder={t("feed.search.placeholder")}
                      value={onlineQuery}
                      onChange={(e) => setOnlineQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleSearchOnline();
                        }
                      }}
                      className="h-10"
                      autoComplete="off"
                      autoFocus
                    />
                    <Button
                      type="button"
                      onClick={handleSearchOnline}
                      disabled={isSearchingOnline || !onlineQuery.trim()}
                      className="h-10 px-4 shrink-0 gap-1.5"
                    >
                      {isSearchingOnline ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                      {t("feed.search.button")}
                    </Button>
                  </div>
                </div>

                {/* Results List */}
                <div className="space-y-2">
                  {onlineResults.length > 0 && (
                    <div className="text-xs font-medium text-muted-foreground pb-1">
                      Found {onlineResults.length} public feeds:
                    </div>
                  )}

                  {isSearchingOnline && (
                    <div className="flex items-center justify-center p-8 text-xs text-muted-foreground gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("feed.search.searching")}
                    </div>
                  )}

                  {!isSearchingOnline && hasSearchedOnline && onlineResults.length === 0 && (
                    <div className="text-center p-8 text-xs text-muted-foreground">
                      {t("feed.search.noResults")}
                    </div>
                  )}

                  <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                    {onlineResults.map((res, idx) => (
                      <div
                        key={`${res.link}-${idx}`}
                        className="flex flex-col gap-1.5 rounded-lg border border-border p-3 hover:bg-muted/40 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-medium text-sm text-foreground line-clamp-1">
                            {res.title}
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => handleSubscribeOnlineFeed(res)}
                            disabled={isSubmitting}
                            className="h-7 text-xs px-2.5 shrink-0"
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            {t("feed.search.subscribe")}
                          </Button>
                        </div>

                        {res.description && (
                          <div className="text-xs text-muted-foreground line-clamp-2">
                            {res.description}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-muted-foreground">
                          {res.website && (
                            <span className="flex items-center gap-1 font-mono truncate max-w-[200px]">
                              <Globe className="h-3 w-3 shrink-0" />
                              {new URL(res.website.startsWith("http") ? res.website : `https://${res.website}`).hostname}
                            </span>
                          )}
                          {res.subscribers && res.subscribers > 0 ? (
                            <span className="flex items-center gap-1 bg-muted px-1.5 py-0.5 rounded text-[10px]">
                              <Users className="h-3 w-3" />
                              {res.subscribers.toLocaleString()} subscribers
                            </span>
                          ) : null}
                          {res.source === "gnews" && (
                            <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[10px] font-medium">
                              Google News Live
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {mode === "gnews" && (
              <>
                <div className="space-y-1.5">
                  <label htmlFor="gnews-query" className="text-[13px] font-medium">
                    Search Keyword or Topic *
                  </label>
                  <Input
                    id="gnews-query"
                    name="gnews-query"
                    placeholder="e.g. Semiconductors, Bank of Japan, China Trade"
                    value={gnewsQuery}
                    onChange={(e) => setGnewsQuery(e.target.value)}
                    className="h-10"
                    autoComplete="off"
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground">
                    Google News will continuously aggregate articles matching this query into an RSS feed.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium" id="gnews-locale-label">
                    Edition & Language
                  </label>
                  <Select value={gnewsLocale} onValueChange={(v) => { if (v) setGnewsLocale(v); }}>
                    <SelectTrigger className="h-10" aria-labelledby="gnews-locale-label">
                      <SelectValue placeholder="Select edition and language" />
                    </SelectTrigger>
                    <SelectContent>
                      {GOOGLE_NEWS_LOCALES.map((locale) => (
                        <SelectItem key={locale.id} value={locale.id}>
                          {locale.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="gnews-name" className="text-[13px] font-medium">
                    Custom Feed Name (Optional)
                  </label>
                  <Input
                    id="gnews-name"
                    name="gnews-name"
                    placeholder="e.g. Asia Semiconductor Tracker"
                    value={gnewsName}
                    onChange={(e) => setGnewsName(e.target.value)}
                    className="h-10"
                    autoComplete="off"
                  />
                </div>
              </>
            )}

            {/* Target Group Selector (Shared) */}
            <div className="space-y-1.5 pt-1">
              <label className="text-[13px] font-medium" id="add-feed-group-label">
                {t("feed.add.groupLabel")}
              </label>
              <Select
                value={groupId || (groups[0]?.id ? groups[0].id.toString() : "")}
                onValueChange={(v) => { if (v) setGroupId(v); }}
              >
                <SelectTrigger className="h-10" aria-labelledby="add-feed-group-label">
                  <SelectValue placeholder={t("feed.add.groupPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={group.id.toString()}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Advanced Section (Shared) */}
            <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
              <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    isAdvancedOpen && "rotate-180",
                  )}
                />
                {t("feed.add.advanced")}
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1.5 pl-5 pt-3">
                <label htmlFor="add-feed-proxy" className="text-[13px] font-medium">
                  {t("feed.add.proxyLabel")}
                </label>
                <Input
                  id="add-feed-proxy"
                  name="feed-proxy"
                  type="url"
                  inputMode="url"
                  placeholder={t("feed.add.proxyPlaceholder")}
                  value={proxy}
                  onChange={(e) => setProxy(e.target.value)}
                  className="h-10"
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  {t("feed.add.proxyHint")}
                </p>
              </CollapsibleContent>
            </Collapsible>
          </div>

          {/* Footer (for RSS and Google News modes) */}
          {mode !== "search" && (
            <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4">
              <Button variant="outline" onClick={handleClose}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || (mode === "rss" ? !url.trim() : !gnewsQuery.trim())}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                {mode === "rss" ? t("feed.add.button") : "Add Google News Feed"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Multiple Discovered Feeds Selection Dialog */}
      <Dialog
        open={isFeedSelectOpen}
        onOpenChange={(open) => {
          setIsFeedSelectOpen(open);
          if (!open) {
            setDetectedFeeds([]);
          }
        }}
      >
        <DialogContent
          className="w-full max-w-[560px] p-0"
          showCloseButton={false}
        >
          <DialogHeader className="flex flex-row items-center justify-between border-b px-5 py-4">
            <div>
              <DialogTitle className="text-base font-semibold">
                {t("feed.select.title")}
              </DialogTitle>
              <DialogDescription>
                {t("feed.select.description")}
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                setIsFeedSelectOpen(false);
                setDetectedFeeds([]);
              }}
            >
              <span className="sr-only">{t("common.cancel")}</span>
              <X className="h-[18px] w-[18px] text-muted-foreground" />
            </Button>
          </DialogHeader>

          <div className="max-h-[360px] space-y-2 overflow-y-auto p-4">
            {detectedFeeds.map((feed, index) => (
              <button
                key={`${feed.link}-${index}`}
                type="button"
                onClick={() => handleSelectDetectedFeed(feed)}
                className="w-full rounded-md border p-3 text-left transition-colors hover:bg-muted/50 block"
              >
                <div className="font-medium text-sm text-foreground">{feed.title || feed.link}</div>
                <div className="text-xs text-muted-foreground truncate">{feed.link}</div>
                {feed.description && (
                  <div className="text-xs text-muted-foreground line-clamp-2 mt-1">{feed.description}</div>
                )}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Selector Help & Instructions Dialog Modal */}
      <Dialog
        open={isHelpOpen}
        onOpenChange={setIsHelpOpen}
      >
        <DialogContent
          className="w-full max-w-[540px] p-0 overflow-hidden"
          showCloseButton={false}
        >
          <DialogHeader className="flex flex-row items-center justify-between border-b px-5 py-4">
            <div>
              <DialogTitle className="text-base font-semibold flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-primary" />
                {t("feed.add.builder.helpTitle")}
              </DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                {t("feed.add.builder.helpDesc")}
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setIsHelpOpen(false)}
            >
              <span className="sr-only">{t("common.cancel")}</span>
              <X className="h-[18px] w-[18px] text-muted-foreground" />
            </Button>
          </DialogHeader>

          <div className="max-h-[480px] overflow-y-auto p-5 space-y-4 text-xs">
            {/* Analogy Box */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-foreground leading-relaxed">
              <span className="font-semibold">💡 What is a selector? </span>
              <span className="text-muted-foreground">
                Think of a selector like an address label on a mailbox. It tells Scout exactly which boxes on the webpage contain the stories, titles, and articles you want to read.
              </span>
            </div>

            {/* Step-by-Step Instructions */}
            <div className="space-y-3">
              <div className="font-semibold text-foreground text-[13px]">
                How to find it in Safari or Google Chrome:
              </div>

              <div className="space-y-3">
                <div className="flex gap-3 items-start">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-[11px]">
                    1
                  </span>
                  <div>
                    <span className="font-medium text-foreground">Right-click any story headline:</span>
                    <p className="text-muted-foreground mt-0.5">
                      Open the target website in your web browser. Right-click on any article title and select <span className="font-medium text-foreground">Inspect</span> (or <span className="font-medium text-foreground">Inspect Element</span>).
                    </p>
                    <p className="text-[11px] text-muted-foreground/80 mt-1 italic">
                      Tip for Safari: Enable "Show features for web developers" in Safari Settings &gt; Advanced.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 items-start">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-[11px]">
                    2
                  </span>
                  <div>
                    <span className="font-medium text-foreground">Look at the container element:</span>
                    <p className="text-muted-foreground mt-0.5">
                      In the developer elements tree that opens, glance just above the headline to find the tag that wraps the whole article card (such as <code className="px-1 py-0.5 rounded bg-muted font-mono text-[11px]">&lt;article&gt;</code>, <code className="px-1 py-0.5 rounded bg-muted font-mono text-[11px]">&lt;div class="card"&gt;</code>, or <code className="px-1 py-0.5 rounded bg-muted font-mono text-[11px]">&lt;li class="post"&gt;</code>).
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 items-start">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-[11px]">
                    3
                  </span>
                  <div>
                    <span className="font-medium text-foreground">Paste it into Scout:</span>
                    <p className="text-muted-foreground mt-0.5">
                      Type the tag name (like <code className="px-1 py-0.5 rounded bg-muted font-mono text-[11px]">article</code>) or class name (like <code className="px-1 py-0.5 rounded bg-muted font-mono text-[11px]">.card</code>) into Scout, and Scout will do the rest!
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Common Selectors Cheat Sheet */}
            <div className="space-y-2 pt-3 border-t border-border">
              <div className="font-semibold text-foreground text-[13px]">
                Common Web Selectors (Click to apply):
              </div>
              <p className="text-[11px] text-muted-foreground">
                Most modern news and blog sites use one of these standard layouts:
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1">
                {[
                  { label: "article", desc: "Standard HTML article tag" },
                  { label: ".card", desc: "Modern card component" },
                  { label: ".news-item", desc: "News & media portal items" },
                  { label: ".post", desc: "Blogs & WordPress articles" },
                  { label: ".story", desc: "Editorial article wrappers" },
                  { label: "main ul > li", desc: "Bullet list news feeds" },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      setBuilderSelector(item.label);
                      setIsHelpOpen(false);
                      handleBuildFeed(item.label);
                      toast.success(`Applied selector "${item.label}"`);
                    }}
                    className="flex flex-col items-start p-2 rounded-md border border-border/80 bg-card hover:bg-accent/40 text-left transition-colors group"
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="font-mono text-xs font-semibold text-foreground group-hover:text-primary">
                        {item.label}
                      </span>
                      <Copy className="h-3 w-3 text-muted-foreground group-hover:text-primary" />
                    </div>
                    <span className="text-[10px] text-muted-foreground mt-0.5">
                      {item.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
