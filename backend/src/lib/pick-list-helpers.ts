// Shared helpers for pick-list / packing-slip / invoice numbering and
// bin-allocation logic. Extracted from fulfilment.ts so the storefront
// mock endpoint (and any other future caller, e.g. import-from-Excel)
// can build pick lists without going through the request-bound route
// handler.
import { db } from "../db.js";

export const nextFulfilmentDocNo = async (
  prefix: "PL" | "PS" | "INV",
  year: number,
  base: number
): Promise<string> => {
  const where = { startsWith: `${prefix}-${year}-` };
  let rows: { num: string }[] = [];
  if (prefix === "PL") {
    rows = (
      await db.pickList.findMany({
        where: { pickListNo: where },
        select: { pickListNo: true },
      })
    ).map((r) => ({ num: r.pickListNo }));
  } else if (prefix === "PS") {
    rows = (
      await db.packingSlip.findMany({
        where: { packingSlipNo: where },
        select: { packingSlipNo: true },
      })
    ).map((r) => ({ num: r.packingSlipNo }));
  } else {
    rows = (
      await db.invoice.findMany({
        where: { invoiceNo: where },
        select: { invoiceNo: true },
      })
    ).map((r) => ({ num: r.invoiceNo }));
  }
  const tail = rows
    .map((r) => parseInt(r.num.split("-").pop() ?? "0", 10))
    .filter((n) => Number.isFinite(n));
  const max = tail.length > 0 ? Math.max(...tail) : base - 1;
  return `${prefix}-${year}-${String(max + 1).padStart(4, "0")}`;
};

// Split a requested qty across one or more bins, picking the largest
// free-to-pick qty first. Returns (binId, qty) pairs that together
// fulfill qtyNeeded. When stock is insufficient the trailing pair
// carries the shortage so the operator still sees a row to scan
// against and short-pick.
//
// prevAllocations lets callers chain multiple lines in the same pick
// list - earlier allocations are deducted from each bin's free qty so
// two lines for the same SKU can't claim the same physical units.
export const splitAcrossBins = async (
  productId: string,
  qtyNeeded: number,
  prevAllocations: Map<string, number> = new Map()
): Promise<{ binId: string; qty: number }[]> => {
  if (qtyNeeded <= 0) return [];
  const candidates = await db.bin.findMany({
    where: { productId, qty: { gt: 0 } },
    orderBy: [{ qty: "desc" }, { bin: "asc" }],
    select: { id: true, qty: true, reservedQty: true },
  });

  const splits: { binId: string; qty: number }[] = [];
  let remaining = qtyNeeded;
  for (const c of candidates) {
    if (remaining <= 0) break;
    const free = c.qty - c.reservedQty - (prevAllocations.get(c.id) ?? 0);
    if (free <= 0) continue;
    const take = Math.min(free, remaining);
    splits.push({ binId: c.id, qty: take });
    prevAllocations.set(c.id, (prevAllocations.get(c.id) ?? 0) + take);
    remaining -= take;
  }
  if (splits.length === 0) {
    return [{ binId: "", qty: qtyNeeded }];
  }
  if (remaining > 0) {
    splits.push({ binId: "", qty: remaining });
  }
  return splits;
};
