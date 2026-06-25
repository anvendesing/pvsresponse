/**
 * Grain / millet milling — raw → semi (mill) → bulk FG (manual clean) → retail pack.
 */

export const MILL_FACILITY_CODE = "WC-MILL";
export const MILL_LINE_CODE = "WC-MILL-MAIN";
export const MILL_WH_CODE = "WH-PROD-MILL";

export const MANUAL_CLEAN_FACILITY_CODE = "WC-MCLEAN";
export const MANUAL_CLEAN_LINE_CODE = "WC-MCLEAN-MAIN";
export const MANUAL_CLEAN_WH_CODE = "WH-PROD-MCLEAN";

export const BIG_GODOWN_CODE = "WH-STOR";
export const STOCK_ROOM_CODE = "STR";

export const MILL_BOM_REVISION = "Rev-Grain-Mill-1.0";
export const CLEAN_BOM_REVISION = "Rev-Grain-Clean-1.0";

export const MILL_WASTE_SKU = "MILL-WASTE";
export const MILL_BROKEN_SKU = "MILL-BROKEN";

/** Default batch: 100 kg raw → 70 kg semi (override per product in seed). */
export const DEFAULT_RAW_KG = 100;
export const DEFAULT_SEMI_KG = 70;
export const DEFAULT_WASTE_KG = 15;
export const DEFAULT_BROKEN_KG = 15;

export function semiProductSku(finishedSku: string): string {
  return `${finishedSku.trim().toUpperCase()}-SEMI`;
}

export function rawProductSku(finishedSku: string): string {
  const sku = finishedSku.trim().toUpperCase();
  return sku.startsWith("R") ? sku : `R${sku}`;
}

export const MILL_OPERATIONS = [
  {
    seq: 1,
    name: "De-stoning",
    description: "Remove stones and foreign matter from raw grain.",
    durationMinutes: 45,
    requiresQa: false,
  },
  {
    seq: 2,
    name: "Dust removal",
    description: "Run through dust machine; collect fines as waste.",
    durationMinutes: 30,
    requiresQa: false,
    blockedBySeq: 1,
  },
  {
    seq: 3,
    name: "Hulling",
    description: "Hulling machine — husk to waste, broken grains separated.",
    durationMinutes: 60,
    requiresQa: true,
    blockedBySeq: 2,
  },
  {
    seq: 4,
    name: "Rice machine",
    description: "Polish / grade; semi-finished grain to mill FG staging.",
    durationMinutes: 90,
    requiresQa: true,
    blockedBySeq: 3,
  },
] as const;

export const CLEAN_OPERATION = {
  seq: 1,
  name: "Manual cleaning & grading",
  description:
    "Hand-pick impurities; grade semi-FG to bulk finished grain before Stock Room packing.",
  durationMinutes: 120,
  requiresQa: true,
} as const;

/** Staging bin slots inside production warehouses (from ops:warehouses). */
export const WH_BIN = {
  lineStaging: { zone: "LINE", shelf: "01", bin: "01" },
  fgStaging: { zone: "FG", shelf: "01", bin: "01" },
} as const;
