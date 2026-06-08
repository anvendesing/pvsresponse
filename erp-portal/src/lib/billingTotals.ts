/** Mirrors backend `computeTransportTax` / `computeGrandTotal` in tax.ts. */
export const TRANSPORT_GST_RATE = 18;

export const computeTransportTax = (charge: number): number =>
  Math.round(charge * (TRANSPORT_GST_RATE / 100) * 100) / 100;

export interface BillingTotals {
  goodsSubTotal: number;
  goodsTax: number;
  transportCharge: number;
  transportTax: number;
  grandTotal: number;
}

/** Build a transparent goods + freight breakdown; grand total always includes freight GST. */
export const resolveBillingTotals = (input: {
  goodsSubTotal?: number;
  subTotal?: number;
  goodsTax?: number;
  tax?: number;
  transportCharge?: number;
  transportTax?: number;
  total?: number;
}): BillingTotals => {
  const goodsSubTotal = input.goodsSubTotal ?? input.subTotal ?? 0;
  const goodsTax = input.goodsTax ?? input.tax ?? 0;
  const transportCharge = input.transportCharge ?? 0;
  const transportTax =
    input.transportTax ?? (transportCharge > 0 ? computeTransportTax(transportCharge) : 0);
  const computedGrand = goodsSubTotal + goodsTax + transportCharge + transportTax;
  // When freight is on the document, trust the component sum (guards stale header totals).
  const grandTotal =
    transportCharge > 0 || transportTax > 0 ? computedGrand : (input.total ?? computedGrand);
  return { goodsSubTotal, goodsTax, transportCharge, transportTax, grandTotal };
};

export const sumLineAmounts = (items: { amount: number }[]): number =>
  items.reduce((s, it) => s + it.amount, 0);
