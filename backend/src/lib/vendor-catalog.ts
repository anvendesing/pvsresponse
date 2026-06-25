/**
 * Vendor catalog UoM conversion: vendor unit → internal product UoM.
 *
 * packSize on VendorProduct = internal product.uom units per 1 vendorUom.
 * Example: neem oil stored in L, vendor sells 200 L drums → packSize=200.
 */

export type VendorCatalogLine = {
  vendorUom: string;
  packSize: number;
  price: number;
  product: { uom: string };
};

/** Internal qty/rate from vendor ordering qty and catalog pack size. */
export const internalFromVendorQty = (
  vendorQty: number,
  line: Pick<VendorCatalogLine, "packSize">
): number => vendorQty * line.packSize;

/** Internal rate (per product.uom) from vendor rate (per vendorUom). */
export const internalRateFromVendorRate = (
  vendorRate: number,
  line: Pick<VendorCatalogLine, "packSize">
): number => (line.packSize > 0 ? vendorRate / line.packSize : vendorRate);

/** Vendor qty from internal qty (for display on PO). */
export const vendorQtyFromInternal = (
  internalQty: number,
  line: Pick<VendorCatalogLine, "packSize">
): number => (line.packSize > 0 ? internalQty / line.packSize : internalQty);

export const vendorLineLabel = (line: {
  vendorProductCode?: string | null;
  vendorProductName?: string | null;
  vendorUom: string;
  product: { sku: string; name: string; uom: string };
  variant?: { sku: string } | null;
}): string => {
  const name = line.vendorProductName ?? line.product.name;
  const code = line.vendorProductCode ? ` (${line.vendorProductCode})` : "";
  const sku = line.variant?.sku ?? line.product.sku;
  return `${sku} · ${name}${code} · ${line.vendorUom} → ${line.product.uom}`;
};
