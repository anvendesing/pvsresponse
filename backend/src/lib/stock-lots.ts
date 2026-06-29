import type { Bin, Prisma, StockLot } from "@prisma/client";
import { db } from "../db.js";
import { formatLocationPath, resolveReceiveBinForProduct } from "./location-bin.js";

/** Mint a batch number when the operator leaves the field blank. */
export const resolveBatchNo = (args: {
  provided: string | null | undefined;
  grnNo: string;
  lineIndex: number;
  product: { type: string; batchTracked: boolean; sku: string };
}): string => {
  const trimmed = args.provided?.trim();
  if (trimmed) return trimmed.slice(0, 60);
  if (args.product.type === "raw" || args.product.batchTracked) {
    return `${args.grnNo}-L${String(args.lineIndex + 1).padStart(2, "0")}`;
  }
  return `${args.grnNo}-L${String(args.lineIndex + 1).padStart(2, "0")}`;
};

/** Prefer an empty bin, then a bin already holding this batch (no mix). */
export const pickBinForLotReceive = async (
  warehouseId: string | null,
  productId: string,
  batchNo: string
): Promise<Bin | null> => {
  const whFilter = warehouseId ? { warehouseId } : {};
  const sameBatch = await db.bin.findFirst({
    where: {
      ...whFilter,
      productId,
      batch: batchNo,
      qty: { lt: db.bin.fields.capacity },
    },
    orderBy: { qty: "asc" },
  });
  if (sameBatch) return sameBatch;

  const empty = await db.bin.findFirst({
    where: { ...whFilter, productId: null, qty: 0 },
    orderBy: [{ zone: "asc" }, { shelf: "asc" }, { bin: "asc" }],
  });
  if (empty) return empty;

  const matching = await db.bin.findFirst({
    where: { ...whFilter, productId, batch: null },
    orderBy: { qty: "asc" },
  });
  if (matching) return matching;

  if (warehouseId) {
    const wh = await db.warehouse.findUnique({
      where: { id: warehouseId },
      select: { id: true, code: true, scanPrefix: true },
    });
    const product = await db.product.findUnique({
      where: { id: productId },
      select: { sku: true },
    });
    if (wh && product) {
      return resolveReceiveBinForProduct(db, wh, productId, product.sku);
    }
  }

  if (!warehouseId) {
    return db.bin.findFirst({
      where: { productId: null, qty: 0 },
      orderBy: [{ zone: "asc" }, { shelf: "asc" }, { bin: "asc" }],
    });
  }
  return null;
};

export type LotReceiveArgs = {
  productId: string;
  variantId?: string | null;
  batchNo: string;
  qty: number;
  sourceRef: string;
  expiryDate?: Date | null;
  grnItemId: string;
  warehouseId?: string | null;
  /** When set, receive into this bin instead of auto-picking. */
  binId?: string | null;
};

/** Post a GRN line into a new StockLot + bin + ledger row. */
export const receiveStockLot = async (args: LotReceiveArgs) => {
  let bin: Bin | null = null;
  if (args.binId) {
    bin = await db.bin.findUnique({ where: { id: args.binId } });
    if (!bin) throw new Error("bin_not_found");
    if (
      bin.productId &&
      bin.productId !== args.productId &&
      bin.qty > 0
    ) {
      throw new Error("bin_product_mismatch");
    }
  } else {
    bin = await pickBinForLotReceive(
      args.warehouseId ?? null,
      args.productId,
      args.batchNo
    );
  }
  if (!bin) {
    throw new Error("no_receive_bin");
  }

  const wh = await db.warehouse.findUnique({
    where: { id: bin.warehouseId },
    select: { name: true },
  });
  const binLabel = formatLocationPath(bin, wh?.name ?? null);
  const lot = await db.stockLot.create({
    data: {
      productId: args.productId,
      variantId: args.variantId ?? null,
      batchNo: args.batchNo,
      sourceType: "grn",
      sourceRef: args.sourceRef,
      receivedAt: new Date(),
      expiryDate: args.expiryDate ?? null,
      qtyOnHand: args.qty,
      warehouseId: bin.warehouseId,
      binId: bin.id,
      grnItemId: args.grnItemId,
    },
  });

  const updatedBin = await db.bin.update({
    where: { id: bin.id },
    data: {
      qty: { increment: args.qty },
      productId: bin.productId ?? args.productId,
      variantId: bin.variantId ?? args.variantId ?? null,
      batch: args.batchNo,
      occupied: { increment: args.qty },
    },
  });

  const ledger = await db.stockLedger.create({
    data: {
      productId: args.productId,
      variantId: args.variantId ?? null,
      warehouseId: bin.warehouseId,
      bin: binLabel,
      batch: args.batchNo,
      lotId: lot.id,
      txnType: "GRN",
      ref: args.sourceRef,
      qty: args.qty,
      balance: updatedBin.qty,
      date: new Date(),
    },
  });

  return { lot, bin: updatedBin, binLabel, ledger };
};

