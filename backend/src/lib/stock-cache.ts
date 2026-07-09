// Storefront availability cache using Redis SETs.
//
// Keys:
//   instock:products  — finished products with ≥1 storefront-enabled variant
//   instock:variants  — all storefront-enabled variants (always listed as in-stock)
//
// Actual stockOnHand is enforced at checkout — this cache mirrors catalog UX only.

import { redis } from "./redis.js";
import { db } from "../db.js";
import { storefrontProductWhere, storefrontVariantWhere } from "./storefront-catalog.js";

const KEY_PRODUCTS = "instock:products";
const KEY_VARIANTS = "instock:variants";
const SET_TTL_SECONDS = 300;

/** Populate Redis sets from storefront listing rules (not stockOnHand). */
export async function rebuildInStockSets(): Promise<void> {
  if (!redis) return;
  try {
    const listedProducts = await db.product.findMany({
      where: {
        ...storefrontProductWhere,
        variants: { some: storefrontVariantWhere },
      },
      select: { id: true },
    });

    const listedVariants = await db.productVariant.findMany({
      where: {
        ...storefrontVariantWhere,
        product: storefrontProductWhere,
      },
      select: { id: true },
    });

    const pipe = redis.pipeline();
    pipe.del(KEY_PRODUCTS);
    if (listedProducts.length > 0) {
      pipe.sadd(KEY_PRODUCTS, ...listedProducts.map((p) => p.id));
    }
    pipe.expire(KEY_PRODUCTS, SET_TTL_SECONDS);

    pipe.del(KEY_VARIANTS);
    if (listedVariants.length > 0) {
      pipe.sadd(KEY_VARIANTS, ...listedVariants.map((v) => v.id));
    }
    pipe.expire(KEY_VARIANTS, SET_TTL_SECONDS);

    await pipe.exec();
  } catch (err) {
    console.error("[stock-cache] rebuildInStockSets error:", err);
  }
}

async function isStorefrontListedVariant(variantId: string): Promise<boolean> {
  const v = await db.productVariant.findFirst({
    where: { id: variantId, ...storefrontVariantWhere, product: storefrontProductWhere },
    select: { id: true },
  });
  return Boolean(v);
}

async function isStorefrontListedProduct(productId: string): Promise<boolean> {
  const p = await db.product.findFirst({
    where: {
      id: productId,
      ...storefrontProductWhere,
      variants: { some: storefrontVariantWhere },
    },
    select: { id: true },
  });
  return Boolean(p);
}

export async function isProductInStock(productId: string): Promise<boolean> {
  if (!redis) return isStorefrontListedProduct(productId);
  try {
    const exists = await redis.sismember(KEY_PRODUCTS, productId);
    if (exists !== null) return exists === 1;
  } catch { /* fall through */ }
  void rebuildInStockSets();
  return isStorefrontListedProduct(productId);
}

export async function isVariantInStock(variantId: string): Promise<boolean> {
  if (!redis) return isStorefrontListedVariant(variantId);
  try {
    const exists = await redis.sismember(KEY_VARIANTS, variantId);
    if (exists !== null) return exists === 1;
  } catch { /* fall through */ }
  void rebuildInStockSets();
  return isStorefrontListedVariant(variantId);
}

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

/** Refresh listing membership after catalog channel or stock changes. */
export async function syncProductStockCache(
  productId: string,
  opts?: { variantId?: string; newProductSoh?: number; newVariantSoh?: number }
): Promise<void> {
  if (!redis) return;
  try {
    if (await isStorefrontListedProduct(productId)) {
      await redis.sadd(KEY_PRODUCTS, productId);
    } else {
      await redis.srem(KEY_PRODUCTS, productId);
    }

    if (opts?.variantId !== undefined) {
      if (await isStorefrontListedVariant(opts.variantId)) {
        await redis.sadd(KEY_VARIANTS, opts.variantId);
      } else {
        await redis.srem(KEY_VARIANTS, opts.variantId);
      }
    }
  } catch (err) {
    console.error("[stock-cache] syncProductStockCache error:", err);
  }
}
