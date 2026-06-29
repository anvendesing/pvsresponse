/**
 * Default storefront categories and keyword bucketing used for one-time
 * backfill from legacy Product.category free-text → ProductCategory FK.
 *
 * Names, slugs, and sort order match categories-and-products.xlsx (Categories sheet).
 */

export interface CategorySeedDef {
  slug: string;
  name: string;
  sortOrder: number;
  keywords: string[];
}

export const DEFAULT_PRODUCT_CATEGORIES: CategorySeedDef[] = [
  {
    slug: "grains-pulses-flours",
    name: "Grains, Pulses & Flours",
    sortOrder: 1,
    keywords: ["grain", "flour", "rice", "wheat", "dal", "gram", "pulse", "atta", "pappu", "pesalu"],
  },
  {
    slug: "oils-oil-seeds",
    name: "Oils & Oil Seeds",
    sortOrder: 2,
    keywords: ["oil", "oilseed", "ghee", "sesame", "groundnut", "mustard", "safflower"],
  },
  {
    slug: "millets-millet-products",
    name: "Millets & Millet Products",
    sortOrder: 3,
    keywords: ["millet", "ragi", "jowar", "bajra", "foxtail", "kodo", "barnyard", "sorghum", "siridhanya"],
  },
  {
    slug: "sweets-snacks",
    name: "Sweets & Snacks",
    sortOrder: 4,
    keywords: ["snack", "sweet", "chikki", "biscuit", "murukku", "laddu", "cookie", "papad", "muruku", "ariselu"],
  },
  {
    slug: "spices-condiments",
    name: "Spices & Condiments",
    sortOrder: 5,
    keywords: ["spice", "masala", "turmeric", "chilli", "chili", "pepper", "salt", "condiment", "pickle", "karam"],
  },
  {
    slug: "dry-fruitsseeds-superfoods",
    name: "Dry Fruits,Seeds & Superfoods",
    sortOrder: 6,
    keywords: ["nut", "almond", "cashew", "raisin", "seed", "chia", "sunflower", "superfood", "dry fruit", "walnut"],
  },
  {
    slug: "personal-care-wellness",
    name: "Personal Care & Wellness",
    sortOrder: 7,
    keywords: ["soap", "wellness", "hair", "skin", "personal", "ayur", "herbal", "balm", "shampoo", "henna"],
  },
  {
    slug: "eco-friendly-household",
    name: "Eco-friendly Household",
    sortOrder: 8,
    keywords: ["eco", "household", "cleaner", "biodegradable", "bamboo", "soapnut", "strategi", "repellent"],
  },
  {
    slug: "natural-sweeteners",
    name: "Natural Sweeteners",
    sortOrder: 9,
    keywords: ["honey", "jaggery", "sweetener", "kakvi", "palm sugar", "panela", "khandsari"],
  },
  {
    slug: "home-utilities",
    name: "Home Utilities",
    sortOrder: 10,
    keywords: ["clay", "pot", "scrubber", "utensil", "kitchen", "utility", "incense", "filter", "copper"],
  },
];

/** Map legacy free-text category + product name to a storefront slug. */
export const bucketCategorySlug = (
  legacyCategory: string | null | undefined,
  productName: string | null | undefined
): string => {
  const haystack = `${legacyCategory ?? ""} ${productName ?? ""}`.toLowerCase();
  for (const c of DEFAULT_PRODUCT_CATEGORIES) {
    if (c.keywords.some((kw) => haystack.includes(kw))) return c.slug;
  }
  return "grains-pulses-flours";
};
