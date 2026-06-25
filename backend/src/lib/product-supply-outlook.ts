/**
 * Detailed supply outlook for a product: on-hand, incoming (PO/MO),
 * outgoing (SO reservations), forecasted qty, and source documents.
 */

import { db } from "../db.js";
import {
  getEffectiveProductStock,
  OPEN_MO_STATUSES,
  OPEN_PO_STATUSES,
} from "./stock-rule-pipeline.js";

export type PoPipelineSource = {
  poId: string;
  poNo: string;
  status: string;
  vendorCode: string;
  vendorName: string;
  ordered: number;
  received: number;
  remaining: number;
  /** Draft POs are internal placeholders until approved. */
  isDraft: boolean;
};

export type MoPipelineSource = {
  moId: string;
  orderNo: string;
  status: string;
  plannedQty: number;
  actualQty: number;
  remaining: number;
  variantId: string | null;
  variantSku: string | null;
};

export type ProductSupplyOutlook = {
  productId: string;
  uom: string;
  onHand: number;
  incomingPo: number;
  incomingMo: number;
  /** Confirmed SO demand not yet invoiced/cancelled. */
  outgoingSo: number;
  /** On hand + incoming PO + incoming MO (replenishment planning). */
  supplyOutlook: number;
  /** On hand − outgoing + incoming (Odoo-style forecast / ATP basis). */
  forecasted: number;
  purchaseOrders: PoPipelineSource[];
  manufacturingOrders: MoPipelineSource[];
};

const getReservedForSo = async (
  productId: string,
  variantId: string | null
): Promise<number> => {
  const open = await db.salesOrderItem.findMany({
    where: {
      productId,
      ...(variantId ? { variantId } : { variantId: null }),
      salesOrder: { status: { in: ["confirmed", "partially_invoiced", "on_hold"] } },
    },
    select: { qtyOrdered: true, qtyInvoiced: true, qtyCancelled: true },
  });
  return open.reduce(
    (s, r) => s + Math.max(0, r.qtyOrdered - r.qtyInvoiced - r.qtyCancelled),
    0
  );
};

export const getProductSupplyOutlook = async (
  productId: string,
  variantId: string | null = null
): Promise<ProductSupplyOutlook | null> => {
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { id: true, uom: true },
  });
  if (!product) return null;

  const [stock, outgoingSo, poItems, mos] = await Promise.all([
    getEffectiveProductStock(productId, variantId),
    getReservedForSo(productId, variantId),
    db.purchaseOrderItem.findMany({
      where: {
        productId,
        po: { status: { in: [...OPEN_PO_STATUSES] } },
      },
      select: {
        qty: true,
        received: true,
        po: {
          select: {
            id: true,
            poNo: true,
            status: true,
            vendor: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { po: { poNo: "asc" } },
    }),
    db.productionOrder.findMany({
      where: {
        status: { in: [...OPEN_MO_STATUSES] },
        bom: {
          productId,
          ...(variantId ? { variantId } : {}),
        },
      },
      select: {
        id: true,
        orderNo: true,
        status: true,
        plannedQty: true,
        actualQty: true,
        bom: {
          select: {
            variantId: true,
            variant: { select: { sku: true } },
          },
        },
      },
      orderBy: { orderNo: "asc" },
    }),
  ]);

  const purchaseOrders: PoPipelineSource[] = poItems
    .map((i) => ({
      poId: i.po.id,
      poNo: i.po.poNo,
      status: i.po.status,
      vendorCode: i.po.vendor.code,
      vendorName: i.po.vendor.name,
      ordered: i.qty,
      received: i.received,
      remaining: Math.max(0, i.qty - i.received),
      isDraft: i.po.status === "draft",
    }))
    .filter((l) => l.remaining > 0);

  const manufacturingOrders: MoPipelineSource[] = mos
    .map((mo) => ({
      moId: mo.id,
      orderNo: mo.orderNo,
      status: mo.status,
      plannedQty: mo.plannedQty,
      actualQty: mo.actualQty,
      remaining: Math.max(0, mo.plannedQty - mo.actualQty),
      variantId: mo.bom.variantId,
      variantSku: mo.bom.variant?.sku ?? null,
    }))
    .filter((l) => l.remaining > 0);

  const supplyOutlook = stock.effective;
  const forecasted = stock.onHand - outgoingSo + stock.poPipeline + stock.moPipeline;

  return {
    productId,
    uom: product.uom,
    onHand: stock.onHand,
    incomingPo: stock.poPipeline,
    incomingMo: stock.moPipeline,
    outgoingSo,
    supplyOutlook,
    forecasted,
    purchaseOrders,
    manufacturingOrders,
  };
};

export type PoClosePreviewLine = {
  productId: string;
  sku: string;
  name: string;
  uom: string;
  ordered: number;
  received: number;
  remaining: number;
};

export type PoClosePreview = {
  poId: string;
  poNo: string;
  status: string;
  lines: PoClosePreviewLine[];
  totalRemaining: number;
  /** When > 0, closing drops this qty from Products “expected”. */
  dropsFromSupplyOutlook: number;
};

export const getPoClosePreview = async (poId: string): Promise<PoClosePreview | null> => {
  const po = await db.purchaseOrder.findUnique({
    where: { id: poId },
    include: {
      items: {
        include: { product: { select: { id: true, sku: true, name: true, uom: true } } },
      },
    },
  });
  if (!po) return null;

  const lines: PoClosePreviewLine[] = po.items
    .map((i) => ({
      productId: i.productId,
      sku: i.product.sku,
      name: i.product.name,
      uom: i.product.uom,
      ordered: i.qty,
      received: i.received,
      remaining: Math.max(0, i.qty - i.received),
    }))
    .filter((l) => l.remaining > 0);

  const totalRemaining = lines.reduce((s, l) => s + l.remaining, 0);
  const countsInOutlook = OPEN_PO_STATUSES.includes(
    po.status as (typeof OPEN_PO_STATUSES)[number]
  );

  return {
    poId: po.id,
    poNo: po.poNo,
    status: po.status,
    lines,
    totalRemaining,
    dropsFromSupplyOutlook: countsInOutlook ? totalRemaining : 0,
  };
};
