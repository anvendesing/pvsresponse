/**
 * Incoming supply not yet in bins — open POs and in-progress MOs.
 * Used so stock rules compare effective qty (on-hand + pipeline) vs min.
 */

import { db } from "../db.js";

const OPEN_PO_STATUSES = ["draft", "approved", "partial"] as const;
const OPEN_MO_STATUSES = ["planned", "in-progress", "qc", "delayed"] as const;

export { OPEN_PO_STATUSES, OPEN_MO_STATUSES };

/** Qty still expected from open purchase orders (ordered − received). */
export const getPoPipelineQty = async (productId: string): Promise<number> => {
  const items = await db.purchaseOrderItem.findMany({
    where: {
      productId,
      po: { status: { in: [...OPEN_PO_STATUSES] } },
    },
    select: { qty: true, received: true },
  });
  return items.reduce((s, i) => s + Math.max(0, i.qty - i.received), 0);
};

/** Qty still expected from open manufacturing orders (planned − completed). */
export const getMoPipelineQty = async (
  productId: string,
  variantId: string | null
): Promise<number> => {
  const mos = await db.productionOrder.findMany({
    where: {
      status: { in: [...OPEN_MO_STATUSES] },
      bom: {
        productId,
        ...(variantId ? { variantId } : {}),
      },
    },
    select: { plannedQty: true, actualQty: true },
  });
  return mos.reduce((s, mo) => s + Math.max(0, mo.plannedQty - mo.actualQty), 0);
};

export const getOnHandProductQty = async (
  productId: string,
  variantId: string | null
): Promise<number> => {
  const agg = await db.bin.aggregate({
    _sum: { qty: true },
    where: {
      productId,
      ...(variantId ? { variantId } : {}),
    },
  });
  return agg._sum.qty ?? 0;
};

export type EffectiveStock = {
  onHand: number;
  poPipeline: number;
  moPipeline: number;
  effective: number;
};

export type ProductPipeline = {
  poPipeline: number;
  moPipeline: number;
  effective: number;
};

/** Batch-fetch open PO/MO qty still expected, keyed by product id. */
export const batchGetProductPipeline = async (
  productIds: string[]
): Promise<Map<string, Omit<ProductPipeline, "effective">>> => {
  const map = new Map<string, Omit<ProductPipeline, "effective">>();
  if (productIds.length === 0) return map;
  for (const id of productIds) {
    map.set(id, { poPipeline: 0, moPipeline: 0 });
  }

  const [poItems, mos] = await Promise.all([
    db.purchaseOrderItem.findMany({
      where: {
        productId: { in: productIds },
        po: { status: { in: [...OPEN_PO_STATUSES] } },
      },
      select: { productId: true, qty: true, received: true },
    }),
    db.productionOrder.findMany({
      where: {
        status: { in: [...OPEN_MO_STATUSES] },
        bom: { productId: { in: productIds } },
      },
      select: {
        plannedQty: true,
        actualQty: true,
        bom: { select: { productId: true } },
      },
    }),
  ]);

  for (const item of poItems) {
    const cur = map.get(item.productId);
    if (!cur) continue;
    cur.poPipeline += Math.max(0, item.qty - item.received);
  }
  for (const mo of mos) {
    const pid = mo.bom.productId;
    const cur = map.get(pid);
    if (!cur) continue;
    cur.moPipeline += Math.max(0, mo.plannedQty - mo.actualQty);
  }
  return map;
};

export const attachProductPipeline = async <
  T extends { id: string; stockOnHand: number },
>(
  products: T[]
): Promise<(T & { pipeline: ProductPipeline })[]> => {
  const pipelineMap = await batchGetProductPipeline(products.map((p) => p.id));
  return products.map((p) => {
    const pl = pipelineMap.get(p.id) ?? { poPipeline: 0, moPipeline: 0 };
    return {
      ...p,
      pipeline: {
        ...pl,
        effective: p.stockOnHand + pl.poPipeline + pl.moPipeline,
      },
    };
  });
};

/** On-hand + open PO + open MO output for a product (global, all bins). */
export const getEffectiveProductStock = async (
  productId: string,
  variantId: string | null
): Promise<EffectiveStock> => {
  const [onHand, poPipeline, moPipeline] = await Promise.all([
    getOnHandProductQty(productId, variantId),
    getPoPipelineQty(productId),
    getMoPipelineQty(productId, variantId),
  ]);
  return {
    onHand,
    poPipeline,
    moPipeline,
    effective: onHand + poPipeline + moPipeline,
  };
};

/** Bin qty + global PO/MO pipeline for the rule's product. */
export const getEffectiveBinStock = async (
  binQty: number,
  productId: string,
  variantId: string | null
): Promise<EffectiveStock> => {
  const [poPipeline, moPipeline] = await Promise.all([
    getPoPipelineQty(productId),
    getMoPipelineQty(productId, variantId),
  ]);
  return {
    onHand: binQty,
    poPipeline,
    moPipeline,
    effective: binQty + poPipeline + moPipeline,
  };
};
