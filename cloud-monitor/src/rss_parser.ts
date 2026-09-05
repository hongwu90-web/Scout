import * as cheerio from "cheerio";

export interface ParsedFeedItem {
  guid: string;
  title: string;
  link: string;
  content: string;
  pubDate: number; // Unix timestamp in seconds
}

export function parseRSSOrAtom(xmlString: string): ParsedFeedItem[] {
  if (!xmlString || typeof xmlString !== "string") {
    return [];
  }

  const $ = cheerio.load(xmlString, { xmlMode: true });
  const items: ParsedFeedItem[] = [];

  // 1. Check for RSS 2.0 / 0.9x (<item>)
  const rssItems = $("item");
  if (rssItems.length > 0) {
    rssItems.each((_, el) => {
      const item = $(el);
      const title = (item.find("title").first().text() || "").trim();
      let link = (item.find("link").first().text() || "").trim();
      if (!link) {
        link = item.find("link").first().attr("href") || "";
      }

      let guid = (item.find("guid").first().text() || "").trim();
      if (!guid) {
        guid = link || title;
      }

      let content = (item.find("content\\:encoded, encoded").first().text() || "").trim();
      if (!content) {
        content = (item.find("description").first().text() || "").trim();
      }

      const pubDateStr = (item.find("pubDate, dc\\:date, date").first().text() || "").trim();
      let pubDate = 0;
      if (pubDateStr) {
        const parsed = Date.parse(pubDateStr);
        if (!isNaN(parsed)) {
          pubDate = Math.floor(parsed / 1000);
        }
      }
      if (pubDate === 0) {
        pubDate = Math.floor(Date.now() / 1000);
      }

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
    return items;
  }

  // 2. Check for Atom 1.0 (<entry>)
  const atomEntries = $("entry");
  if (atomEntries.length > 0) {
    atomEntries.each((_, el) => {
      const entry = $(el);
      const title = (entry.find("title").first().text() || "").trim();
      
      let link = "";
      const linkTags = entry.find("link");
      linkTags.each((_, l) => {
        const rel = $(l).attr("rel");
        const href = $(l).attr("href");
        if ((!rel || rel === "alternate") && href && !link) {
          link = href;
        }
      });
      if (!link && linkTags.length > 0) {
        link = linkTags.first().attr("href") || linkTags.first().text() || "";
      }

      let guid = (entry.find("id").first().text() || "").trim();
      if (!guid) {
        guid = link || title;
      }

      let content = (entry.find("content").first().text() || "").trim();
      if (!content) {
        content = (entry.find("summary").first().text() || "").trim();
      }

      const dateStr = (entry.find("published, updated").first().text() || "").trim();
      let pubDate = 0;
      if (dateStr) {
        const parsed = Date.parse(dateStr);
        if (!isNaN(parsed)) {
          pubDate = Math.floor(parsed / 1000);
        }
      }
      if (pubDate === 0) {
        pubDate = Math.floor(Date.now() / 1000);
      }

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
    return items;
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
