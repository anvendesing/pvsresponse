/** Primary code shown on labels and at POS — barcode when set, else SKU. */
export type ScanCodeLike = {
  // Both are optional so call sites can pass partial API rows (e.g.
  // GraphQL-ish selects where the field wasn't explicitly fetched).
  // Helpers degrade gracefully — empty string and null are the same.
  sku?: string | null;
  barcode?: string | null;
};

export const primaryScanCode = (item: ScanCodeLike): string => {
  const bc = item.barcode?.trim();
  return bc || item.sku?.trim() || "—";
};

/** Billing / invoice line: barcode first, SKU as secondary when they differ. */
export const formatScanRef = (item: ScanCodeLike): string => {
  const primary = primaryScanCode(item);
  const sku = item.sku?.trim();
  if (!sku || primary === sku) return primary;
  return `${primary} · SKU ${sku}`;
};

/** Acceptable scan values for pick/pack validation (uppercased). */
export const scanCodeSet = (items: Array<ScanCodeLike | null | undefined>): Set<string> => {
  const out = new Set<string>();
  for (const item of items) {
    if (!item) continue;
    const add = (c: string | null | undefined) => {
      const t = c?.trim();
      if (t) out.add(t.toUpperCase());
    };
    add(item.sku);
    add(item.barcode);
  }
  return out;
};
