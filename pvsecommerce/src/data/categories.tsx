// SVG icon fallbacks for category tiles when no uploaded image exists.

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

const ICON_BY_SLUG: Record<string, () => ReactElement> = {
  // Canonical slugs (categories-and-products.xlsx)
  "oils-oil-seeds": CategoryIconOil,
  "grains-pulses-flours": CategoryIconSack,
  "millets-millet-products": CategoryIconMillets,
  "sweets-snacks": CategoryIconCookies,
  "spices-condiments": CategoryIconSpices,
  "dry-fruitsseeds-superfoods": CategoryIconNuts,
  "personal-care-wellness": CategoryIconSoap,
  "eco-friendly-household": CategoryIconEco,
  "natural-sweeteners": CategoryIconJaggery,
  "home-utilities": CategoryIconUtilities,
  // Legacy short slugs (old bookmarks / redirects)
  oils: CategoryIconOil,
  grains: CategoryIconSack,
  millets: CategoryIconMillets,
  snacks: CategoryIconCookies,
  spices: CategoryIconSpices,
  dryfruits: CategoryIconNuts,
  wellness: CategoryIconSoap,
  eco: CategoryIconEco,
  sweeteners: CategoryIconJaggery,
  utilities: CategoryIconUtilities,
};

export const getCategoryIcon = (slug: string): (() => ReactElement) | undefined =>
  ICON_BY_SLUG[slug];

/** Static PNG tiles still use legacy short filenames (category_oils.png, …). */
const IMAGE_SLUG_ALIAS: Record<string, string> = {
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

export const categoryStaticImageSlug = (slug: string): string =>
  IMAGE_SLUG_ALIAS[slug] ?? slug;
