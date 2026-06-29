/**
 * GST computation helpers and variant code generators.
 *
 * Design decisions:
 *  - A numeric `gstRate` (%) lives on Product; ProductVariant may override it.
 *  - Intra-state (same seller + place-of-supply) → CGST + SGST (rate/2 each).
 *  - Inter-state → IGST (full rate).
 *  - When `pricingIncludesGst` is ON, entered rates are treated as GST-inclusive;
 *    taxable value is back-calculated before tax split.
 *  - All rounding is paise-level (Math.round to 2 decimal places).
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type TaxKind = "intra" | "inter";

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

export interface LineInput {
  qty: number;
  rate: number;
  discount?: number;
  gstRate: number;
}

export interface LineTax {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  gross: number;
}

export interface DocumentTaxTotals {
  subTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  tax: number;
  lines: LineTax[];
}

export interface TaxContext {
  sellerState: string | null;
  placeOfSupplyState: string | null;
  pricingInclusive: boolean;
  defaultGstRate?: number;
}

// GST on freight / goods transport agency services (SAC 9965) in India.
export const TRANSPORT_GST_RATE = 18;

const round2 = (n: number): number => Math.round(n * 100) / 100;

export const isInterState = (
  sellerState?: string | null,
  placeOfSupply?: string | null
): boolean => {
  const seller = sellerState?.trim().toLowerCase();
  const pos = placeOfSupply?.trim().toLowerCase();
  if (!seller || !pos) return false;
  return seller !== pos;
};

export const resolveTaxKind = (ctx: Pick<TaxContext, "sellerState" | "placeOfSupplyState">): TaxKind =>
  isInterState(ctx.sellerState, ctx.placeOfSupplyState) ? "inter" : "intra";

/** Split a total tax amount into CGST+SGST (intra) or IGST (inter). */
export const splitTaxAmount = (totalTax: number, taxKind: TaxKind): Pick<LineTax, "cgst" | "sgst" | "igst"> => {
  const tax = round2(totalTax);
  if (tax <= 0) return { cgst: 0, sgst: 0, igst: 0 };
  if (taxKind === "inter") return { cgst: 0, sgst: 0, igst: tax };
  const half = round2(tax / 2);
  return { cgst: half, sgst: tax - half, igst: 0 };
};

/**
 * Computes per-line tax from qty/rate/discount/gstRate.
 * `rate` is the unit price as entered (inclusive or exclusive per opts).
 */
export const computeLineTax = (
  line: LineInput,
  opts: { inclusive: boolean; taxKind: TaxKind }
): LineTax => {
  const discount = line.discount ?? 0;
  const grossLine = round2(line.qty * line.rate * (1 - discount / 100));
  const gstRate = line.gstRate;

  let taxableValue: number;
  let totalTax: number;

  if (opts.inclusive && gstRate > 0) {
    taxableValue = round2(grossLine / (1 + gstRate / 100));
    totalTax = round2(grossLine - taxableValue);
  } else {
    taxableValue = grossLine;
    totalTax = round2(taxableValue * (gstRate / 100));
  }

  const split = splitTaxAmount(totalTax, opts.taxKind);
  return {
    taxableValue,
    ...split,
    totalTax,
    gross: round2(taxableValue + totalTax),
  };
};

/** Sum line taxes into document-level totals. */
export const aggregateLineTaxes = (lines: LineTax[]): DocumentTaxTotals => {
  const subTotal = round2(lines.reduce((s, l) => s + l.taxableValue, 0));
  const cgstTotal = round2(lines.reduce((s, l) => s + l.cgst, 0));
  const sgstTotal = round2(lines.reduce((s, l) => s + l.sgst, 0));
  const igstTotal = round2(lines.reduce((s, l) => s + l.igst, 0));
  const tax = round2(cgstTotal + sgstTotal + igstTotal);
  return { subTotal, cgstTotal, sgstTotal, igstTotal, tax, lines };
};

export const computeTransportTax = (charge: number, taxKind: TaxKind = "intra"): LineTax => {
  if (charge <= 0) {
    return { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0, gross: 0 };
  }
  return computeLineTax(
    { qty: 1, rate: charge, gstRate: TRANSPORT_GST_RATE },
    { inclusive: false, taxKind }
  );
};

/** Grand total = goods subtotal + goods GST + freight + freight GST. */
export const computeGrandTotal = (
  subTotal: number,
  goodsTax: number,
  transportCharge: number,
  taxKind: TaxKind = "intra"
): { transportTax: number; transportCgst: number; transportSgst: number; transportIgst: number; total: number } => {
  const freight = computeTransportTax(transportCharge, taxKind);
  return {
    transportTax: freight.totalTax,
    transportCgst: freight.cgst,
    transportSgst: freight.sgst,
    transportIgst: freight.igst,
    total: round2(subTotal + goodsTax + transportCharge + freight.totalTax),
  };
};

// ── Rate resolution ─────────────────────────────────────────────────────────

/**
 * Returns the effective GST rate for a line item.
 * Variant rate overrides the product rate when non-null.
 */
export const resolveGstRate = (
  product: GstResolvable,
  variant?: GstVariantResolvable | null,
  fallback = 18
): number => {
  if (variant != null && variant.gstRate != null) return variant.gstRate;
  return product.gstRate ?? fallback;
};

// ── Legacy helpers (kept for backwards compat) ──────────────────────────────

/**
 * Computes the per-line tax amount (2 decimal place precision).
 * @deprecated Prefer computeLineTax for new code.
 */
export const lineTax = (amount: number, gstRate: number): number =>
  round2(amount * (gstRate / 100));

/**
 * Sums tax across all lines and returns a rounded total.
 * @deprecated Prefer aggregateLineTaxes for new code.
 */
export const computeTax = (lines: TaxLine[]): number =>
  round2(lines.reduce((sum, l) => sum + lineTax(l.amount, l.gstRate), 0));

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
