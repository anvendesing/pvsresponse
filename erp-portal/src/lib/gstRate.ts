/** Effective GST % for a product line (variant override → product → fallback). */
export function effectiveGstRate(
  product: { gstRate?: number | null },
  variant?: { gstRate?: number | null } | null,
  fallback = 18
): number {
  if (variant != null && variant.gstRate != null) return variant.gstRate;
  if (product.gstRate != null) return product.gstRate;
  return fallback;
}
