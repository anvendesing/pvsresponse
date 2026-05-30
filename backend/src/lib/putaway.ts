// Putaway rule resolution helper.
//
// Used by the MO-complete flow to decide where finished goods should go
// after being landed in the production-line warehouse, and by the
// TransferOrder drop flow to validate/suggest a destination bin.
//
// Resolution waterfall (first match wins):
//   1. Active PutawayRule for (productId, variantId)     - variant-specific
//   2. Active PutawayRule for (productId, variantId=null) - product-level
//   3. Fallback: any active storage warehouse + auto-pick best bin there

import { db } from "../db.js";

export interface PutawayDestination {
  warehouseId: string;
  // Specific bin when the rule or auto-pick found one; null means the
  // operator must choose at drop time (or the system picks during drop).
  binId: string | null;
}

// resolvePutawayDestination - returns where a product/variant should go.
//
// fallbackWarehouseId: if no rule matches, target this warehouse. Pass the
// first active storage warehouse found by the caller, or null to let this
// function auto-pick any storage warehouse.
export const resolvePutawayDestination = async (
  productId: string,
  variantId: string | null | undefined,
  fallbackWarehouseId: string | null
): Promise<PutawayDestination | null> => {
  // Try variant-specific rule first, then product-level.
  const rule = await db.putawayRule.findFirst({
    where: {
      productId,
      active: true,
      ...(variantId
        ? { OR: [{ variantId }, { variantId: null }] }
        : { variantId: null }),
    },
    orderBy: [
      // variant-specific (variantId set) wins over product-level (null),
      // then lower priority number wins.
      { variantId: "asc" },
      { priority: "asc" },
    ],
  });

  if (rule) {
    // If the rule specifies a concrete bin, use it directly.
    if (rule.toBinId) {
      return { warehouseId: rule.toWarehouseId, binId: rule.toBinId };
    }
    // Rule has a warehouse but no bin - auto-pick the best available bin.
    const bin = await pickBestBin(rule.toWarehouseId, productId);
    return { warehouseId: rule.toWarehouseId, binId: bin?.id ?? null };
  }

  // No rule - fall back to the provided warehouse or any storage warehouse.
  const whId = fallbackWarehouseId ?? (await anyStorageWarehouse());
  if (!whId) return null;

  const bin = await pickBestBin(whId, productId);
  return { warehouseId: whId, binId: bin?.id ?? null };
};

// Pick the best bin for receiving a product into a warehouse.
// Prefers an existing bin already holding the product (with remaining
// capacity); falls back to any empty bin in the warehouse.
const pickBestBin = async (warehouseId: string, productId: string) => {
  const existing = await db.bin.findFirst({
    where: {
      warehouseId,
      productId,
      // Only pick bins that still have room (qty < capacity).
      // We can't reference another column in Prisma's where, so we
      // rely on the seeded capacity being >> actual qty in practice.
      qty: { gt: 0 },
    },
    orderBy: { qty: "asc" },
  });
  if (existing) return existing;

  return db.bin.findFirst({
    where: { warehouseId, productId: null, qty: 0 },
    orderBy: [
      { zone: "asc" },
      { shelf: "asc" },
      { bin: "asc" },
    ],
  });
};

// Return the id of any active storage warehouse (used as last-resort fallback).
const anyStorageWarehouse = async (): Promise<string | null> => {
  const wh = await db.warehouse.findFirst({
    where: { kind: "storage", active: true },
    select: { id: true },
  });
  return wh?.id ?? null;
};
