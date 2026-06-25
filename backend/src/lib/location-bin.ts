/**
 * Resolve or create a bin row for a warehouse location path.
 *
 * Stock is always stored on Bin rows (DB requires zone/shelf/bin columns).
 * Callers pass only the levels they care about; missing levels use internal
 * placeholders (shelf/bin `00`) that are hidden in UI via formatLocationPath().
 *
 *   warehouse only        → zone `_` / shelf `{SKU}` / bin `00`
 *   zone only             → `{zone}` / `00` / `00`
 *   zone + shelf          → `{zone}` / `{shelf}` / `00`
 *   zone + shelf + bin    → exact path
 */

import type { Prisma } from "@prisma/client";
import { binCodeFromRow, type WarehouseCodeInput } from "./codes.js";

/** Default bin when stock is saved at shelf level (no bin label). */
export const IMPLICIT_SHELF_BIN = "00";

/** Shelf slot when only a zone is provided (zone bulk). */
export const IMPLICIT_ZONE_SHELF = "00";

/** Internal zone marker: stock held at warehouse level (no layout zone). Hidden in UI. */
export const WAREHOUSE_LEVEL_ZONE = "_";

/** @deprecated Legacy auto-slot prefix; treat like {@link WAREHOUSE_LEVEL_ZONE} in display. */
export const WAREHOUSE_BULK_ZONE = "WH";

export type LocationPath = {
  zone: string;
  shelf?: string | null;
  bin?: string | null;
};

export type NormalizedLocation = {
  zone: string;
  shelf: string;
  bin: string;
};

export function normalizeLocationPath(path: LocationPath): NormalizedLocation {
  const zone = path.zone.trim().toUpperCase();
  let shelf = path.shelf?.trim().toUpperCase();
  let bin = path.bin?.trim().toUpperCase();

  if (!shelf) {
    shelf = IMPLICIT_ZONE_SHELF;
    bin = bin ?? IMPLICIT_SHELF_BIN;
  } else if (!bin) {
    bin = IMPLICIT_SHELF_BIN;
  }

  return { zone, shelf, bin };
}

/** True when shelf/bin are internal placeholders, not a real layout label. */
export function isImplicitShelf(shelf: string): boolean {
  return shelf === IMPLICIT_ZONE_SHELF;
}

export function isImplicitBin(bin: string): boolean {
  return bin === IMPLICIT_SHELF_BIN;
}

/** True for warehouse-level rows (no real zone in the layout). */
export function isWarehouseLevelZone(zone: string): boolean {
  return zone === WAREHOUSE_LEVEL_ZONE || zone === WAREHOUSE_BULK_ZONE;
}

/**
 * Human-readable location for UI and ledger (hides placeholder `00` parts).
 * Examples: "STR", "A", "A / S031", "A / S031 / 02"
 */
export function formatLocationPath(
  path: Pick<NormalizedLocation, "zone" | "shelf" | "bin">,
  warehouseName?: string | null
): string {
  const { zone, shelf, bin } = path;

  if (isWarehouseLevelZone(zone)) {
    return warehouseName?.trim() || "Warehouse";
  }

  const parts: string[] = [zone];
  if (!isImplicitShelf(shelf)) parts.push(shelf);
  if (!isImplicitBin(bin)) parts.push(bin);
  return parts.join(" / ");
}

type DbClient = Prisma.TransactionClient | {
  bin: Prisma.TransactionClient["bin"];
};

/** @deprecated Prefer resolveReceiveBinForProduct. */
export const WAREHOUSE_BULK_LOCATION: LocationPath = {
  zone: WAREHOUSE_LEVEL_ZONE,
  shelf: "STOCK",
};

export async function ensureWarehouseBulkBin(
  tx: DbClient,
  warehouse: WarehouseCodeInput & { id: string }
) {
  return resolveOrCreateLocationBin(tx, warehouse, WAREHOUSE_BULK_LOCATION);
}

/** Sanitized shelf key for per-product warehouse bulk slots (WH/{shelf}/00). */
export function productBulkShelf(sku: string): string {
  const s = sku.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return s || "STOCK";
}

/**
 * Pick or create a receive/drop slot for a product. Never reuses a bin
 * that already holds a different product with qty > 0.
 */
export async function resolveReceiveBinForProduct(
  tx: DbClient,
  warehouse: WarehouseCodeInput & { id: string },
  productId: string,
  productSku: string,
  opts: { zone?: string; variantId?: string | null } = {}
) {
  const zw = opts.zone ? { zone: opts.zone.trim().toUpperCase() } : {};
  const level =
    opts.variantId === undefined
      ? {}
      : opts.variantId != null
        ? { variantId: opts.variantId }
        : { variantId: null };

  const existing = await tx.bin.findFirst({
    where: {
      warehouseId: warehouse.id,
      productId,
      qty: { gt: 0 },
      ...level,
      ...zw,
    },
    orderBy: { qty: "asc" },
  });
  if (existing) return existing;

  const empty = await tx.bin.findFirst({
    where: {
      warehouseId: warehouse.id,
      productId: null,
      variantId: null,
      qty: 0,
      reservedQty: 0,
      ...zw,
    },
    orderBy: [{ zone: "asc" }, { shelf: "asc" }, { bin: "asc" }],
  });
  if (empty) return empty;

  const shelf = productBulkShelf(productSku);
  if (opts.zone) {
    return resolveOrCreateLocationBin(tx, warehouse, { zone: opts.zone, shelf });
  }
  // Warehouse-level: one row per product, no fake WH/00/00 shared slot.
  return resolveOrCreateLocationBin(tx, warehouse, {
    zone: WAREHOUSE_LEVEL_ZONE,
    shelf,
  });
}

