import * as cheerio from "cheerio";

export interface ScrapeResult {
  url: string;
  statusCode: number;
  contentText: string;
  hash: string;
  elementsCount: number;
  error?: string;
}

export async function scrapePage(
  url: string,
  cssSelector: string = "",
  stripSelectors: string = "",
): Promise<ScrapeResult> {
  try {
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Upgrade-Insecure-Requests": "1",
    };

    const response = await fetch(url, {
      method: "GET",
      headers,
      redirect: "follow",
    });

    if (!response.ok) {
      return {
        url,
        statusCode: response.status,
        contentText: "",
        hash: "",
        elementsCount: 0,
        error: `HTTP error ${response.status} ${response.statusText}`,
      };
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Strip default non-content boilerplate
    $("script, style, noscript, iframe, svg").remove();

    // Strip user-specified selectors
    if (stripSelectors && stripSelectors.trim() !== "") {
      const strips = stripSelectors.split(",").map((s) => s.trim()).filter(Boolean);
      for (const sel of strips) {
        $(sel).remove();
      }
    }

    // Select target element or body
    let target = cssSelector && cssSelector.trim() !== "" ? $(cssSelector) : $("body");
    if (target.length === 0) {
      target = $("body");
    }

    const elementsCount = target.length;
    const contentText = extractStructuredText($, target);

    // Compute SHA-256 hash using Web Crypto API
    const encoder = new TextEncoder();
    const data = encoder.encode(contentText);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    return {
      url,
      statusCode: response.status,
      contentText,
      hash,
      elementsCount,
    };
  } catch (err: any) {
    return {
      url,
      statusCode: 0,
      contentText: "",
      hash: "",
      elementsCount: 0,
      error: err.message || "Failed to scrape page",
    };
  }
}

function extractStructuredText($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>): string {
  const lines: string[] = [];
  const visited = new Set<string>();

  root
    .find("h1, h2, h3, h4, h5, h6, p, li, tr, blockquote, pre, div, article, section")
    .each((_, el) => {
      const tagName = el.tagName.toLowerCase();
      const text = $(el).text().trim();
      if (!text) return;

      const isHeading = tagName.startsWith("h") && tagName.length === 2;
      const isLi = tagName === "li";

      // Deduplicate nested parent/child text duplicates
      const key = `${tagName}:${text}`;
      if (visited.has(key)) return;
      visited.add(key);

      if (isHeading) {
        lines.push(`\n### ${text}\n`);
      } else if (isLi) {
        lines.push(`• ${text}`);
      } else {
        lines.push(text);
      }
    });

  if (lines.length === 0) {
    return root.text().trim();
  }

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
