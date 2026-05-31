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
  /** True when the matched PutawayRule has a fixed toBinId. */
  fixedBin: boolean;
}

export type PickBinOptions = {
  /** When false, never assign to an empty bin slot (strict fixed-location). */
  allowEmptyBinFallback?: boolean;
};

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
  const rule = await db.putawayRule.findFirst({
    where: {
      productId,
      active: true,
      ...(variantId
        ? { OR: [{ variantId }, { variantId: null }] }
        : { variantId: null }),
    },
    orderBy: [{ variantId: "asc" }, { priority: "asc" }],
  });

  if (rule) {
    if (rule.toBinId) {
      return {
        warehouseId: rule.toWarehouseId,
        binId: rule.toBinId,
        fixedBin: true,
      };
    }
    const bin = await pickBestBin(rule.toWarehouseId, productId, {
      allowEmptyBinFallback: true,
    });
    return {
      warehouseId: rule.toWarehouseId,
      binId: bin?.id ?? null,
      fixedBin: false,
    };
  }

  const whId = fallbackWarehouseId ?? (await anyStorageWarehouse());
  if (!whId) return null;

  const bin = await pickBestBin(whId, productId, { allowEmptyBinFallback: true });
  return { warehouseId: whId, binId: bin?.id ?? null, fixedBin: false };
};

/** Pick the best bin for receiving a product into a warehouse. */
export const pickBestBin = async (
  warehouseId: string,
  productId: string,
  options: PickBinOptions = {}
) => {
  const allowEmpty = options.allowEmptyBinFallback !== false;
  const existing = await db.bin.findFirst({
    where: {
      warehouseId,
      productId,
      qty: { gt: 0 },
    },
    orderBy: { qty: "asc" },
  });
  if (existing) return existing;

  if (!allowEmpty) return null;

  return db.bin.findFirst({
    where: { warehouseId, productId: null, qty: 0 },
    orderBy: [{ zone: "asc" }, { shelf: "asc" }, { bin: "asc" }],
  });
};

const anyStorageWarehouse = async (): Promise<string | null> => {
  const wh = await db.warehouse.findFirst({
    where: { kind: "storage", active: true },
    select: { id: true },
  });
  return wh?.id ?? null;
};