/** Pick or create a receive/drop slot at zone or warehouse level when no layout bins exist. */
export async function resolveReceiveBin(
  tx: DbClient,
  warehouse: WarehouseCodeInput & { id: string },
  productId: string,
  productSku: string,
  opts: { zone?: string } = {}
) {
  return resolveReceiveBinForProduct(tx, warehouse, productId, productSku, opts);
}

/**
 * Thrown by resolveOrCreateLocationBin when the caller asked to land
 * stock at a level that already has more specific child slots
 * (warehouse-with-zones, zone-with-shelves, shelf-with-bins). The
 * intent of the workspace is "store at the deepest slot that
 * exists" - so we refuse the placeholder write and surface the
 * available children for the UI / operator to pick from.
 */
export class LocationLevelBlockedError extends Error {
  constructor(
    message: string,
    public readonly level: "warehouse" | "zone" | "shelf",
    public readonly available: string[]
  ) {
    super(message);
    this.name = "LocationLevelBlockedError";
  }
}

async function assertNoDeeperChildren(
  tx: DbClient,
  warehouseId: string,
  norm: NormalizedLocation
): Promise<void> {
  // We only police writes that target a higher level (one of the
  // levels is a placeholder). Fully-addressed writes (zone+shelf+bin
  // all real) pass through unchanged.
  const zoneIsWh = isWarehouseLevelZone(norm.zone);
  const shelfIsPh = isImplicitShelf(norm.shelf);
  const binIsPh = isImplicitBin(norm.bin);

  // Warehouse-level write (zone is placeholder) — check that no real
  // zone exists in this warehouse.
  if (zoneIsWh) {
    const realZones = await tx.bin.findMany({
      where: {
        warehouseId,
        NOT: [{ zone: WAREHOUSE_LEVEL_ZONE }, { zone: WAREHOUSE_BULK_ZONE }],
      },
      select: { zone: true },
      distinct: ["zone"],
      take: 12,
    });
    if (realZones.length > 0) {
      const names = realZones.map((z) => z.zone).sort();
      throw new LocationLevelBlockedError(
        `Cannot store at warehouse level — this warehouse has zones (${names.join(", ")}). Pick a specific zone.`,
        "warehouse",
        names
      );
    }
    return;
  }

  // Zone-level write (shelf is placeholder) — check that the requested
  // zone has no real shelf.
  if (shelfIsPh) {
    const realShelves = await tx.bin.findMany({
      where: {
        warehouseId,
        zone: norm.zone,
        NOT: { shelf: IMPLICIT_ZONE_SHELF },
      },
      select: { shelf: true },
      distinct: ["shelf"],
      take: 12,
    });
    if (realShelves.length > 0) {
      const names = realShelves.map((s) => s.shelf).sort();
      throw new LocationLevelBlockedError(
        `Cannot store at zone ${norm.zone} — it already has shelves (${names.join(", ")}). Pick a specific shelf.`,
        "zone",
        names
      );
    }
    return;
  }

  // Shelf-level write (bin is placeholder) — check that the requested
  // shelf has no real bin.
  if (binIsPh) {
    const realBins = await tx.bin.findMany({
      where: {
        warehouseId,
        zone: norm.zone,
        shelf: norm.shelf,
        NOT: { bin: IMPLICIT_SHELF_BIN },
      },
      select: { bin: true },
      distinct: ["bin"],
      take: 12,
    });
    if (realBins.length > 0) {
      const names = realBins.map((b) => b.bin).sort();
      throw new LocationLevelBlockedError(
        `Cannot store at shelf ${norm.zone}/${norm.shelf} — it already has bins (${names.join(", ")}). Pick a specific bin.`,
        "shelf",
        names
      );
    }
  }
}

export async function resolveOrCreateLocationBin(
  tx: DbClient,
  warehouse: WarehouseCodeInput & { id: string },
  path: LocationPath
) {
  const { zone, shelf, bin } = normalizeLocationPath(path);

  let row = await tx.bin.findFirst({
    where: { warehouseId: warehouse.id, zone, shelf, bin },
  });

  // Only check the no-deeper-children rule when creating a NEW row.
  // Pre-existing placeholder rows pass through so historical data
  // and in-flight transfers keep working until they're cleared via
  // the placeholder-cleanup script.
  if (!row) {
    await assertNoDeeperChildren(tx, warehouse.id, { zone, shelf, bin });
    row = await tx.bin.create({
      data: {
        warehouseId: warehouse.id,
        zone,
        shelf,
        bin,
        code: binCodeFromRow({ zone, shelf, bin }, warehouse),
        qty: 0,
        reservedQty: 0,
        capacity: 9999,
      },
    });
  } else if (!row.code) {
    row = await tx.bin.update({
      where: { id: row.id },
      data: { code: binCodeFromRow({ zone, shelf, bin }, warehouse) },
    });
  }

  return row;
}
