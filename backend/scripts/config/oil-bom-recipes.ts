/**
 * Oil extraction — three-BOM model (Rev-Oil-1.0):
 *   1. Extract  — seed → unfiltered semi (+ press cake by-product)
 *   2. Filter   — unfiltered semi → filtered bulk oil (finished parent SKU)
 *   3. Pack     — bulk oil → retail variants (auto Rev-Pack-1.0 on WC-OIL-FILL)
 *
 * Extraction runs in parallel on WC-OIL-EXT-01 … EXT-06 (split MO per line).
 */

export const OIL_FACILITY_CODE = "WC-OIL";

export const OIL_EXTRACT_LINE_CODES = [
  "WC-OIL-EXT-01",
  "WC-OIL-EXT-02",
  "WC-OIL-EXT-03",
  "WC-OIL-EXT-04",
  "WC-OIL-EXT-05",
  "WC-OIL-EXT-06",
] as const;

export const OIL_FILTER_LINE_CODES = [
  "WC-OIL-FLT-01",
  "WC-OIL-FLT-02",
  "WC-OIL-FLT-03",
] as const;

export const OIL_FILL_LINE_CODE = "WC-OIL-FILL";

export const OIL_EXTRACT_BOM_REVISION = "Rev-Oil-Extract-1.0";
export const OIL_FILTER_BOM_REVISION = "Rev-Oil-Filter-1.0";

/** Semi-finished unfiltered oil SKU — one per filtered oil parent. */
export function unfilteredSemiSku(oilSku: string): string {
  return `${oilSku.trim().toUpperCase()}-UNFILT`;
}

export type OilProcessRecipe = {
  key: string;
  /** Finished bulk oil product (also packed into variants). */
  oilSku: string;
  oilName: string;
  /** Seed / oilseed input (catalog SKU, typically kg). */
  seedSku: string;
  seedQty: number;
  /** Unfiltered oil output per extract batch (L). */
  unfilteredOutputQty: number;
  /** Press cake co-product sold at farm-shop POS only. */
  cakeSku?: string;
  cakeQty?: number;
  /** Filtered bulk oil output per filter batch (L). */
  filteredOutputQty: number;
};

/** Seed-press oils only — excludes coconut crude (RAW-COCO-OIL) and infused/essential oils. */
export const OIL_PROCESS_RECIPES: readonly OilProcessRecipe[] = [
  {
    key: "groundnut",
    oilSku: "GOIL",
    oilName: "Groundnut Oil",
    seedSku: "GNSD",
    seedQty: 400,
    unfilteredOutputQty: 100,
    cakeSku: "GCAK",
    cakeQty: 240,
    filteredOutputQty: 98,
  },
  {
    key: "white_gingelly",
    oilSku: "WGO",
    oilName: "White gingelly oil",
    seedSku: "WSS",
    seedQty: 350,
    unfilteredOutputQty: 100,
    cakeSku: "SES",
    cakeQty: 210,
    filteredOutputQty: 98,
  },
  {
    key: "sesame_black",
    oilSku: "SOIL",
    oilName: "Sesame Oil",
    seedSku: "SSB",
    seedQty: 350,
    unfilteredOutputQty: 100,
    cakeSku: "SES",
    cakeQty: 210,
    filteredOutputQty: 98,
  },
  {
    key: "safflower",
    oilSku: "SFOL",
    oilName: "Safflower / Kusuma Oil",
    seedSku: "SFSD",
    seedQty: 400,
    unfilteredOutputQty: 100,
    cakeSku: "SFCK",
    cakeQty: 250,
    filteredOutputQty: 98,
  },
  {
    key: "niger",
    oilSku: "NGOL",
    oilName: "Niger Seed Oil",
    seedSku: "NGSD",
    seedQty: 400,
    unfilteredOutputQty: 100,
    filteredOutputQty: 98,
  },
  {
    key: "mustard",
    oilSku: "MUOL",
    oilName: "Mustard Oil",
    seedSku: "MSTD",
    seedQty: 350,
    unfilteredOutputQty: 100,
    filteredOutputQty: 98,
  },
] as const;

export const OIL_EXTRACT_OPERATION = {
  seq: 1,
  name: "Cold press extract",
  description:
    "Press cleaned seeds on an extraction line. Output unfiltered oil to Oil Room staging; cake to farm-shop sale stock.",
  durationMinutes: 240,
  requiresQa: true,
} as const;

export const OIL_FILTER_OPERATION = {
  seq: 1,
  name: "Filter & clarify",
  description: "Run unfiltered oil through filter press; post clarified bulk oil to Oil Room for filling.",
  durationMinutes: 90,
  requiresQa: true,
} as const;
