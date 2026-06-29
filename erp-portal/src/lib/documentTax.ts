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

const round2 = (n: number): number => Math.round(n * 100) / 100;

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
  let totalTax: number;

  if (opts.inclusive && gstRate > 0) {
    taxableValue = round2(grossLine / (1 + gstRate / 100));
    totalTax = round2(grossLine - taxableValue);
  } else {
    taxableValue = grossLine;
    totalTax = round2(taxableValue * (gstRate / 100));
  }

  const split = splitTaxAmount(totalTax, opts.taxKind);
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

export const aggregateLineTaxes = (lines: LineTax[]) => {
  const subTotal = round2(lines.reduce((s, l) => s + l.taxableValue, 0));
  const cgstTotal = round2(lines.reduce((s, l) => s + l.cgst, 0));
  const sgstTotal = round2(lines.reduce((s, l) => s + l.sgst, 0));
  const igstTotal = round2(lines.reduce((s, l) => s + l.igst, 0));
  const tax = round2(cgstTotal + sgstTotal + igstTotal);
  return { subTotal, cgstTotal, sgstTotal, igstTotal, tax };
};

export const computeTransportTax = (charge: number, taxKind: TaxKind = "intra") =>
  computeLineTax({ qty: 1, rate: charge, gstRate: 18 }, { inclusive: false, taxKind });

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
