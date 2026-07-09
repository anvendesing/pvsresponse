// Catalog JSON cache backed by Redis.
//
// Wraps the four storefront GET endpoints with a Redis string cache:
//   catalog:all          60s  — full product catalog
//   catalog:product:{id} 60s  — single product detail
//   catalog:categories   5min — category list
//   catalog:concerns     5min — concern list
//
// Invalidation is explicit (call invalidateCatalog() after mutations).
// TTL is a safety net — normal invalidation happens within seconds.
//
// Pattern:
//   const cached = await cacheGet("catalog:all");
//   if (cached) return cached;
//   const fresh = await <prisma query>;
//   await cacheSet("catalog:all", fresh, 60);
//   return fresh;

import { redis } from "./redis.js";

const CATALOG_PREFIX = "catalog:";

// ── Low-level helpers ────────────────────────────────────────────────────────

/** Get a cached value. Returns null on miss or Redis outage. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Set a cached value with TTL in seconds. Silently ignores Redis outage. */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (!redis) return;
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  } catch { /* ignore */ }
}

// ── Catalog-specific keys ────────────────────────────────────────────────────

export const CACHE_KEYS = {
  /** Grouped product catalog (variants nested per product). */
  all: `${CATALOG_PREFIX}all:v4`,
  product: (id: string) => `${CATALOG_PREFIX}product:${id}`,
  categories: `${CATALOG_PREFIX}categories`,
  concerns: `${CATALOG_PREFIX}concerns`,
} as const;

export const CACHE_TTL = {
  catalog: 60,   // 60s — product catalog + individual PDPs
  taxonomy: 300, // 5min — categories + concerns (changes infrequently)
} as const;

// ── Invalidation ─────────────────────────────────────────────────────────────

type InvalidateScope = "all" | "product" | "categories" | "concerns" | { productId: string };

/**
 * Invalidate catalog cache after ERP mutations.
 *
 * scope = "all"              — wipe every catalog:* key (product/category/concern changes)
 * scope = "product"          — wipe catalog:all + all catalog:product:* keys
 * scope = { productId }      — wipe catalog:all + catalog:product:<id>
 * scope = "categories"       — wipe catalog:all + catalog:categories
 * scope = "concerns"         — wipe catalog:all + catalog:concerns
 */
export async function invalidateCatalog(scope: InvalidateScope = "all"): Promise<void> {
  if (!redis) return;
  try {
    if (scope === "all") {
      // Scan and delete all catalog:* keys
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", `${CATALOG_PREFIX}*`, "COUNT", "100");
        cursor = next;
        if (keys.length > 0) await redis.del(...keys);
      } while (cursor !== "0");
      return;
    }

    const toDelete: string[] = [CACHE_KEYS.all]; // always bust the listing

    if (scope === "product") {
      // Wipe all individual product caches via scan
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", `${CATALOG_PREFIX}product:*`, "COUNT", "100");
        cursor = next;
        if (keys.length > 0) toDelete.push(...keys);
      } while (cursor !== "0");
    } else if (typeof scope === "object" && "productId" in scope) {
      toDelete.push(CACHE_KEYS.product(scope.productId));
    } else if (scope === "categories") {
      toDelete.push(CACHE_KEYS.categories);
    } else if (scope === "concerns") {
      toDelete.push(CACHE_KEYS.concerns);
    }

    if (toDelete.length > 0) await redis.del(...toDelete);
  } catch (err) {
    console.error("[catalog-cache] invalidateCatalog error:", err);
  }
}
