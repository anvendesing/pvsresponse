/**
 * Cancel an open manufacturing order: unwind material issues, cancel
 * linked transfer orders, close work orders, set status=cancelled.
 */
import type { Prisma } from "@prisma/client";
import { db } from "../db.js";

type Tx = Prisma.TransactionClient;

export class MoCancelError extends Error {
  statusCode: number;
  code: string;
  constructor(message: string, code: string, statusCode = 409) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

const reverseTransferInTransit = async (
  tx: Tx,
  to: {
    id: string;
    transferNo: string;
    fromWarehouseId: string;
    items: Array<{
      productId: string;
      variantId: string | null;
      qtyPicked: number;
      fromBinId: string | null;
      toBinId: string | null;
    }>;
  }
) => {
  for (const item of to.items) {
    if (item.qtyPicked <= 0) continue;
    if (item.fromBinId) {
      await tx.bin.update({
        where: { id: item.fromBinId },
        data: { qty: { increment: item.qtyPicked } },
      });
    }
    if (item.toBinId) {
      await tx.bin.update({
        where: { id: item.toBinId },
        data: { reservedQty: { decrement: item.qtyPicked } },
      });
    }
    if (item.fromBinId) {
      const srcBin = await tx.bin.findUnique({ where: { id: item.fromBinId } });
      if (srcBin) {
        await tx.stockLedger.create({
          data: {
            productId: item.productId,
            variantId: item.variantId,
            warehouseId: to.fromWarehouseId,
            bin: `${srcBin.zone}/${srcBin.shelf}/${srcBin.bin}`,
            txnType: "Transfer",
            ref: `${to.transferNo}-CANCEL`,
            qty: item.qtyPicked,
            balance: srcBin.qty,
            date: new Date(),
          },
        });
      }
    }
    if (item.variantId) {
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { stockOnHand: { increment: item.qtyPicked } },
      });
    } else {
      await tx.product.update({
        where: { id: item.productId },
        data: { stockOnHand: { increment: item.qtyPicked } },
      });
    }
  }
};

const cancelTransferOrder = async (
  tx: Tx,
  to: {
    id: string;
    transferNo: string;
    status: string;
    fromWarehouseId: string;
    items: Array<{
      productId: string;
      variantId: string | null;
      qtyPicked: number;
      fromBinId: string | null;
      toBinId: string | null;
    }>;
  }
) => {
  if (to.status === "done" || to.status === "cancelled") return;
  if (to.status === "in_transit") {
    await reverseTransferInTransit(tx, to);
  }
  await tx.transferOrder.update({
    where: { id: to.id },
    data: { status: "cancelled", cancelledAt: new Date() },
  });
};

const reverseMaterialIssues = async (
  tx: Tx,
  orderNo: string,
  rows: Array<{
    productId: string;
    variantId: string | null;
    qty: number;
    bin: string | null;
    batch: string | null;
    lotId: string | null;
    warehouseId: string;
  }>
) => {
  for (const row of rows) {
    const take = Math.abs(row.qty);
    const binPath = row.bin?.trim() ?? "";
    const binParts = binPath.split("/");
    const binRow =
      binParts.length === 3
        ? await tx.bin.findFirst({
            where: {
              warehouseId: row.warehouseId,
              zone: binParts[0],
              shelf: binParts[1],
              bin: binParts[2],
            },
          })
        : null;

    if (binRow) {
      const updated = await tx.bin.update({
        where: { id: binRow.id },
        data: { qty: { increment: take } },
      });
      await tx.stockLedger.create({
        data: {
          productId: row.productId,
          variantId: row.variantId,
          warehouseId: row.warehouseId,
          bin: binPath,
          batch: row.batch,
          lotId: row.lotId,
          txnType: "MO Cancel",
          ref: orderNo,
          qty: take,
          balance: updated.qty,
          date: new Date(),
        },
      });
    }

    if (row.lotId) {
      await tx.stockLot.update({
        where: { id: row.lotId },
        data: { qtyOnHand: { increment: take } },
      });
    }

    await tx.product.update({
      where: { id: row.productId },
      data: { stockOnHand: { increment: take } },
    });
  }
};

