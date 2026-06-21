/**
 * Stock Room — short warehouse code STR (legacy WH-FG).
 *
 * Four zones (A–D). Zones A, B, C mapped below; D reserved.
 * Compact bin barcodes: STR.CS05.11
 */

/** Canonical warehouse code (Settings → Warehouses). */
export const STOCK_ROOM_WAREHOUSE_CODE = "STR";
/** Previous code before Stock Room rename — migrated by seed script. */
export const LEGACY_STOCK_ROOM_WH_CODE = "WH-FG";
export const STOCK_ROOM_NAME = "Stock Room";
/** Scan prefix for compact bin codes (same as warehouse code). */
export const STOCK_ROOM_SCAN_PREFIX = "STR";

export type ShelfSpec = { shelf: string; binCount: number };

/** Zone C — 31 shelves, 145 bins. */
export const STOCK_ROOM_ZONE_C: readonly ShelfSpec[] = [
  ...Array.from({ length: 4 }, (_, i) => ({
    shelf: `S${String(i + 1).padStart(2, "0")}`,
    binCount: 5,
  })),
  { shelf: "S05", binCount: 10 },
  ...Array.from({ length: 7 }, (_, i) => ({
    shelf: `S${String(i + 6).padStart(2, "0")}`,
    binCount: 5,
  })),
  { shelf: "S13", binCount: 6 },
  { shelf: "S14", binCount: 6 },
  { shelf: "S15", binCount: 5 },
  { shelf: "S16", binCount: 5 },
  { shelf: "S17", binCount: 5 },
  { shelf: "S18", binCount: 5 },
  { shelf: "S19", binCount: 4 },
  { shelf: "S20", binCount: 4 },
  { shelf: "S21", binCount: 2 },
  { shelf: "S22", binCount: 2 },
  ...Array.from({ length: 4 }, (_, i) => ({
    shelf: `S${String(i + 23).padStart(2, "0")}`,
    binCount: 4,
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    shelf: `S${String(i + 27).padStart(2, "0")}`,
    binCount: 3,
  })),
  { shelf: "S31", binCount: 8 },
];

/** Zone A — 6 shelves, 29 bins. */
export const STOCK_ROOM_ZONE_A: readonly ShelfSpec[] = [
  { shelf: "S01", binCount: 6 },
  { shelf: "S02", binCount: 6 },
  { shelf: "S03", binCount: 6 },
  { shelf: "S04", binCount: 4 },
  { shelf: "S05", binCount: 3 },
  { shelf: "S06", binCount: 4 },
];

/** Zone B — 18 shelves, 103 bins. */
export const STOCK_ROOM_ZONE_B: readonly ShelfSpec[] = [
  { shelf: "S01", binCount: 5 },
  { shelf: "S02", binCount: 5 },
  { shelf: "S03", binCount: 6 },
  { shelf: "S04", binCount: 5 },
  { shelf: "S05", binCount: 6 },
  { shelf: "S06", binCount: 6 },
  { shelf: "S07", binCount: 6 },
  ...Array.from({ length: 5 }, (_, i) => ({
    shelf: `S${String(i + 8).padStart(2, "0")}`,
    binCount: 4,
  })),
  { shelf: "S13", binCount: 8 },
  { shelf: "S14", binCount: 6 },
  { shelf: "S15", binCount: 7 },
  { shelf: "S16", binCount: 5 },
  { shelf: "S17", binCount: 13 },
  { shelf: "S18", binCount: 5 },
];

export const STOCK_ROOM_ZONE_D: readonly ShelfSpec[] = [];

export function shelfNumber(shelf: string): number {
  return parseInt(shelf.replace(/^S/i, ""), 10) || 0;
}

/** Label print set: zone B from S17 onward, then all zone A bins. */
export function stockRoomPrintSet_B_S17_through_A(): Array<{
  zone: string;
  shelf: string;
  bin: string;
}> {
  const rows = stockRoomBinRows();
  const bTail = rows.filter((r) => r.zone === "B" && shelfNumber(r.shelf) >= 17);
  const aAll = rows.filter((r) => r.zone === "A");
  return [...bTail, ...aAll];
}

export const STOCK_ROOM_PRINT_SET_B_S17_A_COUNT = stockRoomPrintSet_B_S17_through_A().length;

export function stockRoomBinRows(): Array<{
  zone: string;
  shelf: string;
  bin: string;
}> {
  const rows: Array<{ zone: string; shelf: string; bin: string }> = [];
  const zones: Array<{ zone: string; shelves: readonly ShelfSpec[] }> = [
    { zone: "A", shelves: STOCK_ROOM_ZONE_A },
    { zone: "B", shelves: STOCK_ROOM_ZONE_B },
    { zone: "C", shelves: STOCK_ROOM_ZONE_C },
    { zone: "D", shelves: STOCK_ROOM_ZONE_D },
  ];
  for (const { zone, shelves } of zones) {
    for (const spec of shelves) {
      for (let i = 1; i <= spec.binCount; i++) {
        rows.push({
          zone,
          shelf: spec.shelf,
          bin: String(i).padStart(2, "0"),
        });
      }
    }
  }
  return rows;
}

export const STOCK_ROOM_ZONE_A_BIN_COUNT = STOCK_ROOM_ZONE_A.reduce(
  (n, s) => n + s.binCount,
  0
);
export const STOCK_ROOM_ZONE_C_BIN_COUNT = STOCK_ROOM_ZONE_C.reduce(
  (n, s) => n + s.binCount,
  0
);
export const STOCK_ROOM_ZONE_B_BIN_COUNT = STOCK_ROOM_ZONE_B.reduce(
  (n, s) => n + s.binCount,
  0
);
export const STOCK_ROOM_BIN_COUNT = stockRoomBinRows().length;
