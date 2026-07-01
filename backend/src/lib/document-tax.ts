import {
  aggregateLineTaxes,
  computeGoodsRoundOff,
  computeLineTax,
  computeTransportTax,
  type LineInput,
  type LineTax,
  type TaxContext,
  type TaxKind,
} from "./tax.js";

export interface DocumentTaxInput {
  items: LineInput[];
  transportCharge?: number;
  taxCtx: TaxContext & { taxKind: TaxKind };
}

export interface LineTaxResult extends LineInput, LineTax {
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
  roundOff: number;
  total: number;
  taxKind: TaxKind;
  placeOfSupplyState: string | null;
  sellerState: string | null;
  pricingInclusive: boolean;
  lineResults: LineTaxResult[];
}

export const computeDocumentTax = (input: DocumentTaxInput): DocumentTaxResult => {
  const { items, transportCharge = 0, taxCtx } = input;
  const opts = { inclusive: taxCtx.pricingInclusive, taxKind: taxCtx.taxKind };

  const lineResults: LineTaxResult[] = items.map((item) => {
    const computed = computeLineTax(item, opts);
    const unitRateExTax =
      item.qty > 0 ? Math.round((computed.taxableValue / item.qty) * 100) / 100 : item.rate;
    return { ...item, ...computed, unitRateExTax };
  });

  const agg = aggregateLineTaxes(lineResults);
  const freight = computeTransportTax(
    transportCharge,
    taxCtx.taxKind,
    taxCtx.transportGstEnabled ?? true
  );
  const roundOff = computeGoodsRoundOff(
    items,
    agg.subTotal,
    agg.tax,
    taxCtx.pricingInclusive
  );
  const total = Math.round(
    (agg.subTotal + agg.tax + roundOff + transportCharge + freight.totalTax) * 100
  ) / 100;

  return {
    subTotal: agg.subTotal,
    cgstTotal: agg.cgstTotal,
    sgstTotal: agg.sgstTotal,
    igstTotal: agg.igstTotal,
    tax: agg.tax,
    transportCharge,
    transportTax: freight.totalTax,
    roundOff,
    total,
    taxKind: taxCtx.taxKind,
    placeOfSupplyState: taxCtx.placeOfSupplyState,
    sellerState: taxCtx.sellerState,
    pricingInclusive: taxCtx.pricingInclusive,
    lineResults,
  };
};

export const documentTaxHeaderFields = (doc: DocumentTaxResult) => ({
  subTotal: doc.subTotal,
  tax: doc.tax,
  cgstTotal: doc.cgstTotal,
  sgstTotal: doc.sgstTotal,
  igstTotal: doc.igstTotal,
  taxKind: doc.taxKind,
  placeOfSupplyState: doc.placeOfSupplyState,
  sellerState: doc.sellerState,
  pricingInclusive: doc.pricingInclusive,
  transportCharge: doc.transportCharge,
  transportTax: doc.transportTax,
  roundOff: doc.roundOff,
  total: doc.total,
});

export const lineTaxDbFields = (line: LineTaxResult) => ({
  rate: line.unitRateExTax,
  amount: line.taxableValue,
  taxableValue: line.taxableValue,
  gstRate: line.gstRate,
  taxAmount: line.totalTax,
  cgstAmount: line.cgst,
  sgstAmount: line.sgst,
  igstAmount: line.igst,
});
