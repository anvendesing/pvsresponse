// Maps a packagingHint (derived from product name) to a stylised
// inline SVG. Used by product cards and the cart drawer line items
// so the storefront looks lush even with placeholder imagery.

import {
  PackagingBottleOil,
  PackagingComboBags,
  PackagingCraftBag,
  PackagingSoapPack,
} from "@/assets/icons";
import type { CartLine } from "@/lib/api";

export const PackagingArt = ({ kind }: { kind: CartLine["packagingHint"] }) => {
  switch (kind) {
    case "bottle-oil":
      return <PackagingBottleOil />;
    case "soap-pack":
      return <PackagingSoapPack />;
    case "combo-bags":
      return <PackagingComboBags />;
    case "craft-bag":
    default:
      return <PackagingCraftBag />;
  }
};