export type FifoAllocation = {
  lot: StockLot & { bin: Bin | null };
  take: number;
  batchNo: string;
  binLabel: string;
};

/** Plan FIFO lot allocations for a product qty (oldest receivedAt first). */
export const planFifoLots = async (args: {
  productId: string;
  warehouseId: string | null;
  strictWarehouse: boolean;
  qtyNeeded: number;
  variantId?: string | null;
}): Promise<FifoAllocation[]> => {
  if (args.qtyNeeded <= 0) return [];

  const where: Prisma.StockLotWhereInput = {
    productId: args.productId,
    qtyOnHand: { gt: 0 },
    ...(args.variantId ? { variantId: args.variantId } : { variantId: null }),
    ...(args.warehouseId ? { warehouseId: args.warehouseId } : {}),
  };

  let lots = await db.stockLot.findMany({
    where,
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    include: { bin: true },
  });

  if (lots.length === 0 && args.strictWarehouse && args.warehouseId) {
    return [];
  }

  if (lots.length === 0 && !args.strictWarehouse && args.warehouseId) {
    lots = await db.stockLot.findMany({
      where: {
        productId: args.productId,
        qtyOnHand: { gt: 0 },
        ...(args.variantId ? { variantId: args.variantId } : { variantId: null }),
      },
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
      include: { bin: true },
    });
  }

  const out: FifoAllocation[] = [];
  let remaining = args.qtyNeeded;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.qtyOnHand, remaining);
    if (take <= 0) continue;
    const b = lot.bin;
    out.push({
      lot,
      take,
      batchNo: lot.batchNo,
      binLabel: b ? `${b.zone}/${b.shelf}/${b.bin}` : "—",
    });
    remaining -= take;
  }
  return out;
};

/** Consume qty from a lot, its bin, and write an Issue ledger row. */
export const consumeFromLot = async (args: {
  lotId: string;
  take: number;
  ref: string;
  variantId?: string | null;
}) => {
  const lot = await db.stockLot.findUnique({
    where: { id: args.lotId },
    include: { bin: true },
  });
  if (!lot || lot.qtyOnHand < args.take) {
    throw new Error("insufficient_lot_qty");
  }

  const updatedLot = await db.stockLot.update({
    where: { id: lot.id },
    data: { qtyOnHand: { decrement: args.take } },
  });

  let balance = 0;
  let binLabel = "—";
  if (lot.binId && lot.bin) {
    const updatedBin = await db.bin.update({
      where: { id: lot.binId },
      data: { qty: { decrement: args.take } },
    });
    balance = updatedBin.qty;
    binLabel = `${lot.bin.zone}/${lot.bin.shelf}/${lot.bin.bin}`;
    if (updatedBin.qty <= 0 && updatedLot.qtyOnHand <= 0) {
      await db.bin.update({
        where: { id: lot.binId },
        data: { batch: null },
      });
    }
  }

  const ledger = await db.stockLedger.create({
    data: {
      productId: lot.productId,
      variantId: args.variantId ?? lot.variantId,
      warehouseId: lot.warehouseId,
      bin: binLabel,
      batch: lot.batchNo,
      lotId: lot.id,
      txnType: "Issue",
      ref: args.ref,
      qty: -args.take,
      balance,
      date: new Date(),
    },
  });

  return { lot: updatedLot, ledger, binLabel, batchNo: lot.batchNo };
};

