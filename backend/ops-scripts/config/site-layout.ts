/**
 * PVS site layout — warehouses, production facilities (rooms), lines within
 * each facility, and replenishment hints.
 *
 * Edit this file when the physical layout changes, then re-run:
 *   npm run ops:site-setup
 *
 * ERP behaviour:
 *   • kind=production  → facility production WH (issue, MO run, **temporary FG**)
 *   • kind=storage     → raw / cold storage warehouses (not FG — FG already exists in ERP)
 *   • MO Release       → replenishment TO from storage bins → production WH
 *   • MO Complete      → FG lands on facility WH; putaway TO if rule WH ≠ facility WH
 *
 * **Hierarchy:** each entry in PRODUCTION_FACILITIES describes a top-level room
 * (ProductionFacility) and its default "Main Line" (ProductionLine). Additional
 * lines can be added later via Settings → Production facilities.
 *
 * **Stock Room (finished goods):** use your **existing** warehouse (default code
 * `WH-FG`, display name "Stock Room"). Scripts do **not** create it. Configure
 * **putaway rules for every variant** (and product) with destination = that warehouse and a
 * fixed bin — see README.
 *
 * **No separate ancillary warehouse:** the facility WH is the buffer. After
 * complete, a putaway TO moves FG to the finished-goods warehouse when the rule
 * points there. Later, manual transfer orders can reshuffle bins inside WH-FG.
 */

export const SITE_CITY = "Kothavaripalle, AP";

/**
 * Code of the finished-goods warehouse already in ERP (Settings → Warehouses).
 * Not created by ops scripts — only referenced in docs and work-center hints.
 */
export const EXISTING_FINISHED_GOODS_WH_CODE = "WH-FG";

/** Long-term raw / cold storage warehouses (created by script). */
export const STORAGE_WAREHOUSES = [
  { code: "WH-STO-OILSEEDS", name: "Oil Seeds Warehouse", kind: "storage" as const },
  { code: "WH-STO-MILLETS", name: "Millets Warehouse", kind: "storage" as const },
  { code: "WH-STO-GROUNDNUT", name: "Groundnut Seeds Warehouse", kind: "storage" as const },
  { code: "WH-STO-FILTERMAT", name: "Filter Material Warehouse", kind: "storage" as const },
  { code: "WH-STO-COLD-1", name: "Cold Storage 1", kind: "storage" as const },
  { code: "WH-STO-COLD-2", name: "Cold Storage 2", kind: "storage" as const },
] as const;

export type FacilityDef = {
  /** Unique code for the ProductionFacility (formerly WorkCenter). */
  facilityCode: string;
  facilityName: string;
  /** Lines within the facility. First entry is the auto-seeded "Main Line". */
  lines: readonly { code: string; name: string }[];
  /** Shop-floor warehouse (kind=production) — also temporary FG buffer. Shared by all lines. */
  productionWhCode: string;
  productionWhName: string;
  /**
   * Putaway rule destination warehouse code after MO complete.
   * Usually EXISTING_FINISHED_GOODS_WH_CODE.
   */
  putawayDestinationWhCode: string;
  replenishFromStorageCodes: readonly string[];
  description: string;
};

/** @deprecated Use FacilityDef + PRODUCTION_FACILITIES */
export type ProductionLineDef = {
  workCenterCode: string;
  workCenterName: string;
  productionWhCode: string;
  productionWhName: string;
  putawayDestinationWhCode: string;
  replenishFromStorageCodes: readonly string[];
  description: string;
};

