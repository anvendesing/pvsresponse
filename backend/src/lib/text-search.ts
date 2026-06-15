export const normalizeSearchTerm = (raw: string): string => raw.trim().toLowerCase();

export const textIncludes = (
  hay: string | null | undefined,
  needle: string
): boolean => (hay ?? "").toLowerCase().includes(needle);

type ProductSearchRow = {
  name: string;
  sku: string;
  barcode: string;
  variants: Array<{ sku: string; barcode: string | null }>;
};

export const productMatchesQuery = (p: ProductSearchRow, needle: string): boolean =>
  textIncludes(p.name, needle) ||
  textIncludes(p.sku, needle) ||
  textIncludes(p.barcode, needle) ||
  p.variants.some(
    (v) => textIncludes(v.sku, needle) || textIncludes(v.barcode, needle)
  );

export const codesEqual = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();
