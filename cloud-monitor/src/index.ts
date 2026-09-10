import { Hono } from "hono";
import { cors } from "hono/cors";
import { scrapePage } from "./scraper";
import { computeDiff } from "./diff";
import { parseRSSOrAtom } from "./rss_parser";

export interface Env {
  DB: D1Database;
  SYNC_SECRET_KEY?: string;
}

interface MonitoredPageRow {
  id: number;
  user_id: number;
  name: string;
  url: string;
  css_selector: string;
  strip_selectors: string;
  check_interval: number;
  last_hash: string;
  last_status: number;
  last_error: string;
  next_check_at: number;
  is_active: number;
  created_at: number;
  updated_at: number;
}

interface PageSnapshotRow {
  id: number;
  user_id: number;
  page_id: number;
  hash: string;
  content_text: string;
  prev_content_text: string;
  diff_html: string;
  sections: string;
  has_change: number;
  added_count: number;
  removed_count: number;
  unread: number;
  created_at: number;
}

interface CloudFeedRow {
  id: number;
  user_id: number;
  name: string;
  link: string;
  is_active: number;
  last_checked_at: number;
  last_etag: string;
  last_modified: string;
  updated_at: number;
}

interface CloudFeedItemRow {
  id: number;
  user_id: number;
  feed_id: number;
  guid: string;
  title: string;
  link: string;
  content: string;
  pub_date: number;
  created_at: number;
}

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  console.error("Scout Cloud Monitor Error:", err);
  return c.json({ error: err.message, stack: err.stack }, 500);
});

app.use("*", cors());

// Constant-time string comparison to prevent side-channel timing attacks
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// Authentication Middleware for /api/* (Fail-Closed)
app.use("/api/*", async (c, next) => {
  const secretKey = c.env.SYNC_SECRET_KEY;
  if (!secretKey) {
    return c.json({ error: "Service misconfigured: SYNC_SECRET_KEY is required" }, 500);
  }

  const authHeader = c.req.header("Authorization");
  const customHeader = c.req.header("X-Scout-Sync-Key");
  const token = authHeader?.replace(/^Bearer\s+/i, "") || customHeader;

  if (!token || !timingSafeEqual(token, secretKey)) {
    return c.json({ error: "Unauthorized: Invalid or missing sync secret key" }, 401);
  }

  await next();
});

// Health check
app.get("/health", async (c) => {
  try {
    const pageCount = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM monitored_pages").first<{ cnt: number }>();
    const activePageCount = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM monitored_pages WHERE is_active = 1").first<{ cnt: number }>();
    const snapCount = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM page_snapshots").first<{ cnt: number }>();
    const feedCount = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM cloud_feeds").first<{ cnt: number }>();
    const activeFeedCount = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM cloud_feeds WHERE is_active = 1").first<{ cnt: number }>();
    const itemCount = await c.env.DB.prepare("SELECT COUNT(*) as cnt, MAX(id) as max_id, MAX(created_at) as max_created FROM cloud_feed_items").first<{ cnt: number; max_id: number; max_created: number }>();
    const oldestFeed = await c.env.DB.prepare("SELECT MIN(last_checked_at) as min_checked FROM cloud_feeds WHERE is_active = 1").first<{ min_checked: number }>();

    return c.json({
      status: "ok",
      server_time: Math.floor(Date.now() / 1000),
      monitored_pages_count: pageCount?.cnt ?? 0,
      active_monitored_pages_count: activePageCount?.cnt ?? 0,
      snapshots_count: snapCount?.cnt ?? 0,
      feeds_count: feedCount?.cnt ?? 0,
      active_feeds_count: activeFeedCount?.cnt ?? 0,
      feed_items_count: itemCount?.cnt ?? 0,
      latest_feed_item_id: itemCount?.max_id ?? 0,
      latest_feed_item_at: itemCount?.max_created ?? 0,
      oldest_feed_checked_at: oldestFeed?.min_checked ?? 0,
    });
  } catch (err: any) {
    return c.json({ status: "warning", message: "Database tables query warning", error: err.message });
  }
});

