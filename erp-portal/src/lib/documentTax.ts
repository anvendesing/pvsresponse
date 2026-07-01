export type TaxKind = "intra" | "inter";

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
  unitRateExTax: number;
}

export interface DocumentTaxResult {
  subTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  tax: number;
  transportCharge: number;
  transportTax: number;
  transportTaxLine: Omit<LineTax, "unitRateExTax">;
  roundOff: number;
  total: number;
  lineResults: LineTax[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export const sumGrossLineAmounts = (
  items: Pick<LineInput, "qty" | "rate" | "discount">[]
): number =>
  round2(
    items.reduce(
      (s, l) => s + round2(l.qty * l.rate * (1 - (l.discount ?? 0) / 100)),
      0
    )
  );

export const computeGoodsRoundOff = (
  items: Pick<LineInput, "qty" | "rate" | "discount">[],
  subTotal: number,
  goodsTax: number,
  pricingInclusive: boolean
): number => {
  if (!pricingInclusive) return 0;
  return round2(sumGrossLineAmounts(items) - subTotal - goodsTax);
};

export const splitTaxOnTaxable = (
  taxableValue: number,
  gstRate: number,
  taxKind: TaxKind
): Pick<LineTax, "cgst" | "sgst" | "igst"> => {
  if (gstRate <= 0 || taxableValue <= 0) return { cgst: 0, sgst: 0, igst: 0 };
  if (taxKind === "inter") {
    const igst = round2(taxableValue * (gstRate / 100));
    return { cgst: 0, sgst: 0, igst };
  }
  const component = round2(taxableValue * (gstRate / 2 / 100));
  return { cgst: component, sgst: component, igst: 0 };
};

export const splitTaxAmount = (
  totalTax: number,
  taxKind: TaxKind
): Pick<LineTax, "cgst" | "sgst" | "igst"> => {
  const tax = round2(totalTax);
  if (tax <= 0) return { cgst: 0, sgst: 0, igst: 0 };
  if (taxKind === "inter") return { cgst: 0, sgst: 0, igst: tax };
  const half = round2(tax / 2);
  return { cgst: half, sgst: tax - half, igst: 0 };
};

export const computeLineTax = (
  line: LineInput,
  opts: { inclusive: boolean; taxKind: TaxKind }
): LineTax => {
  const discount = line.discount ?? 0;
  const grossLine = round2(line.qty * line.rate * (1 - discount / 100));
  const gstRate = line.gstRate;

  let taxableValue: number;

  if (opts.inclusive && gstRate > 0) {
    taxableValue = round2(grossLine / (1 + gstRate / 100));
  } else {
    taxableValue = grossLine;
  }

  const split = splitTaxOnTaxable(taxableValue, gstRate, opts.taxKind);
  const totalTax = round2(split.cgst + split.sgst + split.igst);
  const unitRateExTax =
    line.qty > 0 ? round2(taxableValue / line.qty) : line.rate;

  return {
    taxableValue,
    ...split,
    totalTax,
    gross: round2(taxableValue + totalTax),
    unitRateExTax,
  };
};

export const aggregateLineTaxes = (lines: Omit<LineTax, "unitRateExTax">[]) => {
  const subTotal = round2(lines.reduce((s, l) => s + l.taxableValue, 0));
  const cgstTotal = round2(lines.reduce((s, l) => s + l.cgst, 0));
  const sgstTotal = round2(lines.reduce((s, l) => s + l.sgst, 0));
  const igstTotal = round2(lines.reduce((s, l) => s + l.igst, 0));
  const tax = round2(cgstTotal + sgstTotal + igstTotal);
  return { subTotal, cgstTotal, sgstTotal, igstTotal, tax };
};

export const computeTransportTax = (
  charge: number,
  taxKind: TaxKind = "intra",
  gstEnabled = true
) => {
  if (charge <= 0 || !gstEnabled) {
    return { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0, gross: 0 };
  }
  const line = computeLineTax({ qty: 1, rate: charge, gstRate: 18 }, { inclusive: false, taxKind });
  const { unitRateExTax: _u, ...rest } = line;
  return rest;
};

export const computeDocumentTax = (input: {
  items: LineInput[];
  transportCharge?: number;
  pricingInclusive: boolean;
  taxKind: TaxKind;
  transportGstEnabled?: boolean;
}): DocumentTaxResult => {
  const transportCharge = input.transportCharge ?? 0;
  const opts = { inclusive: input.pricingInclusive, taxKind: input.taxKind };
  const lineResults = input.items.map((item) => computeLineTax(item, opts));
  const agg = aggregateLineTaxes(lineResults);
  const transportTaxLine = computeTransportTax(
    transportCharge,
    input.taxKind,
    input.transportGstEnabled ?? true
  );
  const roundOff = computeGoodsRoundOff(
    input.items,
    agg.subTotal,
    agg.tax,
    input.pricingInclusive
  );
  const total = round2(
    agg.subTotal + agg.tax + roundOff + transportCharge + transportTaxLine.totalTax
  );
  return {
    ...agg,
    transportCharge,
    transportTax: transportTaxLine.totalTax,
    transportTaxLine,
    roundOff,
    total,
    lineResults,
  };
};

export const isInterState = (
  sellerState?: string | null,
  placeOfSupply?: string | null
): boolean => {
  const seller = sellerState?.trim().toLowerCase();
  const pos = placeOfSupply?.trim().toLowerCase();
  if (!seller || !pos) return false;
  return seller !== pos;
};

export const resolveTaxKind = (
  sellerState?: string | null,
  placeOfSupply?: string | null
): TaxKind => (isInterState(sellerState, placeOfSupply) ? "inter" : "intra");
