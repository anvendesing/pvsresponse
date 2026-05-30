/**
 * Default storefront categories and keyword bucketing used for one-time
 * backfill from legacy Product.category free-text → ProductCategory FK.
 */

export interface CategorySeedDef {
  slug: string;
  name: string;
  sortOrder: number;
  keywords: string[];
}

export const DEFAULT_PRODUCT_CATEGORIES: CategorySeedDef[] = [
  { slug: "oils", name: "Oils & Oil Seeds", sortOrder: 1, keywords: ["oil", "oilseed", "ghee"] },
  {
    slug: "grains",
    name: "Grains, Pulses & Flours",
    sortOrder: 2,
    keywords: ["grain", "flour", "rice", "wheat", "dal", "gram", "pulse", "atta"],
  },
  {
    slug: "millets",
    name: "Millets & Millet Products",
    sortOrder: 3,
    keywords: ["millet", "ragi", "jowar", "bajra", "foxtail", "kodo", "barnyard"],
  },
  {
    slug: "snacks",
    name: "Sweets & Snacks",
    sortOrder: 4,
    keywords: ["snack", "sweet", "chikki", "biscuit", "murukku", "laddu", "cookie", "jaggery sweet"],
  },
  {
    slug: "spices",
    name: "Spices & Condiments",
    sortOrder: 5,
    keywords: ["spice", "masala", "turmeric", "chili", "pepper", "salt", "condiment"],
  },
  {
    slug: "dryfruits",
    name: "Dry Fruits, Seeds & Superfoods",
    sortOrder: 6,
    keywords: ["nut", "almond", "cashew", "raisin", "seed", "chia", "sunflower", "superfood", "dry fruit"],
  },
  {
    slug: "wellness",
    name: "Personal Care & Wellness",
    sortOrder: 7,
    keywords: ["soap", "wellness", "hair", "skin", "personal", "ayur", "herbal", "balm"],
  },
  {
    slug: "eco",
    name: "Eco-Friendly Household",
    sortOrder: 8,
    keywords: ["eco", "household", "cleaner", "biodegradable", "bamboo", "soapnut"],
  },
  {
    slug: "sweeteners",
    name: "Natural Sweeteners",
    sortOrder: 9,
    keywords: ["honey", "jaggery", "sweetener", "kakvi", "palm sugar", "panela"],
  },
  {
    slug: "utilities",
    name: "Home Utilities",
    sortOrder: 10,
    keywords: ["clay", "pot", "scrubber", "utensil", "kitchen", "utility"],
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
  return "grains";
};
