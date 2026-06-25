/**
 * Shared PO line resolution: vendor catalog qty/rate → internal qty/rate.
 */

import { db } from "../db.js";
import {
  internalFromVendorQty,
  internalRateFromVendorRate,
} from "./vendor-catalog.js";

export type PoLineInput = {
  productId: string;
  qty?: number;
  rate?: number;
  vendorProductId?: string;
  vendorQty?: number;
  vendorRate?: number;
};

export type ResolvedPoLine = {
  productId: string;
  qty: number;
  rate: number;
  amount: number;
  vendorProductId: string | null;
  vendorQty: number | null;
  vendorUom: string | null;
  vendorRate: number | null;
};

export const resolvePoLine = async (
  item: PoLineInput,
  vendorId: string
): Promise<ResolvedPoLine> => {
  if (item.vendorProductId) {
    const vp = await db.vendorProduct.findFirst({
      where: { id: item.vendorProductId, vendorId, active: true },
      include: { product: { select: { uom: true } } },
    });
    if (!vp) throw new Error(`Vendor catalog line ${item.vendorProductId} not found`);
    const vendorQty = item.vendorQty ?? vp.minOrderQty;
    const vendorRate = item.vendorRate ?? vp.price;
    const qty = internalFromVendorQty(vendorQty, vp);
    const rate = internalRateFromVendorRate(vendorRate, vp);
    return {
      productId: vp.productId,
      qty,
      rate,
      amount: qty * rate,
      vendorProductId: vp.id,
      vendorQty,
      vendorUom: vp.vendorUom,
      vendorRate,
    };
  }
  if (item.qty == null || item.rate == null) {
    throw new Error("Each PO line needs qty+rate or a vendor catalog line");
  }
  return {
    productId: item.productId,
    qty: item.qty,
    rate: item.rate,
    amount: item.qty * item.rate,
    vendorProductId: null,
    vendorQty: null,
    vendorUom: null,
    vendorRate: null,
  };
};

export const nextPoNo = async (): Promise<string> => {
  const last = await db.purchaseOrder.findFirst({
    where: { poNo: { startsWith: "PO-2026-" } },
    orderBy: { poNo: "desc" },
    select: { poNo: true },
  });
  const n = last
    ? parseInt(last.poNo.split("-").pop() ?? "1100", 10) + 1
    : 1101;
  return `PO-2026-${String(n).padStart(4, "0")}`;
};
