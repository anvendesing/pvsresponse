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
 * **Stock Room:** warehouse code **`STR`**, display name "Stock Room". Seeded by
 * `npm run db:seed-stock-room`; migrates legacy **`WH-FG`** automatically.
 * **putaway rules for every variant** (and product) with destination = that warehouse and a
 * fixed bin — see README.
 *
 * **No separate ancillary warehouse:** the facility WH is the buffer. After
 * complete, a putaway TO moves FG to the finished-goods warehouse when the rule
 * points there. Later, manual transfer orders can reshuffle bins inside STR.
 */

export const SITE_CITY = "Kothavaripalle, AP";

/**
 * Stock Room warehouse code (Settings → Warehouses). Was WH-FG before rename.
 * Putaway rules and MO complete flows reference this code.
 */
export const EXISTING_FINISHED_GOODS_WH_CODE = "STR";

/** Raw / bulk storage godowns used by oil extraction. */
export const BIG_GODOWN_CODE = "WH-STOR";
export const NEW_GODOWN_CODE = "WH-GDNW";
export const OIL_LOCAL_STORAGE_CODE = "WH-PROD-OIL";

/** Oil Extraction — parallel lines (one operator may run several). */
export const OIL_EXTRACTION_LINES = [
  { code: "WC-OIL-EXT-01", name: "Extraction line 1", role: "extract" },
  { code: "WC-OIL-EXT-02", name: "Extraction line 2", role: "extract" },
  { code: "WC-OIL-EXT-03", name: "Extraction line 3", role: "extract" },
  { code: "WC-OIL-EXT-04", name: "Extraction line 4", role: "extract" },
  { code: "WC-OIL-EXT-05", name: "Extraction line 5", role: "extract" },
  { code: "WC-OIL-EXT-06", name: "Extraction line 6", role: "extract" },
  { code: "WC-OIL-FLT-01", name: "Filtering line 1", role: "filter" },
  { code: "WC-OIL-FLT-02", name: "Filtering line 2", role: "filter" },
  { code: "WC-OIL-FLT-03", name: "Filtering line 3", role: "filter" },
  { code: "WC-OIL-FILL", name: "Filling line (variants)", role: "fill" },
] as const;

/** One physical unit per oil line — press, filter, or filler (Settings → Machines). */
export function oilLineMachine(line: {
  code: string;
  name: string;
  role: string;
}): MachineSeedDef {
  const roleLabel =
    line.role === "extract"
      ? "cold press"
      : line.role === "filter"
        ? "filter unit"
        : "variant filler";
  return {
    code: line.code.replace(/^WC-/, "MCH-"),
    name: line.name,
    description: `Oil extraction ${roleLabel} · ${line.code}`,
  };
}

export const OIL_EXTRACTION_LINE_MACHINES: readonly MachineSeedDef[] =
  OIL_EXTRACTION_LINES.map(oilLineMachine);

/** Long-term raw / cold storage warehouses (created by script). */
export const STORAGE_WAREHOUSES = [
  { code: "WH-STO-OILSEEDS", name: "Oil Seeds Warehouse", kind: "storage" as const },
  { code: "WH-STO-MILLETS", name: "Millets Warehouse", kind: "storage" as const },
  { code: "WH-STO-GROUNDNUT", name: "Groundnut Seeds Warehouse", kind: "storage" as const },
  { code: "WH-STO-FILTERMAT", name: "Filter Material Warehouse", kind: "storage" as const },
  { code: "WH-STO-COLD-1", name: "Cold Storage 1", kind: "storage" as const },
  { code: "WH-STO-COLD-2", name: "Cold Storage 2", kind: "storage" as const },
] as const;

/** Single machine row seeded under a production line (Settings → Machines). */
export type MachineSeedDef = {
  code: string;
  name: string;
  description?: string;
};

/** Expand "Destone Machine" ×3 → MCH-MILL-DSTONE-01 … with numbered names. */
export function expandMachines(
  codePrefix: string,
  baseName: string,
  count: number,
  description?: string
): MachineSeedDef[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const suffix = count > 1 ? ` ${n}` : "";
    return {
      code: `${codePrefix}-${String(n).padStart(2, "0")}`,
      name: `${baseName}${suffix}`,
      ...(description ? { description } : {}),
    };
  });
}

/** Milling Room (LINE-MILL-MAIN) — physical machines on the main line. */
export const MILLING_LINE_MACHINES: readonly MachineSeedDef[] = [
  ...expandMachines("MCH-MILL-DSTONE", "Destone Machine", 3),
  ...expandMachines("MCH-MILL-RICE", "Rice Machine", 1),
  ...expandMachines("MCH-MILL-HULL", "Hulling Machine", 2),
  ...expandMachines("MCH-MILL-RAGI-HULL", "Ragi Hulling", 3),
  ...expandMachines("MCH-MILL-DUST-S", "Dust Machine Small", 2),
];

