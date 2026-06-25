/**
 * Default packaging BOMs: parent bulk → retail variants.
 *
 * Batch convention (kg / L parents):
 *   • 100 g variant (packSize 0.1 kg) → 1 kg parent in → 10 variant units out
 *   • 1 kg variant (packSize 1 kg)    → 1 kg parent in → 1 variant unit out
 *
 * Line routing:
 *   • Oils                    → Oil Room fill → Stock Room
 *   • Flours / atta / ravva   → manual pack in Stock Room (bulk transferred in first)
 *   • Grains & millets        → vacuum pack in Stock Room zone A
 *   • Snacks                  → pack in Snacks Room → variants to Stock Room
 */

export const PACK_BOM_REVISION = "Rev-Pack-1.0 (auto)";

export const OIL_PACK_FACILITY_CODE = "WC-OIL";
export const OIL_PACK_LINE_CODE = "WC-OIL-FILL";
/** Manual bagging in Stock Room (flours arrive as bulk TO from Flour Mill). */
export const MANUAL_PACK_FACILITY_CODE = "WC-VACUUM";
export const MANUAL_PACK_LINE_CODE = "WC-STR-PACK-MANUAL";
export const VACUUM_PACK_FACILITY_CODE = "WC-VACUUM";
export const VACUUM_PACK_LINE_CODE = "WC-VACUUM-MAIN";
export const SNACKS_PACK_FACILITY_CODES = ["FAC-SNACKS", "WC-SNACKS"] as const;
export const SNACKS_PACK_LINE_CODES = ["LINE-SNACKS-PACK", "LINE-SNACKS-MAIN"] as const;

export type PackLineKind = "oil" | "manual" | "vacuum" | "snacks";

export type PackBatch = {
  parentQty: number;
  outputQty: number;
  /** Human-readable summary for logs / API responses. */
  summary: string;
};

type ParsedSize = { qty: number; unit: "kg" | "g" | "l" | "ml" };

const SIZE_RE = /(\d+(?:\.\d+)?)(KG|G|L|ML)\b/gi;

const FLOUR_KEYWORDS =
  /\b(flour|atta|ravva|rava|sooji|besan|sattu|kanji|idli|puttu|powder|mirchi|turmeric|haldi|chilli|chili|masala|spice)\b/i;

/** Derive variant packSize in parent UoM from SKU size token (e.g. BAJF-100G-01 → 0.1 kg). */
export const parsePackSizeFromSku = (
  sku: string,
  parentUom: string
): number | null => {
  const matches = Array.from(sku.matchAll(SIZE_RE));
  if (matches.length !== 1) return null;
  const m = matches[0]!;
  const qty = parseFloat(m[1]!);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const unit = m[2]!.toLowerCase() as ParsedSize["unit"];
  const pUom = parentUom.toLowerCase();

  if ((pUom === "kg" || pUom === "g") && (unit === "kg" || unit === "g")) {
    const inG = unit === "kg" ? qty * 1000 : qty;
    return pUom === "kg" ? inG / 1000 : inG;
  }
  if ((pUom === "l" || pUom === "ml") && (unit === "l" || unit === "ml")) {
    const inMl = unit === "l" ? qty * 1000 : qty;
    return pUom === "l" ? inMl / 1000 : inMl;
  }
  return null;
};

/** Effective packSize: DB value, or SKU-derived when still at default 1. */
export const effectivePackSize = (
  packSize: number,
  sku: string,
  parentUom: string
): number => {
  if (packSize > 0 && packSize !== 1) return packSize;
  const fromSku = parsePackSizeFromSku(sku, parentUom);
  if (fromSku != null && fromSku > 0) return fromSku;
  return packSize > 0 ? packSize : 1;
};

/**
 * One MO batch: how much parent bulk is consumed and how many variant units
 * are produced.
 */
export const computePackBatch = (
  packSize: number,
  parentUom: string,
  parentSku: string
): PackBatch => {
  const uom = parentUom.toLowerCase();

  if (uom === "kg" || uom === "l") {
    if (packSize <= 0) {
      return { parentQty: 1, outputQty: 1, summary: `1 ${parentUom} ${parentSku} → 1 pc` };
    }
    if (packSize >= 1) {
      return {
        parentQty: packSize,
        outputQty: 1,
        summary: `${packSize} ${parentUom} ${parentSku} → 1 pc`,
      };
    }
    const outputQty = Math.max(1, Math.round(1 / packSize));
    return {
      parentQty: 1,
      outputQty,
      summary: `1 ${parentUom} ${parentSku} → ${outputQty} pc`,
    };
  }

  // pc / pack / set parents — one variant unit per batch.
  return {
    parentQty: packSize,
    outputQty: 1,
    summary: `${packSize} ${parentUom} ${parentSku} → 1 pc`,
  };
};

export const isFlourProduct = (name: string, sku: string): boolean =>
  FLOUR_KEYWORDS.test(`${sku} ${name}`);

/**
 * Which facility/line should run the pack MO for this product.
 * Returns null for categories without a dedicated pack route.
 */
export const resolvePackLineKind = (
  categorySlug: string | null | undefined,
  productName: string,
  productSku: string
): PackLineKind | null => {
  if (categorySlug === "oils") return "oil";
  if (categorySlug === "snacks") return "snacks";
  if (categorySlug === "millets") return "vacuum";
  if (categorySlug === "spices") return "manual";
  if (categorySlug === "grains") {
    return isFlourProduct(productName, productSku) ? "manual" : "vacuum";
  }
  return null;
};

export const packOperationName = (line: PackLineKind): string => {
  if (line === "oil") return "Fill & label";
  if (line === "snacks") return "Pack & label";
  if (line === "manual") return "Manual pack";
  return "Vacuum pack";
};

export const packOperationDescription = (line: PackLineKind): string => {
  if (line === "oil") {
    return "Bottle or pouch fill from bulk oil at the Oil Room; FG putaway to Stock Room.";
  }
  if (line === "snacks") {
    return "Pack retail variants from bulk snacks stock in the Snacks Room; FG putaway to Stock Room.";
  }
  if (line === "manual") {
    return "Weigh and bag from bulk flour stock in the Stock Room (after bulk transfer from Flour Mill).";
  }
  return "Vacuum-seal retail packs from bulk parent stock (Stock Room zone A).";
};

export const packOperationDurationMinutes = (line: PackLineKind): number => {
  if (line === "oil") return 20;
  if (line === "snacks") return 25;
  if (line === "manual") return 30;
  return 15;
};