// ---------------------- MONITORED PAGES SYNC ----------------------

// Pull new snapshots since timestamp
app.get("/api/sync/pull", async (c) => {
  const since = parseInt(c.req.query("since") || "0", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "100", 10), 500);

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM page_snapshots WHERE created_at > ? ORDER BY created_at ASC LIMIT ?`
  )
    .bind(since, limit)
    .all<PageSnapshotRow>();

  return c.json({
    data: results || [],
    server_time: Math.floor(Date.now() / 1000),
  });
});

// Push local monitor configurations to Cloud
app.post("/api/sync/push", async (c) => {
  const body = await c.req.json<{
    monitors: Array<{
      id: number;
      name: string;
      url: string;
      css_selector?: string;
      strip_selectors?: string;
      check_interval?: number;
      is_active?: boolean;
    }>;
  }>();

  const now = Math.floor(Date.now() / 1000);
  const statements: D1PreparedStatement[] = [];
  const incomingIds = (body.monitors || []).map((m) => m.id);

  if (incomingIds.length > 0) {
    const placeholders = incomingIds.map(() => "?").join(",");
    statements.push(
      c.env.DB.prepare(`UPDATE monitored_pages SET is_active = 0 WHERE id NOT IN (${placeholders})`).bind(...incomingIds)
    );
  } else {
    statements.push(
      c.env.DB.prepare(`UPDATE monitored_pages SET is_active = 0`)
    );
  }

  for (const m of body.monitors || []) {
    const checkInterval = m.check_interval && m.check_interval > 0 ? m.check_interval : 3600;
    const isActive = m.is_active !== false ? 1 : 0;

    statements.push(
      c.env.DB.prepare(`
        INSERT INTO monitored_pages (
          id, user_id, name, url, css_selector, strip_selectors,
          check_interval, next_check_at, is_active, created_at, updated_at
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          url = excluded.url,
          css_selector = excluded.css_selector,
          strip_selectors = excluded.strip_selectors,
          check_interval = excluded.check_interval,
          is_active = excluded.is_active,
          updated_at = excluded.updated_at
      `).bind(
        m.id,
        m.name,
        m.url,
        m.css_selector || "",
        m.strip_selectors || "",
        checkInterval,
        now,
        isActive,
        now,
        now
      )
    );
  }

  if (statements.length > 0) {
    await c.env.DB.batch(statements);
  }

  return c.json({
    synced_count: statements.length,
    timestamp: now,
  });
});

// ---------------------- 24/7 RSS FEEDS SYNC ----------------------

// Push local active feeds list to Cloudflare
app.post("/api/sync/feeds/push", async (c) => {
  const body = await c.req.json<{
    feeds: Array<{
      id: number;
      name: string;
      link: string;
      is_active?: boolean;
    }>;
  }>();

  const now = Math.floor(Date.now() / 1000);
  const statements: D1PreparedStatement[] = [];
  const incomingIds = (body.feeds || []).map((f) => f.id);

  if (incomingIds.length > 0) {
    const placeholders = incomingIds.map(() => "?").join(",");
    statements.push(
      c.env.DB.prepare(`UPDATE cloud_feeds SET is_active = 0 WHERE id NOT IN (${placeholders})`).bind(...incomingIds)
    );
  }

  for (const f of body.feeds || []) {
    const isActive = f.is_active !== false ? 1 : 0;
    // Remove any stale feed entries holding this link under an older/different ID
    statements.push(
      c.env.DB.prepare(`DELETE FROM cloud_feeds WHERE link = ? AND id != ?`).bind(f.link, f.id)
    );
    statements.push(
      c.env.DB.prepare(`
        INSERT INTO cloud_feeds (
          id, user_id, name, link, is_active, last_checked_at, last_etag, last_modified, updated_at
        ) VALUES (?, 1, ?, ?, ?, 0, '', '', ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          link = excluded.link,
          is_active = excluded.is_active,
          updated_at = excluded.updated_at
      `).bind(f.id, f.name, f.link, isActive, now)
    );
  }

  if (statements.length > 0) {
    await c.env.DB.batch(statements);
  }

  return c.json({
    synced_count: statements.length,
    timestamp: now,
  });
});

// Pull newly archived feed items since ID or timestamp
app.get("/api/sync/feeds/pull", async (c) => {
  const sinceId = parseInt(c.req.query("since_id") || "0", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "1000", 10), 2000);

  let results: CloudFeedItemRow[] | null = null;
  if (sinceId > 0) {
    const res = await c.env.DB.prepare(
      `SELECT * FROM cloud_feed_items WHERE id > ? ORDER BY id ASC LIMIT ?`
    )
      .bind(sinceId, limit)
      .all<CloudFeedItemRow>();
    results = res.results;
  } else {
    const since = parseInt(c.req.query("since") || "0", 10);
    if (since > 0) {
      const res = await c.env.DB.prepare(
        `SELECT * FROM cloud_feed_items WHERE created_at > ? ORDER BY created_at ASC LIMIT ?`
      )
        .bind(since, limit)
        .all<CloudFeedItemRow>();
      results = res.results;
    } else {
      const res = await c.env.DB.prepare(
        `SELECT * FROM cloud_feed_items ORDER BY id ASC LIMIT ?`
      )
        .bind(limit)
        .all<CloudFeedItemRow>();
      results = res.results;
    }
  }

  const items = results || [];
  const maxId = items.length > 0 ? items[items.length - 1].id : sinceId;

  return c.json({
    data: items,
    max_id: maxId,
    count: items.length,
    server_time: Math.floor(Date.now() / 1000),
  });
});

// Manual cron trigger for testing and administrative diagnostics
app.all("/api/sync/cron/run", async (c) => {
  const start = Date.now();
  try {
    await handleScheduled(c.env);
    const duration = Date.now() - start;

    const latestFeeds = await c.env.DB.prepare(
      "SELECT id, name, last_checked_at, datetime(last_checked_at, 'unixepoch') as checked_dt FROM cloud_feeds WHERE is_active = 1 ORDER BY last_checked_at DESC LIMIT 10"
    ).all();
    const stats = await c.env.DB.prepare(
      "SELECT COUNT(*) as cnt, MAX(id) as max_id, MAX(created_at) as max_created FROM cloud_feed_items"
    ).first();
    const pages = await c.env.DB.prepare(
      "SELECT id, name, last_status, last_error, next_check_at, datetime(next_check_at, 'unixepoch') as next_dt FROM monitored_pages WHERE is_active = 1"
    ).all();

    return c.json({
      status: "ok",
      duration_ms: duration,
      recent_checked_feeds: latestFeeds.results,
      items_meta: stats,
      active_monitored_pages: pages.results,
    });
  } catch (err: any) {
    return c.json({
      status: "error",
      error: err?.message || String(err),
      stack: err?.stack,
      duration_ms: Date.now() - start,
    }, 500);
  }
});

// ---------------------- SCHEDULED CRON ENGINE (24/7) ----------------------

async function handleScheduled(env: Env) {
  const now = Math.floor(Date.now() / 1000);
  console.log(`[Cron] Starting 24/7 background sync cycle at epoch ${now}`);

  // Run sequentially to strictly respect Cloudflare Workers 10ms CPU limit
  await checkDueMonitoredPages(env, now);
  await checkDueFeeds(env, now);

  // Prune expired buffer data once per hour
  if (now % 3600 < 300) {
    await pruneOldData(env.DB, now);
  }
}

async function checkDueMonitoredPages(env: Env, now: number) {
  try {
    const { results: duePages } = await env.DB.prepare(
      `SELECT * FROM monitored_pages WHERE is_active = 1 AND next_check_at <= ? ORDER BY next_check_at ASC LIMIT 2`
    )
      .bind(now)
      .all<MonitoredPageRow>();

    if (!duePages || duePages.length === 0) return;

    console.log(`[Cron] Checking ${duePages.length} due monitored pages.`);
    for (const page of duePages) {
      try {
        await checkSinglePage(env.DB, page);
      } catch (err: any) {
        console.error(`[Cron] Failed checking page ${page.id} (${page.name}):`, err);
        try {
          await env.DB.prepare(
            `UPDATE monitored_pages SET next_check_at = ?, last_error = ? WHERE id = ?`
          )
            .bind(now + page.check_interval, String(err?.message || err), page.id)
            .run();
        } catch {}
      }
    }
  } catch (err) {
    console.error("[Cron] Error querying monitored pages:", err);
  }
}

async function checkDueFeeds(env: Env, now: number) {
  try {
    // Check 4 active feeds per 5-minute cron = 48 feeds checked/hour
    // Fully cycles through 30 user feeds every ~37 minutes without CPU spikes
    const { results: activeFeeds } = await env.DB.prepare(
      `SELECT * FROM cloud_feeds WHERE is_active = 1 ORDER BY last_checked_at ASC LIMIT 4`
    ).all<CloudFeedRow>();

    if (!activeFeeds || activeFeeds.length === 0) return;

    console.log(`[Cron] Fetching ${activeFeeds.length} active RSS feeds.`);
    // Process in batches of 2 with concurrency to ensure zero worker CPU timeouts
    const concurrency = 2;
    for (let i = 0; i < activeFeeds.length; i += concurrency) {
      const chunk = activeFeeds.slice(i, i + concurrency);
      await Promise.allSettled(chunk.map((feed) => fetchAndArchiveFeed(env.DB, feed, now)));
    }
  } catch (err) {
    console.error("[Cron] Error querying feeds:", err);
  }
}

async function fetchAndArchiveFeed(db: D1Database, feed: CloudFeedRow, now: number) {
  try {
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Scout/1.32",
      "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    };

    if (feed.last_etag) {
      headers["If-None-Match"] = feed.last_etag;
    }
    if (feed.last_modified) {
      headers["If-Modified-Since"] = feed.last_modified;
    }

    const resp = await fetch(feed.link, {
      headers,
      signal: AbortSignal.timeout(8000), // 8s strict timeout
    });

    if (resp.status === 304) {
      // Not modified
      await db.prepare("UPDATE cloud_feeds SET last_checked_at = ? WHERE id = ?").bind(now, feed.id).run();
      return;
    }

    if (!resp.ok) {
      console.warn(`[Cron] Feed fetch ${feed.name} returned HTTP ${resp.status}`);
      await db.prepare("UPDATE cloud_feeds SET last_checked_at = ? WHERE id = ?").bind(now, feed.id).run();
      return;
    }

    const etag = resp.headers.get("etag") || "";
    const lastModified = resp.headers.get("last-modified") || "";
    let xmlText = await resp.text();
    if (xmlText.length > 2_000_000) {
      xmlText = xmlText.slice(0, 2_000_000);
    }

    const items = parseRSSOrAtom(xmlText);
    if (items.length === 0) {
      await db
        .prepare("UPDATE cloud_feeds SET last_checked_at = ?, last_etag = ?, last_modified = ? WHERE id = ?")
        .bind(now, etag, lastModified, feed.id)
        .run();
      return;
    }

    // Limit to newest 40 items so giant feeds (e.g. 2,000 items) never blow memory or D1 limits
    const itemsToSave = items.slice(0, 40);

    // Insert newly published items with ON CONFLICT DO NOTHING
    const insertStmts: D1PreparedStatement[] = [];
    for (const item of itemsToSave) {
      const safeContent = item.content && item.content.length > 50000 ? item.content.slice(0, 50000) : (item.content || "");
      insertStmts.push(
        db.prepare(`
          INSERT INTO cloud_feed_items (
            user_id, feed_id, guid, title, link, content, pub_date, created_at
          ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, feed_id, guid) DO NOTHING
        `).bind(
          feed.id,
          item.guid,
          item.title,
          item.link,
          safeContent,
          item.pubDate,
          now
        )
      );
    }

    // Execute in small batches of 20 to strictly respect D1 statement limit
    const batchSize = 20;
    for (let i = 0; i < insertStmts.length; i += batchSize) {
      const chunk = insertStmts.slice(i, i + batchSize);
      if (chunk.length > 0) {
        await db.batch(chunk);
      }
    }

    await db
      .prepare("UPDATE cloud_feeds SET last_checked_at = ?, last_etag = ?, last_modified = ? WHERE id = ?")
      .bind(now, etag, lastModified, feed.id)
      .run();

    console.log(`[Cron] Feed ${feed.name} parsed: ${itemsToSave.length} items processed.`);
  } catch (err) {
    console.error(`[Cron] Failed fetching feed ${feed.id} (${feed.name}):`, err);
    try {
      await db.prepare("UPDATE cloud_feeds SET last_checked_at = ? WHERE id = ?").bind(now, feed.id).run();
    } catch {}
  }
}

async function pruneOldData(db: D1Database, now: number) {
  try {
    // Retain 14 days of buffered feed items
    const cutoff = now - 14 * 86400;
    await db.prepare("DELETE FROM cloud_feed_items WHERE created_at < ?").bind(cutoff).run();
  } catch (err) {
    console.error("[Cron] Pruning error:", err);
  }
}

async function checkSinglePage(db: D1Database, page: MonitoredPageRow) {
  const now = Math.floor(Date.now() / 1000);
  const scrapeRes = await scrapePage(page.url, page.css_selector, page.strip_selectors);

  if (scrapeRes.error) {
    await db
      .prepare(
        `UPDATE monitored_pages SET last_status = ?, last_error = ?, next_check_at = ?, updated_at = ? WHERE id = ?`
      )
      .bind(scrapeRes.statusCode || 0, scrapeRes.error, now + page.check_interval, now, page.id)
      .run();
    return { success: false, error: scrapeRes.error };
  }

  const latestSnap = await db
    .prepare(`SELECT * FROM page_snapshots WHERE page_id = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(page.id)
    .first<PageSnapshotRow>();

  let hasChange = false;
  let diffRes = computeDiff(latestSnap?.content_text || "", scrapeRes.contentText);

  if (!latestSnap) {
    await db
      .prepare(`
        INSERT INTO page_snapshots (
          user_id, page_id, hash, content_text, prev_content_text,
          diff_html, sections, has_change, added_count, removed_count, unread, created_at
        ) VALUES (1, ?, ?, ?, '', ?, ?, 0, ?, 0, 1, ?)
      `)
      .bind(
        page.id,
        scrapeRes.hash,
        scrapeRes.contentText,
        diffRes.diffHTML,
        JSON.stringify(diffRes.sections),
        diffRes.addedCount,
        now
      )
      .run();
    hasChange = false;
  } else if (scrapeRes.hash !== latestSnap.hash || scrapeRes.hash !== page.last_hash) {
    hasChange = diffRes.hasChange;
    if (hasChange) {
      await db
        .prepare(`
          INSERT INTO page_snapshots (
            user_id, page_id, hash, content_text, prev_content_text,
            diff_html, sections, has_change, added_count, removed_count, unread, created_at
          ) VALUES (1, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1, ?)
        `)
        .bind(
          page.id,
          scrapeRes.hash,
          scrapeRes.contentText,
          latestSnap.content_text,
          diffRes.diffHTML,
          JSON.stringify(diffRes.sections),
          diffRes.addedCount,
          diffRes.removedCount,
          now
        )
        .run();
    }
  }

  await db
    .prepare(`
      UPDATE monitored_pages SET
        last_hash = ?,
        last_status = ?,
        last_error = '',
        next_check_at = ?,
        updated_at = ?
      WHERE id = ?
    `)
    .bind(scrapeRes.hash, scrapeRes.statusCode, now + page.check_interval, now, page.id)
    .run();

  return {
    success: true,
    has_change: hasChange,
    hash: scrapeRes.hash,
    elements_count: scrapeRes.elementsCount,
  };
}

export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    await handleScheduled(env);
  },
};
