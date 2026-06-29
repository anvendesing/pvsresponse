import { db } from "../db.js";
import { STOCK_ROOM_WAREHOUSE_CODE } from "./stock-room-layout.js";
import { resolveComponentVariantIdForMoIssue } from "./soap-semi.js";

/** Parse `[ops] fg=STR staging=WH-PROD-OIL replenish=WH-GDNW,WH-STOR` from facility description. */
export const parseFacilityOps = (description: string | null | undefined) => {
  const out: {
    fg?: string;
    staging?: string;
    zone?: string;
    replenish: string[];
  } = { replenish: [] };
  if (!description) return out;
  const line = description.split("\n").find((l) => l.startsWith("[ops]"));
  if (!line) return out;
  for (const part of line.replace("[ops]", "").trim().split(/\s+/)) {
    const [key, val] = part.split("=");
    if (!key || val == null) continue;
    if (key === "replenish") {
      out.replenish = val.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (key === "fg") out.fg = val;
    else if (key === "staging") out.staging = val;
    else if (key === "zone") out.zone = val;
  }
  return out;
};

/** Merged replenish list: DB column first, then [ops] tag in description. */
export const facilityReplenishCodes = (facility: {
  replenishWarehouseCodes?: string | null;
  description?: string | null;
}): string[] => {
  const fromCol = (facility.replenishWarehouseCodes ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromCol.length) return fromCol;
  return parseFacilityOps(facility.description).replenish;
};

export type ReplenishmentAllocation = {
  productId: string;
  fromBinId: string;
  fromWarehouseId: string;
  qtyRequested: number;
};

const binFreeQty = (bin: { qty: number; reservedQty: number }) =>
  Math.max(0, bin.qty - bin.reservedQty);

const replenishWarehouseCodesToSearch = (replenishCodes: string[]) => {
  const codes = [...replenishCodes];
  if (!codes.includes(STOCK_ROOM_WAREHOUSE_CODE)) {
    codes.push(STOCK_ROOM_WAREHOUSE_CODE);
  }
  return codes;
};

/** Bins eligible for MO bulk-material replenishment (parent product only, no sale variants). */
export const bulkMaterialBinWhere = { variantId: null as null };

/** Candidate source bins for MO replenishment, ordered for stable allocation. */
const listReplenishmentCandidateBins = async (
  productId: string,
  replenishCodes: string[],
  excludeWarehouseIds: string[] = []
) => {
  const activeWh = { active: true };
  const exclude =
    excludeWarehouseIds.length > 0
      ? { warehouseId: { notIn: excludeWarehouseIds } }
      : {};

  const codesToSearch = replenishWarehouseCodesToSearch(replenishCodes);

  if (codesToSearch.length) {
    const inConfigured = await db.bin.findMany({
      where: {
        productId,
        ...bulkMaterialBinWhere,
        ...exclude,
        warehouse: { ...activeWh, code: { in: codesToSearch } },
      },
      include: { warehouse: { select: { id: true, code: true } } },
      orderBy: [{ qty: "desc" }, { zone: "asc" }, { shelf: "asc" }, { bin: "asc" }],
    });
    const withFree = inConfigured.filter((b) => binFreeQty(b) > 0);
    if (withFree.length) return withFree;
  }

  const inStorage = await db.bin.findMany({
    where: {
      productId,
      ...bulkMaterialBinWhere,
      ...exclude,
      warehouse: { ...activeWh, kind: "storage" },
    },
    include: { warehouse: { select: { id: true, code: true } } },
    orderBy: [{ qty: "desc" }, { zone: "asc" }, { shelf: "asc" }, { bin: "asc" }],
  });
  return inStorage.filter((b) => binFreeQty(b) > 0);
};

/**
 * Allocate shortage qty across bulk (untagged) source bins using **free**
 * qty (qty − reservedQty). Sale variants (e.g. WSS-1KG-01) are excluded.
 */
export const allocateReplenishmentForProduct = async (
  productId: string,
  replenishCodes: string[],
  shortageQty: number,
  excludeWarehouseIds: string[] = []
): Promise<{ allocations: ReplenishmentAllocation[]; remaining: number }> => {
  if (shortageQty <= 0) return { allocations: [], remaining: 0 };

  let remaining = shortageQty;
  const allocations: ReplenishmentAllocation[] = [];
  const bins = await listReplenishmentCandidateBins(
    productId,
    replenishCodes,
    excludeWarehouseIds
  );

  for (const bin of bins) {
    if (remaining <= 1e-6) break;
    const free = binFreeQty(bin);
    if (free <= 0) continue;
    const take = Math.min(remaining, free);
    allocations.push({
      productId,
      fromBinId: bin.id,
      fromWarehouseId: bin.warehouseId,
      qtyRequested: Math.round(take * 1000) / 1000,
    });
    remaining = Math.round((remaining - take) * 1000) / 1000;
  }

  return { allocations, remaining: Math.max(0, remaining) };
};

/**
 * Resolve a single source bin for MO-release replenishment TOs.
 * Prefers configured replenish warehouses, then any active storage WH.
 * Uses **free** qty and requires the bin to cover the full request.
 *
 * @deprecated Prefer allocateReplenishmentForProduct for release TOs.
 */
export const findReplenishmentSourceBin = async (
  productId: string,
  replenishCodes: string[],
  minQty = 1
) => {
  const { allocations, remaining } = await allocateReplenishmentForProduct(
    productId,
    replenishCodes,
    minQty
  );
  if (remaining > 1e-6 || allocations.length === 0) return null;
  return db.bin.findUnique({ where: { id: allocations[0]!.fromBinId } });
};

/**
 * Bin qty visible to an MO for each BOM leaf. Bulk components use
 * untagged parent bins only (sale variants like WSS-1KG-01 excluded).
 * Pack-MO semi components use their resolved variant id.
 */
export async function stockMapForMoLeaves(
  leaves: Array<{ productId: string; sku: string }>,
  warehouseId: string | null,
  moFgVariantId: string | null
): Promise<Map<string, { onHand: number; reserved: number }>> {
  const productIds = [...new Set(leaves.map((l) => l.productId))];
  if (productIds.length === 0) return new Map();

  const whFilter = warehouseId ? { warehouseId } : {};
  const stock = await db.bin.groupBy({
    by: ["productId", "variantId"],
    where: { productId: { in: productIds }, ...whFilter },
    _sum: { qty: true, reservedQty: true },
  });

  const map = new Map<string, { onHand: number; reserved: number }>();
  for (const leaf of leaves) {
    const componentVariantId = await resolveComponentVariantIdForMoIssue({
      moFgVariantId,
      componentProductSku: leaf.sku,
    });
    let onHand = 0;
    let reserved = 0;
    for (const row of stock) {
      if (row.productId !== leaf.productId) continue;
      const matches = componentVariantId
        ? row.variantId === componentVariantId
        : row.variantId === null;
      if (!matches) continue;
      onHand += row._sum.qty ?? 0;
      reserved += row._sum.reservedQty ?? 0;
    }
    map.set(leaf.productId, { onHand, reserved });
  }
  return map;
}
