// Lightweight, non-blocking storefront activity ingest.
//
// Usage:
//   enqueueActivity(row)   — fast; flushes in background every 2s or at 50 rows.
//   recordActivityNow(row) — awaitable; used for critical server-side events
//                            (login, place_order) that must not be dropped.

import { db } from "../db.js";

export type ActivityEvent =
  | "pageview"
  | "product_view"
  | "add_to_cart"
  | "remove_from_cart"
  | "begin_checkout"
  | "place_order"
  | "login"
  | "logout"
  | "search";

export interface ActivityRow {
  anonId: string;
  customerId?: string | null;
  sessionId?: string | null;
  event: ActivityEvent;
  path?: string | null;
  referer?: string | null;
  productId?: string | null;
  meta?: Record<string, unknown> | null;
  userAgent?: string | null;
  ip?: string | null;
}

// ── IP trimming ──────────────────────────────────────────────────────────────
// Trims the last octet of an IPv4 address (e.g. 1.2.3.4 → 1.2.3.0) when
// ACTIVITY_TRIM_IP env is not "0" (default: on). Leaves IPv6 and null unchanged.
const TRIM_IP = process.env["ACTIVITY_TRIM_IP"] !== "0";

export function trimIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  if (!TRIM_IP) return ip;
  const v4 = ip.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  return v4 ? `${v4[1]}.0` : ip;
}

// ── Field caps ───────────────────────────────────────────────────────────────
function sanitize(r: ActivityRow): Parameters<typeof db.customerActivity.create>[0]["data"] {
  const metaStr = r.meta ? JSON.stringify(r.meta).slice(0, 512) : null;
  return {
    id: generateCuid(),
    anonId: r.anonId.slice(0, 64),
    customerId: r.customerId ?? null,
    sessionId: r.sessionId?.slice(0, 64) ?? null,
    event: r.event,
    path: r.path?.slice(0, 500) ?? null,
    referer: r.referer?.slice(0, 500) ?? null,
    productId: r.productId ?? null,
    meta: metaStr,
    userAgent: r.userAgent?.slice(0, 200) ?? null,
    ip: trimIp(r.ip),
  };
}

// ── Minimal cuid-ish ID generator (avoids an extra dependency) ───────────────
const CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";
function generateCuid(): string {
  const ts = Date.now().toString(36);
  let rand = "";
  for (let i = 0; i < 17; i++) rand += CHARS[Math.floor(Math.random() * 36)];
  return `c${ts}${rand}`;
}

// ── Rate limiter (per anonId, in-memory token bucket, 20 events/min) ─────────
const MAX_BURST = 20;
const REFILL_MS = 60_000 / MAX_BURST; // one token every 3s
const buckets = new Map<string, { tokens: number; lastRefill: number }>();

// Prune old buckets every 5 min to avoid memory leak on high traffic.
setInterval(() => {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [k, v] of buckets) {
    if (v.lastRefill < cutoff) buckets.delete(k);
  }
}, 5 * 60_000).unref();

export function checkRateLimit(anonId: string): boolean {
  const now = Date.now();
  let bucket = buckets.get(anonId);
  if (!bucket) {
    bucket = { tokens: MAX_BURST - 1, lastRefill: now };
    buckets.set(anonId, bucket);
    return true;
  }
  const refilled = Math.floor((now - bucket.lastRefill) / REFILL_MS);
  if (refilled > 0) {
    bucket.tokens = Math.min(MAX_BURST, bucket.tokens + refilled);
    bucket.lastRefill = now;
  }
  if (bucket.tokens <= 0) return false;
  bucket.tokens--;
  return true;
}

// ── Flush queue ──────────────────────────────────────────────────────────────
const FLUSH_INTERVAL_MS = 2000;
const MAX_BATCH = 50;

let queue: Parameters<typeof db.customerActivity.create>[0]["data"][] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
  // Don't prevent Node from exiting if only this timer is left.
  if (typeof (flushTimer as { unref?: () => void }).unref === "function") {
    (flushTimer as { unref: () => void }).unref();
  }
}

async function flush() {
  if (queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH);
  try {
    await db.customerActivity.createMany({ data: batch });
  } catch (err) {
    // Never throw — activity loss is acceptable; blocking requests is not.
    console.warn("[CustomerActivity] flush failed:", (err as Error).message);
  }
  if (queue.length >= MAX_BATCH) void flush(); // drain remaining
}

// ── Public API ───────────────────────────────────────────────────────────────
export function enqueueActivity(row: ActivityRow): void {
  queue.push(sanitize(row));
  if (queue.length >= MAX_BATCH) {
    void flush();
  } else {
    scheduleFlush();
  }
}

export async function recordActivityNow(row: ActivityRow): Promise<void> {
  try {
    await db.customerActivity.create({ data: sanitize(row) });
  } catch (err) {
    console.warn("[CustomerActivity] write failed:", (err as Error).message);
  }
}
