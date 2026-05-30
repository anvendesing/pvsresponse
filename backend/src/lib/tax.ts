/**
 * GST computation helpers and variant code generators.
 *
 * Design decisions:
 *  - A single numeric `gstRate` (%) lives on Product; ProductVariant may
 *    override it. This mirrors the price-override pattern already used.
 *  - Tax is expressed as a single combined GST line (not CGST/SGST/IGST split).
 *  - All rounding is paise-level (Math.round to 2 decimal places), which is
 *    standard under the GST framework.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface GstResolvable {
  gstRate: number;
}

export interface GstVariantResolvable {
  gstRate?: number | null;
}

export interface TaxLine {
  amount: number;
  gstRate: number;
}

// ── Rate resolution ─────────────────────────────────────────────────────────

/**
 * Returns the effective GST rate for a line item.
 * Variant rate overrides the product rate when non-null.
 */
export const resolveGstRate = (
  product: GstResolvable,
  variant?: GstVariantResolvable | null
): number => {
  if (variant != null && variant.gstRate != null) return variant.gstRate;
  return product.gstRate;
};

// ── Tax computation ─────────────────────────────────────────────────────────

/**
 * Computes the per-line tax amount (2 decimal place precision).
 */
export const lineTax = (amount: number, gstRate: number): number =>
  Math.round(amount * (gstRate / 100) * 100) / 100;

/**
 * Sums tax across all lines and returns a rounded total.
 * Use this to build the document-level `tax` field.
 */
export const computeTax = (lines: TaxLine[]): number =>
  Math.round(lines.reduce((sum, l) => sum + lineTax(l.amount, l.gstRate), 0) * 100) / 100;

// ── Code generators ─────────────────────────────────────────────────────────

/**
 * Generates a unique variant SKU that does not collide with any string in
 * `existingSkus`. Appends a numeric suffix (-V01, -V02 …) to the parent SKU.
 */
export const generateVariantSku = (
  parentSku: string,
  existingSkus: ReadonlySet<string>
): string => {
  let n = 1;
  let candidate: string;
  do {
    candidate = `${parentSku}-V${String(n).padStart(2, "0")}`;
    n++;
  } while (existingSkus.has(candidate));
  return candidate;
};

/**
 * Generates a unique barcode for a variant. Uses the parent barcode as the
 * stem with a -V01 … suffix, guaranteeing no collision with `existingBarcodes`.
 */
export const generateVariantBarcode = (
  parentBarcode: string,
  existingBarcodes: ReadonlySet<string>
): string => {
  let n = 1;
  let candidate: string;
  do {
    candidate = `${parentBarcode}-V${String(n).padStart(2, "0")}`;
    n++;
  } while (existingBarcodes.has(candidate));
  return candidate;
};
