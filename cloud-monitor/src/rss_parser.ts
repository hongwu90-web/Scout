import * as cheerio from "cheerio";

export interface ParsedFeedItem {
  guid: string;
  title: string;
  link: string;
  content: string;
  pubDate: number; // Unix timestamp in seconds
}

function decodeEntities(str: string): string {
  if (!str) return "";
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const num = Number(code);
      return !isNaN(num) && num > 0 && num < 65536 ? String.fromCharCode(num) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const num = parseInt(hex, 16);
      return !isNaN(num) && num > 0 && num < 65536 ? String.fromCharCode(num) : "";
    })
    .replace(/&amp;/g, "&");
}

function cleanText(raw: string): string {
  if (!raw) return "";
  let text = raw.trim();
  const cdataMatch = /^<!\[CDATA\[([\s\S]*?)\]\]>$/i.exec(text);
  if (cdataMatch) {
    text = cdataMatch[1];
  } else if (text.includes("<![CDATA[")) {
    text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1");
  }
  return decodeEntities(text).trim();
}

function parseDate(str: string): number {
  if (!str) return 0;
  const parsed = Date.parse(str.trim());
  return isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
}

export function parseRSSOrAtom(xmlString: string): ParsedFeedItem[] {
  if (!xmlString || typeof xmlString !== "string") {
    return [];
  }

  const now = Math.floor(Date.now() / 1000);
  const items: ParsedFeedItem[] = [];

  // 1. Ultra-fast Streaming Regex Extraction for RSS 2.0 / 0.9x (<item>)
  const itemRegex = /<item(?:\s+[^>]*)?>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xmlString)) !== null) {
    const b = match[1];
    const title = cleanText((/<title(?:\s+[^>]*)?>([\s\S]*?)<\/title>/i.exec(b) || [])[1] || "");
    let link = cleanText((/<link(?:\s+[^>]*)?>([\s\S]*?)<\/link>/i.exec(b) || [])[1] || "");
    if (!link) {
      const hrefMatch = /<link(?:\s+[^>]*)?href=["']([^"']+)["']/i.exec(b);
      if (hrefMatch) link = cleanText(hrefMatch[1]);
    }

    const guid = cleanText((/<guid(?:\s+[^>]*)?>([\s\S]*?)<\/guid>/i.exec(b) || [])[1] || link || title);
    const content = cleanText(
      (/<content:encoded(?:\s+[^>]*)?>([\s\S]*?)<\/content:encoded>/i.exec(b) || [])[1] ||
      (/<description(?:\s+[^>]*)?>([\s\S]*?)<\/description>/i.exec(b) || [])[1] || ""
    );
    const pubDateStr = (/<(?:pubDate|dc:date)(?:\s+[^>]*)?>([\s\S]*?)<\/(?:pubDate|dc:date)>/i.exec(b) || [])[1] || "";
    const pubDate = parseDate(pubDateStr) || now;

    if (title || link || guid) {
      items.push({
        guid: guid || `gen_${Math.abs(hashString(title + link))}`,
        title: title || "Untitled Article",
        link,
        content,
        pubDate,
      });
    }
  }

  if (items.length > 0) {
    return items;
  }

  // 2. Ultra-fast Streaming Regex Extraction for Atom 1.0 (<entry>)
  const entryRegex = /<entry(?:\s+[^>]*)?>([\s\S]*?)<\/entry>/gi;
  while ((match = entryRegex.exec(xmlString)) !== null) {
    const b = match[1];
    const title = cleanText((/<title(?:\s+[^>]*)?>([\s\S]*?)<\/title>/i.exec(b) || [])[1] || "");

    let link = "";
    const linkMatches = b.matchAll(/<link(?:\s+[^>]*)?href=["']([^"']+)["'](?:\s+[^>]*)?\/?>/gi);
    for (const lm of linkMatches) {
      const tagStr = lm[0];
      const href = lm[1];
      if (tagStr.includes('rel="alternate"') || tagStr.includes("rel='alternate'") || !tagStr.includes("rel=")) {
        link = cleanText(href);
        break;
      }
      if (!link) link = cleanText(href);
    }
    if (!link) {
      const tagLinkMatch = /<link(?:\s+[^>]*)?>([\s\S]*?)<\/link>/i.exec(b);
      if (tagLinkMatch) link = cleanText(tagLinkMatch[1]);
    }

    const guid = cleanText((/<id(?:\s+[^>]*)?>([\s\S]*?)<\/id>/i.exec(b) || [])[1] || link || title);
    const content = cleanText(
      (/<content(?:\s+[^>]*)?>([\s\S]*?)<\/content>/i.exec(b) || [])[1] ||
      (/<summary(?:\s+[^>]*)?>([\s\S]*?)<\/summary>/i.exec(b) || [])[1] || ""
    );
    const pubDateStr = (/<(?:published|updated)(?:\s+[^>]*)?>([\s\S]*?)<\/(?:published|updated)>/i.exec(b) || [])[1] || "";
    const pubDate = parseDate(pubDateStr) || now;

    if (title || link || guid) {
      items.push({
        guid: guid || `gen_${Math.abs(hashString(title + link))}`,
        title: title || "Untitled Article",
        link,
        content,
        pubDate,
      });
    }
  }

  if (items.length > 0) {
    return items;
  }

  // 3. Fallback to Cheerio only if regex fails on unconventional XML
  if (xmlString.includes("<item") || xmlString.includes("<entry")) {
    try {
      const $ = cheerio.load(xmlString, { xmlMode: true });
      const rssFallback = $("item");
      if (rssFallback.length > 0) {
        rssFallback.each((_, el) => {
          const item = $(el);
          const title = (item.find("title").first().text() || "").trim();
          let link = (item.find("link").first().text() || "").trim();
          if (!link) link = item.find("link").first().attr("href") || "";
          let guid = (item.find("guid").first().text() || "").trim();
          if (!guid) guid = link || title;
          let content = (item.find("content\\:encoded, encoded").first().text() || "").trim();
          if (!content) content = (item.find("description").first().text() || "").trim();
          const pubDateStr = (item.find("pubDate, dc\\:date, date").first().text() || "").trim();
          const pubDate = parseDate(pubDateStr) || now;

          if (title || link || guid) {
            items.push({
              guid: guid || `gen_${Math.abs(hashString(title + link))}`,
              title: title || "Untitled Article",
              link,
              content,
              pubDate,
            });
          }
        });
      }
    } catch {}
  }

  return items;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