/** Flour Mill (LINE-FLOUR-MAIN) — grinding / spice / ravva equipment. */
export const FLOUR_MILL_LINE_MACHINES: readonly MachineSeedDef[] = [
  ...expandMachines("MCH-FLOUR-FRY", "Frying Machine", 1),
  ...expandMachines("MCH-FLOUR-PULV-75", "Pulvariser 7.5 HP", 1),
  ...expandMachines("MCH-FLOUR-PULV-S-3", "Small Pulviser 3 HP", 2),
  ...expandMachines("MCH-FLOUR-FLOUR", "Flour Machine", 3),
  ...expandMachines("MCH-FLOUR-MIRCHI", "Mirchi", 1),
  ...expandMachines("MCH-FLOUR-TURM-MIRCHI", "Turmeric & Mirchi", 1),
  ...expandMachines("MCH-FLOUR-RAVVA", "Ravva Machine", 1),
];

export type FacilityDef = {
  /** Unique code for the ProductionFacility (formerly WorkCenter). */
  facilityCode: string;
  facilityName: string;
  /** Lines within the facility. First entry is the auto-seeded "Main Line". */
  lines: readonly { code: string; name: string; role?: string }[];
  /**
   * Shop-floor warehouse (kind=production) — also temporary FG buffer.
   * Use EXISTING_FINISHED_GOODS_WH_CODE when the line runs inside the
   * stock room (no separate production warehouse).
   */
  productionWhCode: string;
  productionWhName: string;
  /** When production runs inside STR, prefer this zone for FG bins. */
  productionZone?: string;
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
    lines: [
      { code: "LINE-SNACKS-MAIN", name: "Production Line" },
      { code: "LINE-SNACKS-PACK", name: "Packing Line" },
    ],
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
    facilityCode: "WC-VACUUM",
    facilityName: "Stock Room Packing",
    lines: [
      { code: "WC-VACUUM-MAIN", name: "Vacuum Packing – Main Line" },
      { code: "WC-STR-PACK-MANUAL", name: "Manual Packing Line" },
    ],
    productionWhCode: EXISTING_FINISHED_GOODS_WH_CODE,
    productionWhName: "Stock Room",
    productionZone: "A",
    putawayDestinationWhCode: EXISTING_FINISHED_GOODS_WH_CODE,
    replenishFromStorageCodes: [EXISTING_FINISHED_GOODS_WH_CODE, "WH-STO-COLD-1", "WH-STO-COLD-2"],
    description:
      "Vacuum and manual retail packing in Stock Room zone A. Bulk flour arrives via TO from Flour Mill; grains/millets packed in situ. FG stays in STR.",
  },
  {
    facilityCode: "WC-OIL",
    facilityName: "Oil Extraction",
    lines: OIL_EXTRACTION_LINES.map((l) => ({
      code: l.code,
      name: l.name,
      role: l.role,
    })),
    productionWhCode: OIL_LOCAL_STORAGE_CODE,
    productionWhName: "Oil Extraction — Local storage",
    putawayDestinationWhCode: EXISTING_FINISHED_GOODS_WH_CODE,
    replenishFromStorageCodes: [
      NEW_GODOWN_CODE,
      BIG_GODOWN_CODE,
      OIL_LOCAL_STORAGE_CODE,
    ],
    description:
      "Six extraction lines, three filtering lines, one filling line (demand-driven variants). " +
      "Materials from New Godown, Big Godown, and local line storage; all FG → Stock Room.",
  },
  {
    facilityCode: "WC-MILL",
    facilityName: "Milling Room",
    lines: [{ code: "WC-MILL-MAIN", name: "Main Line" }],
    productionWhCode: "WH-PROD-MILL",
    productionWhName: "Milling Room — Production WH",
    putawayDestinationWhCode: EXISTING_FINISHED_GOODS_WH_CODE,
    replenishFromStorageCodes: [BIG_GODOWN_CODE, "WH-STO-MILLETS", "WH-STO-OILSEEDS"],
    description:
      "Destone, hulling, rice and ragi lines; semi-FG on facility WH; replenish raw from Big Godown.",
  },
  {
    facilityCode: "WC-MCLEAN",
    facilityName: "Manual Cleaning Room",
    lines: [{ code: "WC-MCLEAN-MAIN", name: "Manual Cleaning Line" }],
    productionWhCode: "WH-PROD-MCLEAN",
    productionWhName: "Manual Cleaning — Production WH",
    putawayDestinationWhCode: EXISTING_FINISHED_GOODS_WH_CODE,
    replenishFromStorageCodes: ["WH-PROD-MILL"],
    description:
      "Manual cleaning & grading of milled semi-FG; bulk output transferred to Stock Room for retail pack.",
  },
  {
    facilityCode: "WC-FLOUR",
    facilityName: "Flour Mill",
    lines: [{ code: "WC-FLOUR-MAIN", name: "Main Line" }],
    productionWhCode: "WH-PROD-FLOUR",
    productionWhName: "Flour Mill — Production WH",
    putawayDestinationWhCode: EXISTING_FINISHED_GOODS_WH_CODE,
    replenishFromStorageCodes: ["WH-STO-MILLETS", "WH-STO-OILSEEDS"],
    description:
      "Flour, spice and ravva grinding only; bulk FG transferred to Stock Room for retail packing.",
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
