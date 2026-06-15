// Variant / product gross-weight helpers.
//
// Multi-container packing rolls up `qty * unitWeightKg + container.tareKg`
// into PackingContainer.estWeightKg, which in turn feeds the dispatch
// weight + trip load. To avoid asking the operator to maintain weights
// by hand we (a) seed sensible defaults by parsing the variant `size`
// string ("500 ml", "5 kg", "1 L"...), and (b) let admins override on
// the catalogue editor (ProductEditor → "Per-unit weight (kg)").
//
// `parseSizeToKg` is the source of truth for the seed; the backfill
// script and the runtime estimator both call it. It deliberately
// returns null for sizes it can't interpret (e.g. "1 pc", "1 set",
// rubber bands, cables) — the caller treats null as "0 kg contribution
// to the estimate, packer will key in the actual scale reading".

const LITRE_DENSITY_KG_PER_L: Record<string, number> = {
  // Indian-SMB cooking-oil densities (close enough for trip planning,
  // not for trade settlement). Falls back to 0.92 (typical edible oil).
  default: 0.92,
};

/**
 * Best-effort parse of a free-form size string to a per-unit weight in kg.
 * Returns null when the string has no recognisable mass / volume token,
 * so the caller can treat the contribution as zero rather than guessing.
 *
 * Examples:
 *   "500 ml"  -> 0.46  (using 0.92 kg/l default density)
 *   "5 L"     -> 4.6
 *   "1 kg"    -> 1
 *   "200 g"   -> 0.2
 *   "100 gms" -> 0.1
 *   "1 pc"    -> null
 */
export const parseSizeToKg = (
  raw: string | null | undefined,
  density: number = LITRE_DENSITY_KG_PER_L.default
): number | null => {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  // Mass first (unambiguous).
  const kgMatch = t.match(/([\d.]+)\s*kg\b/);
  if (kgMatch) return parseFloat(kgMatch[1]);
  const gMatch = t.match(/([\d.]+)\s*(gms?|g)\b/);
  if (gMatch) return parseFloat(gMatch[1]) / 1000;
  // Volume - convert via density.
  const lMatch = t.match(/([\d.]+)\s*(ltr|lit|l)\b/);
  if (lMatch) return parseFloat(lMatch[1]) * density;
  const mlMatch = t.match(/([\d.]+)\s*ml\b/);
  if (mlMatch) return (parseFloat(mlMatch[1]) / 1000) * density;
  return null;
};

/**
 * Resolve the per-unit weight (kg) for an item, preferring the variant
 * override, then the parent product, then a fallback size parse. Returns
 * 0 (not null) when nothing matches so callers can sum freely.
 */
export const unitWeightKg = (
  variant: { weightKg?: number | null; size?: string | null } | null | undefined,
  product: { weightKg?: number | null } | null | undefined
): number => {
  if (variant?.weightKg != null) return variant.weightKg;
  if (product?.weightKg != null) return product.weightKg;
  const fromSize = parseSizeToKg(variant?.size ?? null);
  return fromSize ?? 0;
};
