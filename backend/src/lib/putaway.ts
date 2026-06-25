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
import {
  resolveReceiveBinForProduct,
} from "./location-bin.js";

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
  /** Prefer bins in this zone within the warehouse (falls back to any zone). */
  zone?: string;
  /**
   * Stock level for bin matching. Set for MO/GRN receive and issue.
   * undefined = no variant filter (legacy). null = bulk parent only.
   */
  variantId?: string | null;
};

const stockLevelFilter = (opts: PickBinOptions) => {
  if (opts.variantId === undefined) return {};
  return opts.variantId != null ? { variantId: opts.variantId } : { variantId: null };
};

const zoneWhere = (zone?: string) => (zone ? { zone } : {});

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
    // Honour the rule's zone (e.g. STR.PR for vacuum-pack staging).
    // pickBestBin → resolveReceiveBinForProduct will land the product
    // into a per-product slot inside that zone (one bin per SKU) so the
    // warehouse tree shows `<warehouse> → Zone <z> → <SKU>`.
    const bin = await pickBestBin(rule.toWarehouseId, productId, {
      allowEmptyBinFallback: true,
      ...(rule.toZone ? { zone: rule.toZone } : {}),
      ...(variantId !== undefined ? { variantId: variantId ?? null } : {}),
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
  const zw = zoneWhere(options.zone);
  const level = stockLevelFilter(options);

  const findExisting = async (zone?: string) =>
    db.bin.findFirst({
      where: {
        warehouseId,
        productId,
        qty: { gt: 0 },
        ...level,
        ...zoneWhere(zone),
      },
      orderBy: { qty: "asc" },
    });

  const findEmpty = async (zone?: string) =>
    db.bin.findFirst({
      where: {
        warehouseId,
        productId: null,
        variantId: null,
        qty: 0,
        ...zoneWhere(zone),
      },
      orderBy: [{ zone: "asc" }, { shelf: "asc" }, { bin: "asc" }],
    });

  let existing = await findExisting(options.zone);
  if (!existing && options.zone) existing = await findExisting();
  if (existing) return existing;

  if (!allowEmpty) return null;

  let empty = await findEmpty(options.zone);
  if (!empty && options.zone) empty = await findEmpty();
  if (empty) return empty;

  const wh = await db.warehouse.findUnique({
    where: { id: warehouseId },
    select: { id: true, code: true, scanPrefix: true },
  });
  if (!wh) return null;

  const product = await db.product.findUnique({
    where: { id: productId },
    select: { sku: true },
  });
  if (!product) return null;

  return resolveReceiveBinForProduct(db, wh, productId, product.sku, {
    zone: options.zone,
    variantId: options.variantId,
  });
};

const anyStorageWarehouse = async (): Promise<string | null> => {
  const wh = await db.warehouse.findFirst({
    where: { kind: "storage", active: true },
    select: { id: true },
  });
  return wh?.id ?? null;
};
