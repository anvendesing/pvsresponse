import type { Bin } from "@prisma/client";
import { db } from "../db.js";

export const RECOUNT_REASONS = [
  "physical_match",
  "damage",
  "found_elsewhere",
  "product_swap",
  "spillage",
  "expired",
  "other",
] as const;

export type RecountReason = (typeof RECOUNT_REASONS)[number];

export const isBinVariance = (before: number, after: number): boolean => {
  const delta = Math.abs(after - before);
  if (delta > 50) return true;
  if (before > 0 && delta / before > 0.1) return true;
  return false;
};

export const recomputeStockOnHand = async (
  tx: typeof db,
  productId: string,
  variantId: string | null,
  delta: number
): Promise<number> => {
  if (variantId) {
    const before = await tx.productVariant.findUnique({
      where: { id: variantId },
      select: { stockOnHand: true },
    });
    const after = Math.max(0, (before?.stockOnHand ?? 0) + delta);
    await tx.productVariant.update({
      where: { id: variantId },
      data: { stockOnHand: after },
    });
    return after;
  }
  const before = await tx.product.findUnique({
    where: { id: productId },
    select: { stockOnHand: true },
  });
  const after = Math.max(0, (before?.stockOnHand ?? 0) + delta);
  await tx.product.update({
    where: { id: productId },
    data: { stockOnHand: after },
  });
  return after;
};

const nextCycleCountNo = async (tx: typeof db): Promise<string> => {
  const year = new Date().getUTCFullYear();
  const prefix = `CC-${year}-`;
  const last = await tx.stockLedger.findFirst({
    where: { ref: { startsWith: prefix } },
    orderBy: { ref: "desc" },
    select: { ref: true },
  });
  const seq = last ? parseInt(last.ref.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(seq + 1).padStart(4, "0")}`;
};

const nextReassignNo = async (tx: typeof db): Promise<string> => {
  const year = new Date().getUTCFullYear();
  const prefix = `RX-${year}-`;
  const last = await tx.stockLedger.findFirst({
    where: { ref: { startsWith: prefix } },
    orderBy: { ref: "desc" },
    select: { ref: true },
  });
  const seq = last
    ? parseInt(last.ref.slice(prefix.length).split("-")[0], 10) || 0
    : 0;
  return `${prefix}${String(seq + 1).padStart(4, "0")}`;
};

export async function applyBinRecount(
  bin: Bin,
  opts: {
    qtyAfter: number;
    reasonCode: RecountReason;
    remarks?: string | null;
    userId: string;
  }
) {
  if (!bin.productId) {
    throw new Error("Bin has no product assigned");
  }

  const before = bin.qty ?? 0;
  const after = Math.round(opts.qtyAfter);
  const delta = after - before;
  const flagged = isBinVariance(before, after);

  return db.$transaction(async (tx) => {
    await tx.bin.update({
      where: { id: bin.id },
      data: { qty: after },
    });
    const ccNo = await nextCycleCountNo(tx as unknown as typeof db);
    await tx.stockLedger.create({
      data: {
        productId: bin.productId!,
        variantId: bin.variantId,
        warehouseId: bin.warehouseId,
        bin: `${bin.zone}/${bin.shelf}/${bin.bin}`,
        txnType: "CycleCount",
        qty: delta,
        balance: after,
        ref: ccNo,
      },
    });
    const count = await tx.binCount.create({
      data: {
        binId: bin.id,
        productIdBefore: bin.productId,
        productIdAfter: bin.productId,
        qtyBefore: before,
        qtyAfter: after,
        delta,
        reason: opts.reasonCode,
        remarks: opts.remarks ?? null,
        countedById: opts.userId,
        flagged,
      },
    });
    await recomputeStockOnHand(
      tx as unknown as typeof db,
      bin.productId!,
      bin.variantId ?? null,
      delta
    );
    return count;
  });
}

export async function applyBinReassign(
  bin: Bin,
  opts: {
    productId: string;
    variantId: string | null;
    qty: number;
    reasonCode: RecountReason;
    remarks?: string | null;
    userId: string;
  }
) {
  const sameAssignment =
    bin.productId === opts.productId &&
    (bin.variantId ?? null) === opts.variantId;
  if (bin.reservedQty > 0 && bin.productId && !sameAssignment) {
    throw new Error(
      "Bin holds reserved stock for an open pick list. Cancel the pick list before reassigning."
    );
  }

  const before = bin.qty ?? 0;
  const after = Math.round(opts.qty);
  const oldProductId = bin.productId;
  const oldVariantId = bin.variantId ?? null;
  const flagged =
    oldProductId !== opts.productId ||
    oldVariantId !== opts.variantId ||
    isBinVariance(before, after);

  return db.$transaction(async (tx) => {
    const rxNo = await nextReassignNo(tx as unknown as typeof db);
    if (oldProductId && before > 0) {
      await tx.stockLedger.create({
        data: {
          productId: oldProductId,
          variantId: oldVariantId,
          warehouseId: bin.warehouseId,
          bin: `${bin.zone}/${bin.shelf}/${bin.bin}`,
          txnType: "Adjust",
          qty: -before,
          balance: 0,
          ref: `${rxNo}-OUT`,
        },
      });
    }
    await tx.bin.update({
      where: { id: bin.id },
      data: {
        productId: opts.productId,
        variantId: opts.variantId,
        qty: after,
      },
    });
    await tx.stockLedger.create({
      data: {
        productId: opts.productId,
        variantId: opts.variantId,
        warehouseId: bin.warehouseId,
        bin: `${bin.zone}/${bin.shelf}/${bin.bin}`,
        txnType: "Adjust",
        qty: after,
        balance: after,
        ref: `${rxNo}-IN`,
      },
    });
    const count = await tx.binCount.create({
      data: {
        binId: bin.id,
        productIdBefore: oldProductId,
        productIdAfter: opts.productId,
        qtyBefore: before,
        qtyAfter: after,
        delta: after - before,
        reason: opts.reasonCode,
        remarks: opts.remarks ?? null,
        countedById: opts.userId,
        flagged,
      },
    });
    if (oldProductId && before > 0) {
      await recomputeStockOnHand(
        tx as unknown as typeof db,
        oldProductId,
        oldVariantId,
        -before
      );
    }
    if (after > 0) {
      await recomputeStockOnHand(
        tx as unknown as typeof db,
        opts.productId,
        opts.variantId,
        after
      );
    }
    return count;
  });
}
