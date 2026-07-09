import type { Bin } from "@/data/types";

const PLACEHOLDER_ZONES = new Set(["_", "WH"]);
const PLACEHOLDER_SHELF = "00";
const PLACEHOLDER_BIN = "00";

export const isPlaceholderZone = (z: string) => PLACEHOLDER_ZONES.has(z);
export const isPlaceholderShelf = (s: string) => s === PLACEHOLDER_SHELF;
export const isPlaceholderBin = (b: string) => b === PLACEHOLDER_BIN;

export const zoneLabel = (zone: string) =>
  isPlaceholderZone(zone) ? "Warehouse level" : `Zone ${zone}`;

export const shelfTitle = (zone: string, shelf: string) => {
  if (!isPlaceholderShelf(shelf)) return shelf;
  if (!isPlaceholderZone(zone)) return "Zone level";
  return "Warehouse level";
};

export const binDisplayLabel = (b: Bin) => {
  if (!isPlaceholderBin(b.bin)) return b.bin;
  if (!isPlaceholderShelf(b.shelf)) return b.shelf;
  if (!isPlaceholderZone(b.zone)) return b.zone;
  return b.warehouse;
};

/** Units physically in the bin — qty is authoritative; occupied is a legacy hint. */
export const binUsedUnits = (b: Bin): number =>
  Math.max(b.qty ?? 0, b.occupied ?? 0);

/** Fill % for one bin (0–100), capped when stock exceeds nominal capacity. */
export const binFillPct = (b: Bin): number => {
  const used = binUsedUnits(b);
  if (used <= 0) return 0;
  const cap = b.capacity > 0 ? b.capacity : 100;
  return Math.min(100, Math.round((used / cap) * 100));
};

/** Capacity-weighted fill % across all bins on a shelf. */
export const shelfFillPct = (bins: Bin[]): number => {
  if (bins.length === 0) return 0;
  let totalCap = 0;
  let totalUsed = 0;
  for (const b of bins) {
    totalCap += b.capacity > 0 ? b.capacity : 100;
    totalUsed += binUsedUnits(b);
  }
  if (totalUsed <= 0) return 0;
  return Math.min(100, Math.round((totalUsed / totalCap) * 100));
};

export interface ShelfGroup {
  key: string;
  warehouse: string;
  warehouseName?: string;
  zone: string;
  zoneLabel: string;
  shelf: string;
  shelfLabel: string;
  bins: Bin[];
  occupiedBins: number;
  totalQty: number;
  avgOccupancyPct: number;
}

export const groupBinsByShelf = (bins: Bin[]): ShelfGroup[] => {
  const map = new Map<string, ShelfGroup>();

  for (const b of bins) {
    const zone = isPlaceholderZone(b.zone) ? "" : b.zone;
    const shelf = isPlaceholderShelf(b.shelf) ? "" : b.shelf;
    const key = `${b.warehouse}|${zone}|${shelf}`;

    let group = map.get(key);
    if (!group) {
      group = {
        key,
        warehouse: b.warehouse,
        warehouseName: b.warehouseName,
        zone,
        zoneLabel: zoneLabel(zone || b.zone),
        shelf,
        shelfLabel: shelfTitle(zone || b.zone, shelf || b.shelf),
        bins: [],
        occupiedBins: 0,
        totalQty: 0,
        avgOccupancyPct: 0,
      };
      map.set(key, group);
    }

    group.bins.push(b);
    if ((b.qty ?? 0) > 0) group.occupiedBins += 1;
    group.totalQty += b.qty ?? 0;
  }

  const groups = [...map.values()];
  for (const g of groups) {
    g.bins.sort((a, b) =>
      `${a.bin}`.localeCompare(`${b.bin}`, undefined, { numeric: true })
    );
    if (g.bins.length === 0) {
      g.avgOccupancyPct = 0;
      continue;
    }
    g.avgOccupancyPct = shelfFillPct(g.bins);
  }

  return groups.sort((a, b) => {
    if (a.warehouse !== b.warehouse) return a.warehouse.localeCompare(b.warehouse);
    if (a.zone !== b.zone) {
      if (a.zone === "") return 1;
      if (b.zone === "") return -1;
      return a.zone.localeCompare(b.zone);
    }
    if (a.shelf !== b.shelf) {
      if (a.shelf === "") return 1;
      if (b.shelf === "") return -1;
      return a.shelf.localeCompare(b.shelf, undefined, { numeric: true });
    }
    return 0;
  });
};

export const shelfMatchesFilter = (group: ShelfGroup, q: string): boolean => {
  const needle = q.toLowerCase();
  if (group.shelfLabel.toLowerCase().includes(needle)) return true;
  if (group.zoneLabel.toLowerCase().includes(needle)) return true;
  if (group.warehouse.toLowerCase().includes(needle)) return true;
  return group.bins.some(
    (b) =>
      b.bin.toLowerCase().includes(needle) ||
      (b.productSku?.toLowerCase().includes(needle) ?? false) ||
      (b.productName?.toLowerCase().includes(needle) ?? false) ||
      (b.variantSku?.toLowerCase().includes(needle) ?? false)
  );
};
