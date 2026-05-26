// The 10 storefront categories. The display name + svg icon come from
// the design spec; `matches(productCategory)` is used to bucket
// backend products (which carry a free-form `category` string) into
// the storefront's curated buckets. Anything that doesn't match goes
// into "all" only.

import type { ReactElement } from "react";
import {
  CategoryIconCookies,
  CategoryIconEco,
  CategoryIconJaggery,
  CategoryIconMillets,
  CategoryIconNuts,
  CategoryIconOil,
  CategoryIconSack,
  CategoryIconSoap,
  CategoryIconSpices,
  CategoryIconUtilities,
} from "@/assets/icons";

export interface CategoryDef {
  id: string;
  name: string;
  icon: () => ReactElement;
  // Free-form keywords that, when present in product.category /
  // product.name (case-insensitive), assign the product to this
  // bucket. First match wins.
  keywords: string[];
}

export const CATEGORIES: CategoryDef[] = [
  {
    id: "oils",
    name: "Oils & Oil Seeds",
    icon: CategoryIconOil,
    keywords: ["oil", "oilseed", "ghee"],
  },
  {
    id: "grains",
    name: "Grains, Pulses & Flours",
    icon: CategoryIconSack,
    keywords: ["grain", "flour", "rice", "wheat", "dal", "gram", "pulse", "atta"],
  },
  {
    id: "millets",
    name: "Millets & Millet Products",
    icon: CategoryIconMillets,
    keywords: ["millet", "ragi", "jowar", "bajra", "foxtail", "kodo", "barnyard"],
  },
  {
    id: "snacks",
    name: "Sweets & Snacks",
    icon: CategoryIconCookies,
    keywords: ["snack", "sweet", "chikki", "biscuit", "murukku", "laddu", "cookie", "jaggery sweet"],
  },
  {
    id: "spices",
    name: "Spices & Condiments",
    icon: CategoryIconSpices,
    keywords: ["spice", "masala", "turmeric", "chili", "pepper", "salt", "condiment"],
  },
  {
    id: "dryfruits",
    name: "Dry Fruits, Seeds & Superfoods",
    icon: CategoryIconNuts,
    keywords: ["nut", "almond", "cashew", "raisin", "seed", "chia", "sunflower", "superfood", "dry fruit"],
  },
  {
    id: "wellness",
    name: "Personal Care & Wellness",
    icon: CategoryIconSoap,
    keywords: ["soap", "wellness", "hair", "skin", "personal", "ayur", "herbal", "balm"],
  },
  {
    id: "eco",
    name: "Eco-Friendly Household",
    icon: CategoryIconEco,
    keywords: ["eco", "household", "cleaner", "biodegradable", "bamboo", "soapnut"],
  },
  {
    id: "sweeteners",
    name: "Natural Sweeteners",
    icon: CategoryIconJaggery,
    keywords: ["honey", "jaggery", "sweetener", "kakvi", "palm sugar", "panela"],
  },
  {
    id: "utilities",
    name: "Home Utilities",
    icon: CategoryIconUtilities,
    keywords: ["clay", "pot", "scrubber", "utensil", "kitchen", "utility"],
  },
];

const CATEGORIES_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export const getCategory = (id: string | undefined): CategoryDef | undefined =>
  id ? CATEGORIES_BY_ID.get(id) : undefined;

// Return the storefront category id for a backend product. Falls back
// to "grains" so every product ends up in some bucket - we never want
// to silently drop items from the storefront browse experience.
export const bucketFor = (
  category: string | null | undefined,
  productName: string | null | undefined
): string => {
  const haystack = `${category ?? ""} ${productName ?? ""}`.toLowerCase();
  for (const c of CATEGORIES) {
    if (c.keywords.some((kw) => haystack.includes(kw))) return c.id;
  }
  return "grains";
};
