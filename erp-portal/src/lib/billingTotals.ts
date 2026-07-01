/** Mirrors backend `computeTransportTax` / document tax totals. */
export const TRANSPORT_GST_RATE = 18;

export type TaxKind = "intra" | "inter";

export const computeTransportTax = (
  charge: number,
  taxKind: TaxKind = "intra",
  gstEnabled = true
): number => {
  if (charge <= 0 || !gstEnabled) return 0;
  const tax = Math.round(charge * (TRANSPORT_GST_RATE / 100) * 100) / 100;
  if (taxKind === "inter") return tax;
  return tax;
};

export interface BillingTotals {
  goodsSubTotal: number;
  goodsTax: number;
  cgst: number;
  sgst: number;
  igst: number;
  taxKind: TaxKind;
  transportCharge: number;
  transportTax: number;
  transportCgst: number;
  transportSgst: number;
  transportIgst: number;
  roundOff: number;
  grandTotal: number;
}

const splitStoredTax = (
  tax: number,
  cgst?: number | null,
  sgst?: number | null,
  igst?: number | null,
  taxKind?: TaxKind | null
): Pick<BillingTotals, "cgst" | "sgst" | "igst" | "taxKind"> => {
  const kind: TaxKind = taxKind ?? "intra";
  if (cgst != null || sgst != null || igst != null) {
    return {
      cgst: cgst ?? 0,
      sgst: sgst ?? 0,
      igst: igst ?? 0,
      taxKind: kind,
    };
  }
  if (kind === "inter") return { cgst: 0, sgst: 0, igst: tax, taxKind: kind };
  const half = Math.round((tax / 2) * 100) / 100;
  return { cgst: half, sgst: tax - half, igst: 0, taxKind: kind };
};

const splitFreightTax = (transportTax: number, taxKind: TaxKind) => {
  if (transportTax <= 0) return { transportCgst: 0, transportSgst: 0, transportIgst: 0 };
  if (taxKind === "inter") return { transportCgst: 0, transportSgst: 0, transportIgst: transportTax };
  const half = Math.round((transportTax / 2) * 100) / 100;
  return { transportCgst: half, transportSgst: transportTax - half, transportIgst: 0 };
};

/** Build a transparent goods + freight breakdown; grand total always includes freight GST. */
export const resolveBillingTotals = (input: {
  goodsSubTotal?: number;
  subTotal?: number;
  goodsTax?: number;
  tax?: number;
  cgstTotal?: number | null;
  sgstTotal?: number | null;
  igstTotal?: number | null;
  taxKind?: TaxKind | null;
  transportCharge?: number;
  transportTax?: number;
  transportGstEnabled?: boolean;
  roundOff?: number;
  total?: number;
}): BillingTotals => {
  const goodsSubTotal = input.goodsSubTotal ?? input.subTotal ?? 0;
  const goodsTax = input.goodsTax ?? input.tax ?? 0;
  const transportCharge = input.transportCharge ?? 0;
  const roundOff = input.roundOff ?? 0;
  const split = splitStoredTax(
    goodsTax,
    input.cgstTotal,
    input.sgstTotal,
    input.igstTotal,
    input.taxKind
  );
  const transportTax =
    input.transportTax ??
    (transportCharge > 0
      ? computeTransportTax(transportCharge, split.taxKind, input.transportGstEnabled ?? true)
      : 0);
  const freightSplit = splitFreightTax(transportTax, split.taxKind);
  const computedGrand = goodsSubTotal + goodsTax + roundOff + transportCharge + transportTax;
  const grandTotal =
    transportCharge > 0 || transportTax > 0 || roundOff !== 0
      ? computedGrand
      : (input.total ?? computedGrand);
  return {
    goodsSubTotal,
    goodsTax,
    ...split,
    transportCharge,
    transportTax,
    ...freightSplit,
    roundOff,
    grandTotal,
  };
};

export const sumLineAmounts = (items: { amount: number }[]): number =>
  items.reduce((s, it) => s + it.amount, 0);
