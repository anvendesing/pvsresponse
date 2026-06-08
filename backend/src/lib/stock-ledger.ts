import { db } from "../db.js";

/** Resolve warehouse + bin label for a Sale ledger row from the pick
 *  bin that was actually decremented. Call AFTER the bin qty update so
 *  `balance` reflects the post-decrement on-hand in that bin. */
export async function saleLedgerContextFromBin(
  binId: string | null | undefined
): Promise<{ warehouseId: string; bin: string | null; balance: number } | null> {
  if (!binId) {
    const wh = await db.warehouse.findFirst({
      orderBy: { code: "asc" },
      select: { id: true },
    });
    if (!wh) return null;
    return { warehouseId: wh.id, bin: null, balance: 0 };
  }
  const b = await db.bin.findUnique({
    where: { id: binId },
    select: {
      warehouseId: true,
      zone: true,
      shelf: true,
      bin: true,
      qty: true,
    },
  });
  if (!b) return null;
  return {
    warehouseId: b.warehouseId,
    bin: `${b.zone}/${b.shelf}/${b.bin}`,
    balance: Math.max(0, b.qty),
  };
}

export async function createSaleLedgerFromPickBin(args: {
  productId: string;
  variantId?: string | null;
  qty: number;
  ref: string;
  binId?: string | null;
}) {
  const ctx = await saleLedgerContextFromBin(args.binId);
  if (!ctx) return null;
  return db.stockLedger.create({
    data: {
      productId: args.productId,
      variantId: args.variantId ?? null,
      warehouseId: ctx.warehouseId,
      bin: ctx.bin,
      txnType: "Sale",
      qty: -Math.round(args.qty),
      balance: ctx.balance,
      ref: args.ref,
    },
  });
}
