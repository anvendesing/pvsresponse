/** Sellable line UoM: variant selling unit, else pc for variants, else parent bulk. */
export const lineItemUom = (
  product: { uom: string },
  variant?: { uom?: string | null } | null
): string => {
  const v = (variant?.uom ?? "").trim();
  if (v.length > 0) return v;
  if (variant) return "pc";
  return product.uom;
};

/** Scannable / customer-facing code: variant barcode, else variant SKU, else product barcode/SKU. */
export const lineItemCode = (
  product: { sku: string; barcode?: string | null },
  variant?: { sku: string; barcode?: string | null } | null
): string => {
  if (variant) {
    const bc = (variant.barcode ?? "").trim();
    return bc || variant.sku;
  }
  const bc = (product.barcode ?? "").trim();
  return bc || product.sku;
};

export const variantAttrsLine = (
  variant?: { size?: string | null; color?: string | null; grade?: string | null } | null
): string =>
  variant
    ? [variant.size, variant.color, variant.grade]
        .filter((x) => x && String(x).trim())
        .join(" · ")
    : "";
