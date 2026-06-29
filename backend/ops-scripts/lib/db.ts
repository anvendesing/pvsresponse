import { PrismaClient } from "@prisma/client";

// ── Bin-code helper (inlined from src/lib/codes.ts so ops-scripts stay
//    self-contained and compile independently of the main src/ tree) ──────────
const _norm = (s: string) => s.trim().toUpperCase();
const _validLabel = (n: string, v: string) => {
  if (!v) throw new Error(`location segment "${n}" is empty`);
  if (v.includes(".")) throw new Error(`location segment "${n}" cannot contain a dot`);
  if (!/^[A-Z0-9_]+$/.test(v))
    throw new Error(`location segment "${n}" may only contain A-Z, 0-9 and underscore`);
};
const _validWh = (v: string) => {
  if (!v) throw new Error("warehouse code is empty");
  if (v.includes(".")) throw new Error("warehouse code cannot contain a dot");
  if (!/^[A-Z0-9_-]+$/.test(v))
    throw new Error("warehouse code may only contain A-Z, 0-9, underscore and hyphen");
};
export const binCodeFromRow = (
  bin: { zone: string; shelf: string; bin: string },
  warehouseCode: string
): string => {
  const wh = _norm(warehouseCode);
  const z = _norm(bin.zone);
  const s = _norm(bin.shelf);
  const b = _norm(bin.bin);
  _validWh(wh);
  _validLabel("zone", z);
  _validLabel("shelf", s);
  _validLabel("bin", b);
  return `B.${wh}.${z}.${s}.${b}`;
};
// ─────────────────────────────────────────────────────────────────────────────

export const db = new PrismaClient();

export const dryRun = process.argv.includes("--dry-run");

export const log = (msg: string) => console.log(msg);

/** Legacy WorkCenter codes that map to a canonical ProductionFacility code. */
export const FACILITY_CODE_ALIASES: Record<string, readonly string[]> = {
  "FAC-SNACKS": ["WC-SNACKS"],
  "FAC-SOAP": ["WC-SOAP"],
  "WC-OIL": ["FAC-OIL", "WC-FILTER"],
  "WC-VACUUM": ["FAC-VACUUM"],
  "WC-MILL": ["FAC-MILL"],
  "WC-MCLEAN": ["FAC-MCLEAN"],
  "WC-FLOUR": ["FAC-FLOUR"],
};

export function facilityCodesForSeed(canonicalCode: string): string[] {
  const aliases = FACILITY_CODE_ALIASES[canonicalCode] ?? [];
  return [canonicalCode, ...aliases];
}

/**
 * productionLineWarehouseId is @unique — only one facility may point at a WH.
 * Release the link from every row except `exceptFacilityId` (if given).
 */
export async function releaseProductionLineWarehouse(
  warehouseId: string,
  exceptFacilityId?: string | null
) {
  if (dryRun) return 0;
  const cleared = await db.productionFacility.updateMany({
    where: {
      productionLineWarehouseId: warehouseId,
      ...(exceptFacilityId ? { id: { not: exceptFacilityId } } : {}),
    },
    data: { productionLineWarehouseId: null },
  });
  return cleared.count;
}

/** @deprecated Prefer releaseProductionLineWarehouse or upsertProductionFacility */
export async function claimProductionLineWarehouse(
  warehouseId: string,
  ownerFacilityCode: string
) {
  const cleared = await releaseProductionLineWarehouse(warehouseId);
  if (cleared > 0) {
    log(
      `  ↪ cleared ${cleared} stale facility link(s) before claiming warehouse for ${ownerFacilityCode}`
    );
  }
}

export type ProductionFacilitySeed = {
  code: string;
  name: string;
  description: string;
  productionLineWarehouseId: string;
  productionZone?: string | null;
  replenishWarehouseCodes: string;
};

/**
 * Idempotent facility seed: merge legacy alias rows, deactivate duplicates,
 * then assign the production warehouse without tripping the unique constraint.
 */
