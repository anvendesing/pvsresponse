import type { CatalogProduct, CatalogVariant } from "@/lib/api";

/** Storefront only exposes in-stock boolean — cap at 99 when available. */
export const STOCK_CAP = 99;

export const stockCapFor = (
  product: CatalogProduct,
  variant: CatalogVariant | null
): number => {
  const inStock = variant ? variant.inStock : product.inStock;
  return inStock ? STOCK_CAP : 0;
};

export const findCatalogLine = (
  products: CatalogProduct[],
  productId: string,
  variantId: string | null
): { product: CatalogProduct; variant: CatalogVariant | null } | null => {
  const product = products.find((p) => p.id === productId);
  if (!product) return null;
  const variant =
    variantId != null
      ? product.variants.find((v) => v.id === variantId) ?? null
      : null;
  return { product, variant };
};
