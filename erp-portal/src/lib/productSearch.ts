import type { Product, ProductType, ProductVariant } from "@/data/types";

export type ProductSearchHit = {
  product: Product;
  variant: ProductVariant | null;
  label: string;
  price: number;
  /** variant = sellable variant row; parent = parent SKU; standalone = no variants */
  rowKind: "variant" | "parent" | "standalone";
};

export type ProductSearchResult = {
  hits: ProductSearchHit[];
  totalMatches: number;
  truncated: boolean;
};

/** Shown only when the "Include parent SKUs & raw materials" toggle is on. */
const EXTENDED_ONLY_TYPES = new Set<ProductType>(["raw", "semi", "consumable"]);

const variantLabel = (v: ProductVariant) =>
  [v.size, v.color, v.grade].filter(Boolean).join(" · ") || "default";

const effectivePrice = (p: Product, v?: ProductVariant) =>
  v?.sellingPriceOverride ?? p.sellingPrice;

const productMatchesTerm = (p: Product, term: string): boolean =>
  p.name.toLowerCase().includes(term) ||
  p.sku.toLowerCase().includes(term) ||
  (p.barcode ?? "").toLowerCase().includes(term) ||
  (p.category?.name ?? "").toLowerCase().includes(term);

const variantMatchesTerm = (v: ProductVariant, term: string): boolean =>
  v.sku.toLowerCase().includes(term) ||
  (v.barcode ?? "").toLowerCase().includes(term) ||
  (v.size ?? "").toLowerCase().includes(term) ||
  (v.color ?? "").toLowerCase().includes(term) ||
  (v.grade ?? "").toLowerCase().includes(term);

/** Default cap for dropdown rows — scrollable list, not a hard product scan limit. */
export const PRODUCT_SEARCH_DISPLAY_LIMIT = 50;

/**
 * Sale-line product search for quotes / POS billing.
 *
 * Default (`includeParentsAndRaw = false`): matching **variants only**, plus
 * finished / service goods that have no variants (single standalone row).
 * Raw and semi-finished parent SKUs are hidden unless the toggle is on.
 *
 * Toggle on: also parent SKUs for multi-variant products, and raw / semi /
 * consumable products without variants.
 */
export const searchProductsForSale = (
  products: Product[],
  rawTerm: string,
  opts: { includeParentsAndRaw?: boolean; limit?: number } = {}
): ProductSearchResult => {
  const term = rawTerm.trim().toLowerCase();
  if (term.length < 2) {
    return { hits: [], totalMatches: 0, truncated: false };
  }

  const limit = opts.limit ?? PRODUCT_SEARCH_DISPLAY_LIMIT;
  const includeParentsAndRaw = opts.includeParentsAndRaw ?? false;
  const all: ProductSearchHit[] = [];

  for (const p of products) {
    const baseHit = productMatchesTerm(p, term);
    const variants = p.variants ?? [];
    const hasVariants = variants.length > 0;
    const extendedOnly = EXTENDED_ONLY_TYPES.has(p.type);

    for (const v of variants) {
      if (variantMatchesTerm(v, term) || baseHit) {
        all.push({
          product: p,
          variant: v,
          label: variantLabel(v),
          price: effectivePrice(p, v),
          rowKind: "variant",
        });
      }
    }

    if (!hasVariants && baseHit) {
      if (extendedOnly && !includeParentsAndRaw) continue;
      all.push({
        product: p,
        variant: null,
        label: extendedOnly ? p.type : "default",
        price: p.sellingPrice,
        rowKind: "standalone",
      });
      continue;
    }

    if (includeParentsAndRaw && baseHit && hasVariants) {
      all.push({
        product: p,
        variant: null,
        label: "parent SKU",
        price: p.sellingPrice,
        rowKind: "parent",
      });
    }
  }

  return {
    hits: all.slice(0, limit),
    totalMatches: all.length,
    truncated: all.length > limit,
  };
};

/**
 * Bin assign / warehouse mobile search: variant rows for multi-variant
 * products, standalone row when a product has no variants. Parent-only
 * rows are omitted so operators pick the exact sellable SKU.
 */
export const searchProductsForBinAssign = (
  products: Product[],
  rawTerm: string,
  opts: { limit?: number } = {}
): ProductSearchResult => {
  const term = rawTerm.trim().toLowerCase();
  if (term.length < 2) {
    return { hits: [], totalMatches: 0, truncated: false };
  }

  const limit = opts.limit ?? 12;
  const all: ProductSearchHit[] = [];

  for (const p of products) {
    const baseHit = productMatchesTerm(p, term);
    const variants = p.variants ?? [];

    for (const v of variants) {
      if (variantMatchesTerm(v, term) || baseHit) {
        all.push({
          product: p,
          variant: v,
          label: variantLabel(v),
          price: effectivePrice(p, v),
          rowKind: "variant",
        });
      }
    }

    if (variants.length === 0 && baseHit) {
      all.push({
        product: p,
        variant: null,
        label: p.type,
        price: p.sellingPrice,
        rowKind: "standalone",
      });
    }
  }

  return {
    hits: all.slice(0, limit),
    totalMatches: all.length,
    truncated: all.length > limit,
  };
};

export { variantLabel, effectivePrice, productMatchesTerm, variantMatchesTerm };
