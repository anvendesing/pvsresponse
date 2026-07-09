// Storefront catalog rules — single channel flag: variant.ecommerceEnabled.
//
// Parent Product rows are bulk / packaging SKUs. They never appear on the
// storefront directly. Only active finished-goods variants with
// ecommerceEnabled=true are listed.

import type { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { canonicalCategorySlug } from "./category-slug-map.js";

/** Parent products eligible to host storefront variants. */
export const storefrontProductWhere = {
  state: "active" as const,
  type: "finished" as const,
  category: { active: true },
};

/** Variant must be explicitly enabled for the storefront channel. */
export const storefrontVariantWhere = {
  active: true,
  ecommerceEnabled: true,
};

const variantSelect = {
  id: true,
  sku: true,
  barcode: true,
  size: true,
  color: true,
  grade: true,
  uom: true,
  packSize: true,
  stockOnHand: true,
  sellingPriceOverride: true,
  active: true,
  ecommerceEnabled: true,
  gstRate: true,
} satisfies Prisma.ProductVariantSelect;

const productInclude = {
  category: { select: { id: true, slug: true, name: true } },
  concernLinks: {
    select: { concern: { select: { id: true, slug: true, name: true, active: true } } },
  },
  variants: {
    where: storefrontVariantWhere,
    select: variantSelect,
    orderBy: { sku: "asc" as const },
  },
} satisfies Prisma.ProductInclude;

export type StorefrontCatalogProduct = Prisma.ProductGetPayload<{
  include: typeof productInclude;
}>;

/** Load finished products that have at least one storefront-enabled variant. */
export async function fetchStorefrontCatalogProducts(): Promise<StorefrontCatalogProduct[]> {
  return db.product.findMany({
    where: {
      ...storefrontProductWhere,
      variants: { some: storefrontVariantWhere },
    },
    orderBy: { sku: "asc" },
    include: productInclude,
  });
}

/** Resolve PDP — accepts parent product id/sku or a variant id/sku. */
export async function fetchStorefrontProductDetail(
  idOrSku: string
): Promise<StorefrontCatalogProduct | null> {
  const byProduct = await db.product.findFirst({
    where: {
      OR: [{ id: idOrSku }, { sku: idOrSku }],
      ...storefrontProductWhere,
      variants: { some: storefrontVariantWhere },
    },
    include: productInclude,
  });
  if (byProduct) return byProduct;

  const variant = await db.productVariant.findFirst({
    where: {
      OR: [{ id: idOrSku }, { sku: idOrSku }],
      ...storefrontVariantWhere,
      product: storefrontProductWhere,
    },
    select: { productId: true },
  });
  if (!variant) return null;

  return db.product.findFirst({
    where: {
      id: variant.productId,
      ...storefrontProductWhere,
      variants: { some: storefrontVariantWhere },
    },
    include: productInclude,
  });
}

export { variantSelect, productInclude };

export type SerializedStorefrontProduct = ReturnType<typeof serializeStorefrontProduct>;

/**
 * Serialize a product + its storefront-enabled variants for the catalog API.
 * Stock is not exposed — every listed variant is shown as in-stock on the storefront.
 */
export function serializeStorefrontProduct(p: StorefrontCatalogProduct) {
  const variants = p.variants
    .map((v) => ({
      id: v.id,
      sku: v.sku,
      barcode: v.barcode,
      size: v.size,
      color: v.color,
      grade: v.grade,
      uom: v.uom,
      packSize: v.packSize,
      inStock: true,
      price: v.sellingPriceOverride ?? p.sellingPrice,
      gstRate: v.gstRate ?? p.gstRate,
    }))
    .sort((a, b) => b.price - a.price);

  return {
    id: p.id,
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    categoryId: p.categoryId,
    categorySlug: p.category ? canonicalCategorySlug(p.category.slug) : null,
    categoryName: p.category?.name ?? null,
    category: p.category?.name ?? null,
    uom: p.uom,
    sellingPrice: p.sellingPrice,
    inStock: variants.length > 0,
    gstRate: p.gstRate,
    description: p.description ?? null,
    ingredients: p.ingredients ?? null,
    imageHint: p.imageHint ?? null,
    imageUrl: p.imageUrl ?? null,
    imageUpdatedAt: p.updatedAt ? p.updatedAt.getTime() : null,
    bestSellerEnabled: p.bestSellerEnabled,
    tags: p.tags ? p.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    searchAliases: p.searchAliases
      ? p.searchAliases.split(",").map((a) => a.trim()).filter(Boolean)
      : [],
    concernSlugs: p.concernLinks
      .filter((l) => l.concern.active)
      .map((l) => l.concern.slug),
    concernNames: p.concernLinks
      .filter((l) => l.concern.active)
      .map((l) => l.concern.name),
    variants,
  };
}
