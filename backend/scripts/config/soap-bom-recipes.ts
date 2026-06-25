/**
 * Soap manufacturing recipes — batch size 40 × 100 g bars.
 *
 * Two-BOM model (Rev-Soap-2.0):
 *   1. Cook BOM on semi-finished SOAP-PROC (variant-level) — raw → drying bars
 *   2. Pack BOM on finished BSOP — semi bars → packaged retail variant
 */

export const SOAP_BATCH_OUTPUT_QTY = 40;

export const SOAP_PROC_PRODUCT_SKU = "SOAP-PROC";
export const SOAP_COOK_BOM_REVISION = "Rev-Soap-Cook-2.0";
export const SOAP_PACK_BOM_REVISION = "Rev-Soap-Pack-2.0";
/** Legacy single-BOM revision — deactivated by seed script. */
export const SOAP_LEGACY_BOM_REVISION = "Rev-Soap-1.0";

/** Semi variant SKU from finished BSOP variant SKU (under parent SOAP-PROC). */
export function semiVariantSku(fgVariantSku: string): string {
  return fgVariantSku.replace(/^BSOP-/, `${SOAP_PROC_PRODUCT_SKU}-`);
}

/** @deprecated Legacy one-product-per-variant SKU — use semiVariantSku on SOAP-PROC parent. */
export function semiProductSku(fgVariantSku: string): string {
  return semiVariantSku(fgVariantSku);
}

/** Shared raw material SKUs (created by seed-soap-boms.ts). */
export const SOAP_RAW_SKUS = {
  coconutOil: "RAW-SOAP-COCO-OIL",
  gingellyOil: "RAW-SOAP-GINGELLY-OIL",
  neemOil: "RAW-SOAP-NEEM-OIL",
  castorOil: "RAW-SOAP-CASTOR-OIL",
  causticSoda: "RAW-SOAP-CAUSTIC-SODA",
  dmdm: "RAW-SOAP-DMDM",
  flavourOil: "RAW-SOAP-FLAVOUR-OIL",
  aloeGel: "RAW-SOAP-ALOE-GEL",
  tomatoJuice: "RAW-SOAP-TOMATO-JUICE",
  cowMilk: "RAW-SOAP-COW-MILK",
} as const;

export const SOAP_CUT_VARIANT_SKU = "BSOP-CUT-TRIM-01";

export type SoapComponentLine = {
  rawKey: keyof typeof SOAP_RAW_SKUS;
  qty: number;
  uom: "g" | "kg";
};

export const SOAP_NEEM_LINE_BASE: readonly SoapComponentLine[] = [
  { rawKey: "coconutOil", qty: 2270, uom: "g" },
  { rawKey: "gingellyOil", qty: 480, uom: "g" },
  { rawKey: "neemOil", qty: 450, uom: "g" },
  { rawKey: "causticSoda", qty: 450, uom: "g" },
  { rawKey: "dmdm", qty: 20, uom: "g" },
  { rawKey: "flavourOil", qty: 100, uom: "g" },
];

export const SOAP_HERB_LINE_BASE: readonly SoapComponentLine[] = [
  { rawKey: "coconutOil", qty: 2270, uom: "g" },
  { rawKey: "castorOil", qty: 480, uom: "g" },
  { rawKey: "causticSoda", qty: 450, uom: "g" },
  { rawKey: "dmdm", qty: 20, uom: "g" },
  { rawKey: "flavourOil", qty: 100, uom: "g" },
];

export type SoapVariantRecipe = {
  variantSku: string;
  displayName: string;
  line: "neem" | "herb";
  extraComponents?: readonly SoapComponentLine[];
};

