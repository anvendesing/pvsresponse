/**
 * Shelf layouts for storage godowns / rooms.
 *
 * Godowns are labelled and scanned at **shelf** level (not bin).
 * Compact shelf codes: <scanPrefix>.<zone><shelf>  e.g. DTE.AS05
 *
 * Bins are created when stock is saved at zone / shelf / bin level.
 * Scanning rolls up quantities at each level (zone includes all shelves and bins).
 */

export type ShelfZoneSpec = { zone: string; shelfCount: number };

export type GodownLayout = {
  code: string;
  name: string;
  scanPrefix: string;
  kind: "storage";
  zones: readonly ShelfZoneSpec[];
};

/** Physical shelves in the layout (no bin segment). */
export function shelfRows(
  zones: readonly ShelfZoneSpec[]
): Array<{ zone: string; shelf: string }> {
  const rows: Array<{ zone: string; shelf: string }> = [];
  for (const { zone, shelfCount } of zones) {
    for (let i = 1; i <= shelfCount; i++) {
      rows.push({
        zone: zone.toUpperCase(),
        shelf: `S${String(i).padStart(2, "0")}`,
      });
    }
  }
  return rows;
}

/** @deprecated Use shelfRows — godowns no longer seed placeholder bins. */
export function shelfBinRows(
  zones: readonly ShelfZoneSpec[]
): Array<{ zone: string; shelf: string; bin: string }> {
  return shelfRows(zones).map((r) => ({ ...r, bin: "01" }));
}

export const GODOWN_LAYOUTS: readonly GodownLayout[] = [
  {
    code: "WH-DATE",
    name: "Date Room",
    scanPrefix: "DTE",
    kind: "storage",
    zones: [{ zone: "A", shelfCount: 16 }],
  },
  {
    code: "WH-STOR",
    name: "Big Godown",
    scanPrefix: "BGD",
    kind: "storage",
    zones: [
      { zone: "A", shelfCount: 40 },
      { zone: "B", shelfCount: 14 },
      { zone: "C", shelfCount: 8 },
    ],
  },
  {
    code: "WH-GLASS",
    name: "Glass Bottle Room",
    scanPrefix: "GLS",
    kind: "storage",
    zones: [{ zone: "A", shelfCount: 14 }],
  },
  {
    code: "WH-STO-MILLETS",
    name: "Millets Room",
    scanPrefix: "MLT",
    kind: "storage",
    zones: [{ zone: "A", shelfCount: 12 }],
  },
  {
    code: "WH-GDNW",
    name: "New Godown",
    scanPrefix: "GDW",
    kind: "storage",
    zones: [{ zone: "A", shelfCount: 28 }],
  },
] as const;

export function godownLayoutByCode(code: string): GodownLayout | undefined {
  return GODOWN_LAYOUTS.find((g) => g.code === code);
}

export function allGodownShelfRows(): Array<{
  layout: GodownLayout;
  zone: string;
  shelf: string;
}> {
  const out: Array<{
    layout: GodownLayout;
    zone: string;
    shelf: string;
  }> = [];
  for (const layout of GODOWN_LAYOUTS) {
    for (const row of shelfRows(layout.zones)) {
      out.push({ layout, ...row });
    }
  }
  return out;
}

export const GODOWN_SHELF_LABEL_COUNT = allGodownShelfRows().length;
