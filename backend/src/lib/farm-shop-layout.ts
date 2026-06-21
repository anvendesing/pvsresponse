/**
 * Physical bin layout for Farm Shop warehouse.
 *
 * Zone A only — 25 shelves, 119 bins.
 * Compact barcodes: FSH.AS01.06
 */

export const FARM_SHOP_WAREHOUSE_CODE = "WH-FARM";
export const FARM_SHOP_NAME = "Farm Shop";
/** 3-letter scan prefix for compact barcodes. */
export const FARM_SHOP_SCAN_PREFIX = "FSH";

export type ShelfSpec = { shelf: string; binCount: number };

/** Zone A — 25 shelves, 119 bins. */
export const FARM_SHOP_ZONE_A: readonly ShelfSpec[] = [
  { shelf: "S01", binCount: 6 },
  { shelf: "S02", binCount: 6 },
  { shelf: "S03", binCount: 6 },
  { shelf: "S04", binCount: 4 },
  { shelf: "S05", binCount: 4 },
  { shelf: "S06", binCount: 2 },
  ...Array.from({ length: 6 }, (_, i) => ({
    shelf: `S${String(i + 7).padStart(2, "0")}`,
    binCount: 4,
  })),
  { shelf: "S13", binCount: 2 },
  { shelf: "S14", binCount: 6 },
  { shelf: "S15", binCount: 3 },
  { shelf: "S16", binCount: 6 },
  { shelf: "S17", binCount: 4 },
  { shelf: "S18", binCount: 4 },
  ...Array.from({ length: 7 }, (_, i) => ({
    shelf: `S${String(i + 19).padStart(2, "0")}`,
    binCount: 6,
  })),
];

export function farmShopBinRows(): Array<{
  zone: string;
  shelf: string;
  bin: string;
}> {
  const rows: Array<{ zone: string; shelf: string; bin: string }> = [];
  for (const spec of FARM_SHOP_ZONE_A) {
    for (let i = 1; i <= spec.binCount; i++) {
      rows.push({
        zone: "A",
        shelf: spec.shelf,
        bin: String(i).padStart(2, "0"),
      });
    }
  }
  return rows;
}

export const FARM_SHOP_ZONE_A_BIN_COUNT = FARM_SHOP_ZONE_A.reduce(
  (n, s) => n + s.binCount,
  0
);
export const FARM_SHOP_BIN_COUNT = farmShopBinRows().length;
