/**
 * Stock Room (WH-FG) — renamed from Finished Goods Hub.
 *
 * Four zones (A–D). Zone C is fully mapped below; A, B, D reserved.
 * Compact scan codes: STR.CS05.11 (prefix STR + zone C + shelf S05 + bin 11).
 */

export const STOCK_ROOM_WAREHOUSE_CODE = "WH-FG";
export const STOCK_ROOM_NAME = "Stock Room";
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

export const STOCK_ROOM_ZONE_A: readonly ShelfSpec[] = [];
export const STOCK_ROOM_ZONE_B: readonly ShelfSpec[] = [];
export const STOCK_ROOM_ZONE_D: readonly ShelfSpec[] = [];

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

export const STOCK_ROOM_ZONE_C_BIN_COUNT = STOCK_ROOM_ZONE_C.reduce(
  (n, s) => n + s.binCount,
  0
);
export const STOCK_ROOM_BIN_COUNT = stockRoomBinRows().length;