/** Legacy bins with stock but no lot rows — FIFO by bin updatedAt. */
export const planLegacyBinIssue = async (args: {
  productId: string;
  warehouseId: string | null;
  strictWarehouse: boolean;
  qtyNeeded: number;
  excludeBinIds?: Set<string>;
  variantId?: string | null;
}): Promise<Array<{ bin: Bin; take: number; binLabel: string }>> => {
  if (args.qtyNeeded <= 0) return [];

  const lotBins = await db.stockLot.findMany({
    where: { productId: args.productId, qtyOnHand: { gt: 0 } },
    select: { binId: true, qtyOnHand: true },
  });
  const lotQtyByBin = new Map<string, number>();
  for (const row of lotBins) {
    if (!row.binId) continue;
    lotQtyByBin.set(row.binId, (lotQtyByBin.get(row.binId) ?? 0) + row.qtyOnHand);
  }

  // Bulk parent issue (no variantId): only untagged parent bins — not sale variants.
  // Variant-scoped issue: exact variant match only (e.g. SOAP-PROC on pack MO).
  const variantFilter =
    args.variantId != null && args.variantId !== ""
      ? { variantId: args.variantId }
      : { variantId: null };

  const whWhere = args.warehouseId ? { warehouseId: args.warehouseId } : {};
  let bins = await db.bin.findMany({
    where: { ...whWhere, productId: args.productId, qty: { gt: 0 }, ...variantFilter },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
  });

  if (bins.length === 0 && args.strictWarehouse && args.warehouseId) {
    return [];
  }
  if (bins.length === 0 && !args.strictWarehouse && args.warehouseId) {
    bins = await db.bin.findMany({
      where: { productId: args.productId, qty: { gt: 0 }, ...variantFilter },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    });
  }

  const out: Array<{ bin: Bin; take: number; binLabel: string }> = [];
  let remaining = args.qtyNeeded;
  for (const bin of bins) {
    if (remaining <= 0) break;
    if (args.excludeBinIds?.has(bin.id)) continue;
    const lotHeld = lotQtyByBin.get(bin.id) ?? 0;
    const legacyFree = bin.qty - lotHeld;
    if (legacyFree <= 0) continue;
    const take = Math.min(legacyFree, remaining);
    out.push({
      bin,
      take,
      binLabel: `${bin.zone}/${bin.shelf}/${bin.bin}`,
    });
    remaining -= take;
  }
  return out;
};

/** Issue material qty: FIFO lots first, then untracked bin stock. */
export const issueMaterialFifo = async (args: {
  productId: string;
  warehouseId: string | null;
  strictWarehouse: boolean;
  qty: number;
  ref: string;
  variantId?: string | null;
}): Promise<{
  issued: number;
  allocations: Array<{ batch?: string; qty: number; bin: string; lotId?: string }>;
  binIds: string[];
}> => {
  let remaining = args.qty;
  const allocations: Array<{ batch?: string; qty: number; bin: string; lotId?: string }> = [];
  const binIds = new Set<string>();

  const lotPlan = await planFifoLots({
    productId: args.productId,
    warehouseId: args.warehouseId,
    strictWarehouse: args.strictWarehouse,
    qtyNeeded: remaining,
    variantId: args.variantId,
  });

  for (const row of lotPlan) {
    await consumeFromLot({
      lotId: row.lot.id,
      take: row.take,
      ref: args.ref,
      variantId: args.variantId,
    });
    allocations.push({
      batch: row.batchNo,
      qty: row.take,
      bin: row.binLabel,
      lotId: row.lot.id,
    });
    if (row.lot.binId) binIds.add(row.lot.binId);
    remaining -= row.take;
  }

  if (remaining > 0) {
    const legacy = await planLegacyBinIssue({
      productId: args.productId,
      warehouseId: args.warehouseId,
      strictWarehouse: args.strictWarehouse,
      qtyNeeded: remaining,
      variantId: args.variantId,
    });
    for (const row of legacy) {
      const updatedBin = await db.bin.update({
        where: { id: row.bin.id },
        data: { qty: { decrement: row.take } },
      });
      binIds.add(row.bin.id);
      await db.stockLedger.create({
        data: {
          productId: args.productId,
          variantId: args.variantId ?? null,
          warehouseId: row.bin.warehouseId,
          bin: row.binLabel,
          batch: row.bin.batch,
          txnType: "Issue",
          ref: args.ref,
          qty: -row.take,
          balance: updatedBin.qty,
          date: new Date(),
        },
      });
      allocations.push({
        batch: row.bin.batch ?? undefined,
        qty: row.take,
        bin: row.binLabel,
      });
      remaining -= row.take;
    }
  }

  return {
    issued: args.qty - remaining,
    allocations,
    binIds: [...binIds],
  };
};
