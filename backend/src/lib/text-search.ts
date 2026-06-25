export const normalizeSearchTerm = (raw: string): string => raw.trim().toLowerCase();

export const textIncludes = (
  hay: string | null | undefined,
  needle: string
): boolean => (hay ?? "").toLowerCase().includes(needle);

type ProductSearchRow = {
  name: string;
  sku: string;
  barcode: string;
  category?: { name: string } | null;
  variants: Array<{
    sku: string;
    barcode: string | null;
    size?: string | null;
    color?: string | null;
    grade?: string | null;
  }>;
};

export const productMatchesQuery = (p: ProductSearchRow, needle: string): boolean =>
  textIncludes(p.name, needle) ||
  textIncludes(p.sku, needle) ||
  textIncludes(p.barcode, needle) ||
  textIncludes(p.category?.name, needle) ||
  p.variants.some(
    (v) =>
      textIncludes(v.sku, needle) ||
      textIncludes(v.barcode, needle) ||
      textIncludes(v.size, needle) ||
      textIncludes(v.color, needle) ||
      textIncludes(v.grade, needle)
  );

export const codesEqual = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();
