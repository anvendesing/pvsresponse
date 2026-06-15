// Client-side mirror of backend/src/lib/variant-weight.ts. Used by the
// Quote / Sales Order / Invoice editors so the "estimated shipping
// weight" chip updates live as the user edits lines (server only
// recomputes on save). Kept in sync with the backend formula:
//
//   unitWeightKg = variant.weightKg ?? product.weightKg ?? parseSizeToKg(variant.size) ?? 0
//
// Default density (kg / litre) matches the backend default of 0.92
// (typical edible oil for the Indian SMB use case).

const DEFAULT_DENSITY_KG_PER_L = 0.92;

export const parseSizeToKg = (
  raw: string | null | undefined,
  density: number = DEFAULT_DENSITY_KG_PER_L
): number | null => {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  const kgMatch = t.match(/([\d.]+)\s*kg\b/);
  if (kgMatch) return parseFloat(kgMatch[1]);
  const gMatch = t.match(/([\d.]+)\s*(gms?|g)\b/);
  if (gMatch) return parseFloat(gMatch[1]) / 1000;
  const lMatch = t.match(/([\d.]+)\s*(ltr|lit|l)\b/);
  if (lMatch) return parseFloat(lMatch[1]) * density;
  const mlMatch = t.match(/([\d.]+)\s*ml\b/);
  if (mlMatch) return (parseFloat(mlMatch[1]) / 1000) * density;
  return null;
};

interface ProductLike {
  weightKg?: number | null;
}
interface VariantLike {
  weightKg?: number | null;
  size?: string | null;
}

export const unitWeightKg = (
  variant: VariantLike | null | undefined,
  product: ProductLike | null | undefined
): number => {
  if (variant?.weightKg != null) return variant.weightKg;
  if (product?.weightKg != null) return product.weightKg;
  const fromSize = parseSizeToKg(variant?.size ?? null);
  return fromSize ?? 0;
};

/**
 * Sum qty * unitWeightKg across a list of document lines. Rounds to
 * 2dp the same way the backend does so the live chip and the saved
 * value agree (modulo any actual scale readings folded in later).
 */
export const sumLinesWeightKg = (
  lines: Array<{ productId: string; variantId?: string | null; qty: number }>,
  productById: Map<
    string,
    ProductLike & { variants?: Array<({ id?: string | null } & VariantLike) | null> | null }
  >
): number => {
  let kg = 0;
  for (const ln of lines) {
    const product = productById.get(ln.productId);
    const variant = ln.variantId
      ? product?.variants?.find((v) => v?.id === ln.variantId) ?? null
      : null;
    kg += ln.qty * unitWeightKg(variant, product);
  }
  return Math.round(kg * 100) / 100;
};

/** Display helper: "12.40 kg" or em-dash for null/0/undefined. */
export const fmtKg = (n: number | null | undefined): string => {
  if (n == null || !isFinite(n) || n <= 0) return "—";
  return `${(Math.round(n * 100) / 100).toFixed(2)} kg`;
};