const idleMachine = async (tx: Tx, machineId: string | null | undefined) => {
  if (!machineId) return;
  const m = await tx.machine.findUnique({
    where: { id: machineId },
    select: { id: true, status: true },
  });
  if (!m || m.status === "maintenance" || m.status === "broken" || m.status === "idle") {
    return;
  }
  await tx.machine.update({ where: { id: m.id }, data: { status: "idle" } });
};

export type CancelProductionOrderResult = {
  productionOrderId: string;
  orderNo: string;
  transfersCancelled: number;
  issuesReversed: number;
};

/** Cancel one MO by id. Throws MoCancelError when not allowed. */
export const cancelProductionOrder = async (
  productionOrderId: string
): Promise<CancelProductionOrderResult> => {
  const po = await db.productionOrder.findUnique({
    where: { id: productionOrderId },
    include: {
      workOrders: { select: { id: true, machineId: true, status: true } },
      transferOrders: {
        include: {
          items: {
            select: {
              productId: true,
              variantId: true,
              qtyPicked: true,
              fromBinId: true,
              toBinId: true,
            },
          },
        },
      },
    },
  });

  if (!po) {
    throw new MoCancelError("Production order not found.", "not_found", 404);
  }
  if (po.status === "completed") {
    throw new MoCancelError(
      "Cannot cancel a completed MO — reverse finished goods via inventory adjustment first.",
      "already_completed"
    );
  }
  if (po.status === "cancelled") {
    throw new MoCancelError(`MO ${po.orderNo} is already cancelled.`, "already_cancelled");
  }

  const ledgerIssues = await db.stockLedger.findMany({
    where: { ref: po.orderNo, txnType: "Issue", qty: { lt: 0 } },
    select: {
      productId: true,
      variantId: true,
      qty: true,
      bin: true,
      batch: true,
      lotId: true,
      warehouseId: true,
    },
  });

  const ledgerReceipts = await db.stockLedger.findMany({
    where: {
      ref: po.orderNo,
      txnType: { in: ["MO Complete", "Production"] },
      qty: { gt: 0 },
    },
    select: { id: true },
  });

  if (ledgerReceipts.length > 0) {
    throw new MoCancelError(
      "MO has output or byproducts posted to stock — reverse those via inventory adjustment before cancelling.",
      "output_posted"
    );
  }

  let transfersCancelled = 0;

  await db.$transaction(async (tx) => {
    for (const to of po.transferOrders) {
      if (to.status === "done" || to.status === "cancelled") continue;
      await cancelTransferOrder(tx, to);
      transfersCancelled += 1;
    }

    await reverseMaterialIssues(tx, po.orderNo, ledgerIssues);

    const now = new Date();
    await tx.workOrder.updateMany({
      where: { productionOrderId: po.id, status: { not: "complete" } },
      data: { status: "complete", endTime: now },
    });

    for (const wo of po.workOrders) {
      await idleMachine(tx, wo.machineId);
    }

    await tx.productionOrder.update({
      where: { id: po.id },
      data: { status: "cancelled" },
    });
  });

  return {
    productionOrderId: po.id,
    orderNo: po.orderNo,
    transfersCancelled,
    issuesReversed: ledgerIssues.length,
  };
};

/** Cancel every MO that is not completed or already cancelled. */
export const cancelAllOpenProductionOrders = async (): Promise<
  CancelProductionOrderResult[]
> => {
  const open = await db.productionOrder.findMany({
    where: { status: { notIn: ["completed", "cancelled"] } },
    select: { id: true },
    orderBy: { orderNo: "asc" },
  });

  const results: CancelProductionOrderResult[] = [];
  for (const row of open) {
    results.push(await cancelProductionOrder(row.id));
  }
  return results;
};
