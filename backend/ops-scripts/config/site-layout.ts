/**
 * PVS site layout — warehouses, production lines, and replenishment hints.
 *
 * Edit this file when the physical layout changes, then re-run:
 *   npm run ops:site-setup
 *
 * ERP behaviour (no schema changes):
 *   • kind=production  → work-center production-line WH (issue, MO run, **temporary FG**)
 *   • kind=storage     → raw / cold storage warehouses (not FG — FG already exists in ERP)
 *   • MO Release       → replenishment TO from storage bins → production WH
 *   • MO Complete      → FG lands on production-line WH; putaway TO if rule WH ≠ line WH
 *
 * **Finished goods:** use your **existing** finished-goods warehouse (default code
 * `WH-FG`). Scripts do **not** create or rename it. You must configure **putaway
 * rules for every variant** (and product) with destination = that warehouse and a
 * fixed bin — see README.
 *
 * **No separate ancillary warehouse:** the production-line WH is the buffer. After
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

export type ProductionLineDef = {
  workCenterCode: string;
  workCenterName: string;
  /** Shop-floor warehouse (kind=production) — also temporary FG buffer. */
  productionWhCode: string;
  productionWhName: string;
  /**
   * Putaway rule destination warehouse code after MO complete.
   * Usually EXISTING_FINISHED_GOODS_WH_CODE. Vacuum may post direct when line WH
   * is co-located; still configure putaway rules → WH-FG for every variant.
   */
  putawayDestinationWhCode: string;
  replenishFromStorageCodes: readonly string[];
  description: string;
};

export const PRODUCTION_LINES: readonly ProductionLineDef[] = [
  {
    workCenterCode: "WC-SNACKS",
    workCenterName: "Snacks Room",
    productionWhCode: "WH-PROD-SNACKS",
    productionWhName: "Snacks Room — Production Line",
    putawayDestinationWhCode: EXISTING_FINISHED_GOODS_WH_CODE,
    replenishFromStorageCodes: ["WH-STO-MILLETS", "WH-STO-GROUNDNUT", "WH-STO-OILSEEDS"],
    description:
      "Production WH holds WIP and temporary FG. On complete, putaway TO moves FG to existing finished-goods warehouse. Replenish line from storage warehouses on MO release.",
  },
  {
    workCenterCode: "WC-SOAP",
    workCenterName: "Soap Room",
    productionWhCode: "WH-PROD-SOAP",
    productionWhName: "Soap Room — Production Line",
    putawayDestinationWhCode: EXISTING_FINISHED_GOODS_WH_CODE,
    replenishFromStorageCodes: ["WH-STO-OILSEEDS", "WH-STO-COLD-1", "WH-STO-COLD-2"],
    description:
      "Production WH is temporary FG buffer; putaway rules → finished-goods warehouse.",
  },
  {
    workCenterCode: "WC-VACUUM",
    workCenterName: "Vacuum Packing",
    productionWhCode: "WH-PROD-VACUUM",
    productionWhName: "Vacuum Packing — Production Line",
    putawayDestinationWhCode: EXISTING_FINISHED_GOODS_WH_CODE,
    replenishFromStorageCodes: [EXISTING_FINISHED_GOODS_WH_CODE, "WH-STO-COLD-1", "WH-STO-COLD-2"],
    description:
      "Uses existing finished-goods warehouse as putaway destination (no extra location). Configure every variant putaway rule → WH-FG.",
  },
  {
    workCenterCode: "WC-OIL",
    workCenterName: "Oil Room",
    productionWhCode: "WH-PROD-OIL",
    productionWhName: "Oil Room — Production Line",
    putawayDestinationWhCode: EXISTING_FINISHED_GOODS_WH_CODE,
    replenishFromStorageCodes: ["WH-STO-OILSEEDS", "WH-STO-GROUNDNUT"],
    description:
      "Press on line; temporary FG on production WH; putaway TO to finished-goods warehouse.",
  },
  {
    workCenterCode: "WC-MILL",
    workCenterName: "Milling Room",
    productionWhCode: "WH-PROD-MILL",
    productionWhName: "Milling Room — Production Line",
    putawayDestinationWhCode: EXISTING_FINISHED_GOODS_WH_CODE,
    replenishFromStorageCodes: ["WH-STO-MILLETS", "WH-STO-OILSEEDS"],
    description:
      "Mill on line; temporary FG on production WH; putaway TO to finished-goods warehouse.",
  },
  {
    workCenterCode: "WC-FILTER",
    workCenterName: "Filter Room",
    productionWhCode: "WH-PROD-FILTER",
    productionWhName: "Filter Room — Production Line",
    putawayDestinationWhCode: EXISTING_FINISHED_GOODS_WH_CODE,
    replenishFromStorageCodes: ["WH-STO-FILTERMAT", "WH-STO-OILSEEDS"],
    description:
      "Filter on line; temporary FG on production WH; putaway TO to finished-goods warehouse.",
  },
] as const;

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
