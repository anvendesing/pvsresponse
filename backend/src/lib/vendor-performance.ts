/**
 * Compute vendor performance from PO + GRN history (Odoo-style supplier scorecard).
 */

import { db } from "../db.js";

export type VendorPerformanceMetrics = {
  vendorId: string;
  periodDays: number;
  poCount: number;
  grnCount: number;
  onTimePct: number | null;
  qualityPct: number | null;
  fillPct: number | null;
  computedRating: number;
  manualRating: number;
  totalSpend: number;
  openPoCount: number;
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export const computeVendorPerformance = async (
  vendorId: string,
  periodDays = 365
): Promise<VendorPerformanceMetrics> => {
  const vendor = await db.vendor.findUnique({
    where: { id: vendorId },
    select: { id: true, rating: true },
  });
  if (!vendor) throw new Error("Vendor not found");

  const since = new Date();
  since.setDate(since.getDate() - periodDays);

  const pos = await db.purchaseOrder.findMany({
    where: {
      vendorId,
      status: { not: "cancelled" },
      date: { gte: since },
    },
    include: {
      items: true,
      grns: { include: { items: true } },
    },
    orderBy: { date: "desc" },
  });

  let onTimeTotal = 0;
  let onTimeHit = 0;
  let receivedQty = 0;
  let rejectedQty = 0;
  let orderedQty = 0;
  let filledReceived = 0;

  for (const po of pos) {
    for (const item of po.items) {
      orderedQty += item.qty;
      filledReceived += item.received;
    }
    for (const grn of po.grns) {
      onTimeTotal++;
      const grnDay = grn.date.toISOString().slice(0, 10);
      const expectedDay = po.expectedDate.toISOString().slice(0, 10);
      if (grnDay <= expectedDay) onTimeHit++;
      for (const gi of grn.items) {
        receivedQty += gi.receivedQty;
        rejectedQty += gi.rejectedQty;
      }
    }
  }

  const onTimePct = onTimeTotal > 0 ? (onTimeHit / onTimeTotal) * 100 : null;
  const qualityPct =
    receivedQty > 0 ? ((receivedQty - rejectedQty) / receivedQty) * 100 : null;
  const fillPct = orderedQty > 0 ? (filledReceived / orderedQty) * 100 : null;

  const parts: number[] = [];
  if (onTimePct !== null) parts.push(onTimePct / 100);
  if (qualityPct !== null) parts.push(qualityPct / 100);
  if (fillPct !== null) parts.push(Math.min(1, fillPct / 100));

  const composite =
    parts.length > 0 ? parts.reduce((a, b) => a + b, 0) / parts.length : 0.5;
  const computedRating = clamp(Math.round(composite * 5 * 10) / 10, 0, 5);

  const spendAgg = await db.purchaseOrder.aggregate({
    _sum: { amount: true },
    where: { vendorId, status: { not: "cancelled" }, date: { gte: since } },
  });
  const openPoCount = await db.purchaseOrder.count({
    where: {
      vendorId,
      status: { in: ["draft", "approved", "partial"] },
    },
  });

  return {
    vendorId,
    periodDays,
    poCount: pos.length,
    grnCount: pos.reduce((s, p) => s + p.grns.length, 0),
    onTimePct,
    qualityPct,
    fillPct,
    computedRating,
    manualRating: vendor.rating,
    totalSpend: spendAgg._sum.amount ?? 0,
    openPoCount,
  };
};

export const syncVendorRatingFromPerformance = async (vendorId: string) => {
  const perf = await computeVendorPerformance(vendorId);
  await db.vendor.update({
    where: { id: vendorId },
    data: { rating: perf.computedRating },
  });
  return perf;
};
