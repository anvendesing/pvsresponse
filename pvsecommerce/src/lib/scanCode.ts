/** Barcode shown on labels — variant first, then parent product. */
export const lineBarcode = (item: {
  barcode?: string | null;
  variantBarcode?: string | null;
  productBarcode?: string | null;
}): string | null => {
  const bc =
    item.barcode?.trim() ||
    item.variantBarcode?.trim() ||
    item.productBarcode?.trim() ||
    null;
  return bc || null;
};
