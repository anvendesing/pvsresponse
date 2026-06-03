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
