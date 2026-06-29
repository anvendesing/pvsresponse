/**
 * Legacy short storefront slugs → canonical slugs from categories-and-products.xlsx.
 * Used when migrating DB rows and resolving static category tile images.
 */

export const LEGACY_CATEGORY_SLUG_MAP: Record<string, string> = {
  oils: "oils-oil-seeds",
  grains: "grains-pulses-flours",
  millets: "millets-millet-products",
  snacks: "sweets-snacks",
  spices: "spices-condiments",
  dryfruits: "dry-fruitsseeds-superfoods",
  wellness: "personal-care-wellness",
  eco: "eco-friendly-household",
  sweeteners: "natural-sweeteners",
  utilities: "home-utilities",
};

/** Static tile PNGs still use legacy short names (category_oils.png, …). */
export const CATEGORY_IMAGE_SLUG_ALIAS: Record<string, string> = {
  "oils-oil-seeds": "oils",
  "grains-pulses-flours": "grains",
  "millets-millet-products": "millets",
  "sweets-snacks": "snacks",
  "spices-condiments": "spices",
  "dry-fruitsseeds-superfoods": "dryfruits",
  "personal-care-wellness": "wellness",
  "eco-friendly-household": "eco",
  "natural-sweeteners": "sweeteners",
  "home-utilities": "utilities",
};

export const canonicalCategorySlug = (slug: string): string =>
  LEGACY_CATEGORY_SLUG_MAP[slug] ?? slug;

export const categoryImageSlug = (slug: string): string =>
  CATEGORY_IMAGE_SLUG_ALIAS[slug] ?? slug;
