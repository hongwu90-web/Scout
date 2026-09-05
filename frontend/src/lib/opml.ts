import type { Group, Feed } from "./api/types";

export interface ParsedFeed {
  name: string;
  link: string;
  siteUrl?: string;
  groupName?: string;
}

/**
 * Parses OPML content and extracts feed information.
 * Supports both flat and nested (outline with children) OPML structures.
 */
export function parseOPML(content: string): ParsedFeed[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "text/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Invalid OPML format");
  }

  const feeds: ParsedFeed[] = [];
  const body = doc.querySelector("body");
  if (!body) return feeds;

  const processOutline = (outline: Element, groupName?: string) => {
    const xmlUrl = outline.getAttribute("xmlUrl") || outline.getAttribute("xmlurl");
    const htmlUrl = outline.getAttribute("htmlUrl") || outline.getAttribute("htmlurl");
    const title =
      outline.getAttribute("title") || outline.getAttribute("text") || "";

    if (xmlUrl) {
      // This is a feed
      feeds.push({
        name: title || xmlUrl,
        link: xmlUrl,
        siteUrl: htmlUrl?.trim() || undefined,
        groupName,
      });
    } else {
      // This might be a group/category
      const childOutlines = outline.querySelectorAll(":scope > outline");
      const newGroupName = title || groupName;
      childOutlines.forEach((child) => processOutline(child, newGroupName));
    }
  };

  const topOutlines = body.querySelectorAll(":scope > outline");
  topOutlines.forEach((outline) => processOutline(outline));

  return feeds;
}

const escapeXml = (str: string | undefined | null): string =>
  (str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * Generates valid OPML 2.0 XML from groups and feeds.
 */
export function generateOPML(groups: Group[] = [], feeds: Feed[] = []): string {
  const safeGroups = Array.isArray(groups) ? groups : [];
  const safeFeeds = Array.isArray(feeds) ? feeds : [];

  const feedsByGroup = new Map<number, Feed[]>();
  const ungroupedFeeds: Feed[] = [];

  safeFeeds.forEach((feed) => {
    if (!feed) return;
    const group = safeGroups.find((g) => g.id === feed.group_id);
    if (group) {
      const existing = feedsByGroup.get(group.id) || [];
      existing.push(feed);
      feedsByGroup.set(group.id, existing);
    } else {
      ungroupedFeeds.push(feed);
    }
  });

  const feedToOutline = (feed: Feed): string =>
    `      <outline type="rss" text="${escapeXml(feed.name)}" title="${escapeXml(feed.name)}" xmlUrl="${escapeXml(feed.link)}"${feed.site_url ? ` htmlUrl="${escapeXml(feed.site_url)}"` : ""} />`;

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    "  <head>",
    "    <title>Scout Subscriptions</title>",
    `    <dateCreated>${new Date().toUTCString()}</dateCreated>`,
    "  </head>",
    "  <body>",
  ];

  // Add grouped feeds
  safeGroups.forEach((group) => {
    if (!group) return;
    const groupFeeds = feedsByGroup.get(group.id) || [];
    if (groupFeeds.length > 0) {
      lines.push(
        `    <outline text="${escapeXml(group.name)}" title="${escapeXml(group.name)}">`,
      );
      groupFeeds.forEach((feed) => lines.push(feedToOutline(feed)));
      lines.push("    </outline>");
    }
  });

  // Add ungrouped feeds at top level
  ungroupedFeeds.forEach((feed) => {
    lines.push(
      `    <outline type="rss" text="${escapeXml(feed.name)}" title="${escapeXml(feed.name)}" xmlUrl="${escapeXml(feed.link)}"${feed.site_url ? ` htmlUrl="${escapeXml(feed.site_url)}"` : ""} />`,
    );
  });

  lines.push("  </body>");
  lines.push("</opml>");

  return lines.join("\n");
}

/**
 * Generates formatted JSON backup of groups and feeds.
 */
export function generateFeedsJSON(groups: Group[] = [], feeds: Feed[] = []): string {
  const safeGroups = Array.isArray(groups) ? groups : [];
  const safeFeeds = Array.isArray(feeds) ? feeds : [];

  const data = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    groups: safeGroups.map((g) => ({
      id: g.id,
      name: g.name,
    })),
    feeds: safeFeeds.map((f) => {
      const grp = safeGroups.find((g) => g.id === f.group_id);
      return {
        id: f.id,
        name: f.name,
        link: f.link,
        site_url: f.site_url ?? "",
        group_name: grp?.name ?? "Ungrouped",
        suspended: f.suspended,
      };
    }),
  };

  return JSON.stringify(data, null, 2);
}

const escapeCSV = (str: string | undefined | null): string => {
  const s = str ?? "";
  return `"${s.replace(/"/g, '""')}"`;
};

/**
 * Generates spreadsheet CSV export of feeds.
 */
export function generateFeedsCSV(groups: Group[] = [], feeds: Feed[] = []): string {
  const safeGroups = Array.isArray(groups) ? groups : [];
  const safeFeeds = Array.isArray(feeds) ? feeds : [];

  const headers = ["Feed Name", "Group", "RSS URL", "Website URL", "Status"];
  const rows = safeFeeds.map((feed) => {
    const group = safeGroups.find((g) => g.id === feed.group_id);
    const groupName = group?.name ?? "Ungrouped";
    const status = feed.suspended ? "Paused" : "Active";
    return [
      escapeCSV(feed.name),
      escapeCSV(groupName),
      escapeCSV(feed.link),
      escapeCSV(feed.site_url),
      escapeCSV(status),
    ].join(",");
  });

  return "\uFEFF" + [headers.join(","), ...rows].join("\n");
}

/**
 * Triggers a file download across Native macOS WebKit App and Standard Web Browsers.
 */
export function downloadFile(
  content: string,
  filename: string,
  mimeType: string,
): void {
  // 1. Native macOS WebKit Desktop Shell
  if (
    typeof window !== "undefined" &&
    (window as any).webkit?.messageHandlers?.saveDownload
  ) {
    (window as any).webkit.messageHandlers.saveDownload.postMessage({
      filename,
      content,
    });
    return;
  }

  // 2. Standard Web Browser Download
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 2000);
}