export const PRODUCTION_FACILITIES: readonly FacilityDef[] = [
  {
    facilityCode: "FAC-SNACKS",
    facilityName: "Snacks Room",
    lines: [{ code: "LINE-SNACKS-MAIN", name: "Main Line" }],
    productionWhCode: "WH-PROD-SNACKS",
    productionWhName: "Snacks Room — Production WH",
    putawayDestinationWhCode: EXISTING_FINISHED_GOODS_WH_CODE,
    replenishFromStorageCodes: ["WH-STO-MILLETS", "WH-STO-GROUNDNUT", "WH-STO-OILSEEDS"],
    description:
      "Production WH holds WIP and temporary FG. On complete, putaway TO moves FG to existing finished-goods warehouse. Replenish facility from storage warehouses on MO release.",
  },
  {
    facilityCode: "FAC-SOAP",
    facilityName: "Soap Room",
    lines: [{ code: "LINE-SOAP-MAIN", name: "Main Line" }],
    productionWhCode: "WH-PROD-SOAP",
    productionWhName: "Soap Room — Production WH",
    putawayDestinationWhCode: EXISTING_FINISHED_GOODS_WH_CODE,
    replenishFromStorageCodes: ["WH-STO-OILSEEDS", "WH-STO-COLD-1", "WH-STO-COLD-2"],
    description:
      "Facility WH is temporary FG buffer; putaway rules → finished-goods warehouse.",
  },
  {
    facilityCode: "FAC-VACUUM",
    facilityName: "Vacuum Packing",
    lines: [{ code: "LINE-VACUUM-MAIN", name: "Main Line" }],
    productionWhCode: "WH-PROD-VACUUM",
    productionWhName: "Vacuum Packing — Production WH",
    putawayDestinationWhCode: EXISTING_FINISHED_GOODS_WH_CODE,
    replenishFromStorageCodes: [EXISTING_FINISHED_GOODS_WH_CODE, "WH-STO-COLD-1", "WH-STO-COLD-2"],
    description:
      "Uses existing finished-goods warehouse as putaway destination (no extra location). Configure every variant putaway rule → WH-FG.",
  },
  {
    facilityCode: "FAC-OIL",
    facilityName: "Oil Room",
    lines: [{ code: "LINE-OIL-MAIN", name: "Main Line" }],
    productionWhCode: "WH-PROD-OIL",
    productionWhName: "Oil Room — Production WH",
    putawayDestinationWhCode: EXISTING_FINISHED_GOODS_WH_CODE,
    replenishFromStorageCodes: ["WH-STO-OILSEEDS", "WH-STO-GROUNDNUT"],
    description:
      "Press on line; temporary FG on facility WH; putaway TO to finished-goods warehouse.",
  },
  {
    facilityCode: "FAC-MILL",
    facilityName: "Milling Room",
    lines: [{ code: "LINE-MILL-MAIN", name: "Main Line" }],
    productionWhCode: "WH-PROD-MILL",
    productionWhName: "Milling Room — Production WH",
    putawayDestinationWhCode: EXISTING_FINISHED_GOODS_WH_CODE,
    replenishFromStorageCodes: ["WH-STO-MILLETS", "WH-STO-OILSEEDS"],
    description:
      "Mill on line; temporary FG on facility WH; putaway TO to finished-goods warehouse.",
  },
  {
    facilityCode: "FAC-FILTER",
    facilityName: "Filter Room",
    lines: [{ code: "LINE-FILTER-MAIN", name: "Main Line" }],
    productionWhCode: "WH-PROD-FILTER",
    productionWhName: "Filter Room — Production WH",
    putawayDestinationWhCode: EXISTING_FINISHED_GOODS_WH_CODE,
    replenishFromStorageCodes: ["WH-STO-FILTERMAT", "WH-STO-OILSEEDS"],
    description:
      "Filter on line; temporary FG on facility WH; putaway TO to finished-goods warehouse.",
  },
] as const;

/**
 * Backward-compat alias for the old PRODUCTION_LINES array.
 * 02-production-lines.ts reads this until it's migrated.
 */
export const PRODUCTION_LINES: readonly ProductionLineDef[] = PRODUCTION_FACILITIES.map((f) => ({
  workCenterCode: f.facilityCode,
  workCenterName: f.facilityName,
  productionWhCode: f.productionWhCode,
  productionWhName: f.productionWhName,
  putawayDestinationWhCode: f.putawayDestinationWhCode,
  replenishFromStorageCodes: f.replenishFromStorageCodes,
  description: f.description,
}));

/** Warehouses this script creates/updates (excludes existing finished-goods WH). */
export function allWarehouses(): Array<{
  code: string;
  name: string;
  kind: "storage" | "production";
}> {
  const map = new Map<string, { code: string; name: string; kind: "storage" | "production" }>();

  for (const s of STORAGE_WAREHOUSES) {
    map.set(s.code, { ...s });
  }

  for (const line of PRODUCTION_LINES) {
    map.set(line.productionWhCode, {
      code: line.productionWhCode,
      name: line.productionWhName,
      kind: "production",
    });
  }

  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
}