export async function upsertProductionFacility(spec: ProductionFacilitySeed) {
  if (dryRun) {
    log(`  [dry] facility ${spec.code}`);
    return null;
  }

  const codes = facilityCodesForSeed(spec.code);
  const existingRows = await db.productionFacility.findMany({
    where: { code: { in: codes } },
    orderBy: { code: "asc" },
  });

  let keeper =
    existingRows.find((r) => r.code === spec.code) ?? existingRows[0] ?? null;

  const released = await releaseProductionLineWarehouse(
    spec.productionLineWarehouseId,
    keeper?.id
  );
  if (released > 0) {
    log(`  ↪ released ${released} stale warehouse link(s) for ${spec.code}`);
  }

  const data = {
    name: spec.name,
    description: spec.description,
    active: true,
    productionLineWarehouseId: spec.productionLineWarehouseId,
    productionZone: spec.productionZone ?? null,
    replenishWarehouseCodes: spec.replenishWarehouseCodes,
  };

  if (keeper) {
    const dupIds = existingRows.filter((r) => r.id !== keeper!.id).map((r) => r.id);
    if (dupIds.length > 0) {
      await db.productionFacility.updateMany({
        where: { id: { in: dupIds } },
        data: { active: false, productionLineWarehouseId: null },
      });
      log(`  ↪ deactivated ${dupIds.length} duplicate facility row(s) for ${spec.code}`);
    }
    return db.productionFacility.update({
      where: { id: keeper.id },
      data: { code: spec.code, ...data },
    });
  }

  return db.productionFacility.create({
    data: { code: spec.code, ...data },
  });
}

export type WarehouseSpec = {
  code: string;
  name: string;
  kind: "storage" | "production";
  city?: string;
};

/** Idempotent warehouse upsert by code. */
export async function upsertWarehouse(spec: WarehouseSpec) {
  const city = spec.city ?? "Kothavaripalle, AP";
  if (dryRun) {
    log(`  [dry] warehouse ${spec.code} (${spec.kind})`);
    return db.warehouse.findUnique({ where: { code: spec.code } });
  }
  return db.warehouse.upsert({
    where: { code: spec.code },
    create: {
      code: spec.code,
      name: spec.name,
      city,
      kind: spec.kind,
      active: true,
    },
    update: {
      name: spec.name,
      city,
      kind: spec.kind,
      active: true,
    },
  });
}

export type DefaultBinSpec = {
  warehouseCode: string;
  zone: string;
  shelf: string;
  bin: string;
  capacity?: number;
};

/**
 * Ensure at least one receive/issue bin exists in a warehouse.
 * Does not change qty on existing bins.
 */
export async function ensureDefaultBin(spec: DefaultBinSpec) {
  const wh = await db.warehouse.findUnique({ where: { code: spec.warehouseCode } });
  if (!wh) throw new Error(`Warehouse ${spec.warehouseCode} not found`);

  const code = binCodeFromRow(
    { zone: spec.zone, shelf: spec.shelf, bin: spec.bin },
    wh.code
  );

  const existing = await db.bin.findUnique({
    where: {
      warehouseId_zone_shelf_bin: {
        warehouseId: wh.id,
        zone: spec.zone,
        shelf: spec.shelf,
        bin: spec.bin,
      },
    },
  });

  if (existing) {
    if (!dryRun && !existing.code) {
      await db.bin.update({ where: { id: existing.id }, data: { code } });
    }
    return existing;
  }

  if (dryRun) {
    log(`  [dry] bin ${wh.code} ${spec.zone}/${spec.shelf}/${spec.bin}`);
    return null;
  }

  return db.bin.create({
    data: {
      warehouseId: wh.id,
      zone: spec.zone,
      shelf: spec.shelf,
      bin: spec.bin,
      code,
      qty: 0,
      reservedQty: 0,
      capacity: spec.capacity ?? 9999,
    },
  });
}