export const SOAP_VARIANT_RECIPES: readonly SoapVariantRecipe[] = [
  {
    variantSku: "BSOP-NEE-100G-04",
    displayName: "Neem & Aloe Vera",
    line: "neem",
    extraComponents: [{ rawKey: "aloeGel", qty: 300, uom: "g" }],
  },
  {
    variantSku: "BSOP-NEE-100G-05",
    displayName: "Neem & Tulasi",
    line: "neem",
  },
  {
    variantSku: "BSOP-VET-100G-07",
    displayName: "Vetivert",
    line: "herb",
  },
  {
    variantSku: "BSOP-BAB-100G-08",
    displayName: "Baby soap",
    line: "herb",
  },
  {
    variantSku: "BSOP-JAS-100G-02",
    displayName: "Jasmine",
    line: "herb",
  },
  {
    variantSku: "BSOP-PAN-100G-06",
    displayName: "Panchagavya",
    line: "herb",
    extraComponents: [{ rawKey: "tomatoJuice", qty: 1200, uom: "g" }],
  },
  {
    variantSku: "BSOP-COW-100G-01",
    displayName: "Cow Milk & Sandal Wood",
    line: "herb",
    extraComponents: [{ rawKey: "cowMilk", qty: 1200, uom: "g" }],
  },
];

export const SOAP_CUT_SCRAP_QTY = 800;
export const SOAP_CUT_SCRAP_UOM = "g";
export const SOAP_STR_REPLENISH_MIN_QTY = 80;

/** Minimum dried semi bars in Soap Room before suggesting a pack MO. */
export const SOAP_PACK_MO_MIN_SEMI_QTY = 40;

/** BOM 1 — cook + cut; MO completes when bars go to drying bins. */
export const SOAP_COOK_BOM_OPERATIONS = [
  {
    seq: 1,
    name: "Cook liquid soap",
    description:
      "Combine oils, caustic soda and additives; cook to trace. Consumes all raw materials.",
    durationMinutes: 180,
    requiresQa: true,
  },
  {
    seq: 2,
    name: "Solidify & cut",
    description:
      "Pour into moulds, solidify, cut to 100 g bars. Post processed bars to drying bins and log cut scrap.",
    durationMinutes: 90,
    requiresQa: true,
    blockedBySeq: 1,
  },
] as const;

/** BOM 2 — packaging only; run after ≥30 days drying (inventory hold, not an MO step). */
export const SOAP_PACK_BOM_OPERATIONS = [
  {
    seq: 1,
    name: "Package & store",
    description:
      "Issue dried semi-finished bars, wrap/label, post packaged FG to Soap Room shelf (A/S02 or A/S03).",
    durationMinutes: 60,
    requiresQa: false,
  },
] as const;

/** Drying shelves S04–S08 (11 bins each). */
export const SOAP_DRYING_SHELVES = ["S04", "S05", "S06", "S07", "S08"] as const;
export const SOAP_DRYING_BINS_PER_SHELF = 11;

export function soapDryingBinSlot(variantIndex: number): { shelf: string; bin: string } {
  const shelf = SOAP_DRYING_SHELVES[variantIndex % SOAP_DRYING_SHELVES.length]!;
  const bin = String((Math.floor(variantIndex / SOAP_DRYING_SHELVES.length) % SOAP_DRYING_BINS_PER_SHELF) + 1).padStart(2, "0");
  return { shelf, bin };
}

export function soapPackagedBinLabel(variantIndex: number): string {
  return String(variantIndex + 1).padStart(2, "0");
}

export const SOAP_PACKAGED_SHELF = "S02";
export const SOAP_PACKAGED_OVERFLOW_SHELF = "S03";

export function soapPackagedBinSlot(variantIndex: number): { shelf: string; bin: string } {
  if (variantIndex < 5) {
    return { shelf: SOAP_PACKAGED_SHELF, bin: soapPackagedBinLabel(variantIndex) };
  }
  return {
    shelf: SOAP_PACKAGED_OVERFLOW_SHELF,
    bin: soapPackagedBinLabel(variantIndex - 5),
  };
}

/** @deprecated Legacy four-step single BOM — use SOAP_COOK + SOAP_PACK. */
export const SOAP_BOM_OPERATIONS = [
  ...SOAP_COOK_BOM_OPERATIONS,
  {
    seq: 3,
    name: "Dry (30 days)",
    description: "Legacy — drying is inventory time between cook and pack MOs.",
    durationMinutes: 43_200,
    requiresQa: true,
    blockedBySeq: 2,
  },
  {
    seq: 4,
    name: "Package & store",
    description: "Legacy — use Rev-Soap-Pack-2.0 BOM instead.",
    durationMinutes: 60,
    requiresQa: false,
    blockedBySeq: 3,
  },
] as const;
