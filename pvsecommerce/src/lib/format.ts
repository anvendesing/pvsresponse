// Formatting helpers shared across pages.

import type { CartLine, CatalogVariant } from "@/lib/api";

export const variantLabelFrom = (variant: CatalogVariant | null): string | null => {
  if (!variant) return null;
  const label = [variant.size, variant.color, variant.grade].filter(Boolean).join(" · ");
  return label || null;
};

/** Product name with variant size / grade when present. */
export const cartLineDescription = (line: CartLine): string => {
  const params = line.variantLabel ?? line.variantSize;
  return params ? `${line.productName} · ${params}` : line.productName;
};

/** Checkout / summary line: "Amla Powder · 100g × 8" */
export const cartLineSummary = (line: CartLine): string =>
  `${cartLineDescription(line)} × ${line.qty}`;

export const inr = (n: number): string =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

export const inrFloat = (n: number): string =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);

export const dateLong = (iso: string | Date): string => {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

// Stable bucket selector: hashes a string into one of 4 packaging
// types. Used to give every backend product a deterministic visual
// without relying on an explicit packaging field that doesn't exist
// today.
export const packagingFromName = (
  productName: string
): "craft-bag" | "bottle-oil" | "soap-pack" | "combo-bags" => {
  const n = productName.toLowerCase();
  if (n.includes("oil") || n.includes("ghee") || n.includes("honey"))
    return "bottle-oil";
  if (n.includes("soap") || n.includes("balm") || n.includes("gel"))
    return "soap-pack";
  if (n.includes("combo")) return "combo-bags";
  return "craft-bag";
};
