import type { CatalogProduct } from "@/lib/api";

export type ProductSortOrder = "default" | "price-asc" | "price-desc";

/** Match product against a free-text storefront search query. */
export const catalogMatches = (p: CatalogProduct, q: string): boolean => {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    p.name.toLowerCase().includes(needle) ||
    p.sku.toLowerCase().includes(needle) ||
    p.category.toLowerCase().includes(needle) ||
    p.variants.some((v) => v.sku.toLowerCase().includes(needle)) ||
    (p.searchAliases ?? []).some((a) => a.includes(needle))
  );
};

/** Lowest visible price — variant min when variants exist. */
export const productListPrice = (p: CatalogProduct): number =>
  p.variants.length > 0
    ? Math.min(...p.variants.map((v) => v.price))
    : p.sellingPrice;

export const sortProducts = (
  list: CatalogProduct[],
  sortOrder: ProductSortOrder
): CatalogProduct[] => {
  if (sortOrder === "default") return list;
  return [...list].sort((a, b) =>
    sortOrder === "price-asc"
      ? productListPrice(a) - productListPrice(b)
      : productListPrice(b) - productListPrice(a)
  );
};
