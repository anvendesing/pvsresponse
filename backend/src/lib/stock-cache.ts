// In-stock cache using Redis SETs.
//
// Keys:
//   instock:products  — SET of productIds with any stock > 0
//   instock:variants  — SET of variantIds with stockOnHand > 0
//
// TTL (safety net): 5 minutes. Invalidation is event-driven:
//   - Order placement: markOutOfStock after SOH update
//   - Stock ledger writes: markInStock / markOutOfStock on affected IDs
//   - Manual adjustments: same helpers
//
// Order placement NEVER reads from this cache — it always reads Postgres
// inside the transaction. This is read-only for storefront rendering.

import { redis } from "./redis.js";
import { db } from "../db.js";

const KEY_PRODUCTS = "instock:products";
const KEY_VARIANTS = "instock:variants";
const SET_TTL_SECONDS = 300; // 5-minute safety-net refresh

// ── Lazy-build helpers ───────────────────────────────────────────────────────

/** Populate the in-stock sets from Postgres. Called on first miss + backend boot. */
export async function rebuildInStockSets(): Promise<void> {
  if (!redis) return;
  try {
    // Products: stockOnHand > 0 at the product level (aggregated across variants)
    const inStockProducts = await db.product.findMany({
      where: { stockOnHand: { gt: 0 }, ecommerceEnabled: true },
      select: { id: true },
    });

    // Variants: stockOnHand > 0
    const inStockVariants = await db.productVariant.findMany({
      where: { stockOnHand: { gt: 0 } },
      select: { id: true },
    });

    const pipe = redis.pipeline();

    // Rebuild products set
    pipe.del(KEY_PRODUCTS);
    if (inStockProducts.length > 0) {
      pipe.sadd(KEY_PRODUCTS, ...inStockProducts.map((p) => p.id));
    }
    pipe.expire(KEY_PRODUCTS, SET_TTL_SECONDS);

    // Rebuild variants set
    pipe.del(KEY_VARIANTS);
    if (inStockVariants.length > 0) {
      pipe.sadd(KEY_VARIANTS, ...inStockVariants.map((v) => v.id));
    }
    pipe.expire(KEY_VARIANTS, SET_TTL_SECONDS);

    await pipe.exec();
  } catch (err) {
    console.error("[stock-cache] rebuildInStockSets error:", err);
  }
}

// ── Read helpers ─────────────────────────────────────────────────────────────

/** Returns true if the product has stock > 0. Falls back to Postgres on cache miss. */
export async function isProductInStock(productId: string): Promise<boolean> {
  if (!redis) {
    const p = await db.product.findUnique({ where: { id: productId }, select: { stockOnHand: true } });
    return (p?.stockOnHand ?? 0) > 0;
  }
  try {
    const exists = await redis.sismember(KEY_PRODUCTS, productId);
    if (exists !== null) return exists === 1;
  } catch { /* Redis unavailable — fall through */ }

  // Cache miss: rebuild and answer from Postgres
  void rebuildInStockSets();
  const p = await db.product.findUnique({ where: { id: productId }, select: { stockOnHand: true } });
  return (p?.stockOnHand ?? 0) > 0;
}

/** Returns true if the variant has stock > 0. Falls back to Postgres on cache miss. */
export async function isVariantInStock(variantId: string): Promise<boolean> {
  if (!redis) {
    const v = await db.productVariant.findUnique({ where: { id: variantId }, select: { stockOnHand: true } });
    return (v?.stockOnHand ?? 0) > 0;
  }
  try {
    const exists = await redis.sismember(KEY_VARIANTS, variantId);
    if (exists !== null) return exists === 1;
  } catch { /* Redis unavailable — fall through */ }

  void rebuildInStockSets();
  const v = await db.productVariant.findUnique({ where: { id: variantId }, select: { stockOnHand: true } });
  return (v?.stockOnHand ?? 0) > 0;
}

// ── Write helpers (call after SOH-changing DB writes) ────────────────────────

export async function markProductInStock(productId: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.sadd(KEY_PRODUCTS, productId);
  } catch { /* ignore */ }
}

export async function markProductOutOfStock(productId: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.srem(KEY_PRODUCTS, productId);
  } catch { /* ignore */ }
}

export async function markVariantInStock(variantId: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.sadd(KEY_VARIANTS, variantId);
  } catch { /* ignore */ }
}

export async function markVariantOutOfStock(variantId: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.srem(KEY_VARIANTS, variantId);
  } catch { /* ignore */ }
}

/**
 * Re-evaluate one product (and its variants) after a stock change.
 * Pass newSoh if you already know the updated value to skip a DB read.
 */
export async function syncProductStockCache(
  productId: string,
  opts?: { newProductSoh?: number; variantId?: string; newVariantSoh?: number }
): Promise<void> {
  if (!redis) return;
  try {
    const soh = opts?.newProductSoh
      ?? (await db.product.findUnique({ where: { id: productId }, select: { stockOnHand: true } }))?.stockOnHand
      ?? 0;

    if (soh > 0) {
      await redis.sadd(KEY_PRODUCTS, productId);
    } else {
      await redis.srem(KEY_PRODUCTS, productId);
    }

    if (opts?.variantId !== undefined) {
      const vSoh = opts.newVariantSoh
        ?? (await db.productVariant.findUnique({ where: { id: opts.variantId }, select: { stockOnHand: true } }))?.stockOnHand
        ?? 0;
      if (vSoh > 0) {
        await redis.sadd(KEY_VARIANTS, opts.variantId);
      } else {
        await redis.srem(KEY_VARIANTS, opts.variantId);
      }
    }
  } catch (err) {
    console.error("[stock-cache] syncProductStockCache error:", err);
  }
}
