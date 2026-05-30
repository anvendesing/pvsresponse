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
