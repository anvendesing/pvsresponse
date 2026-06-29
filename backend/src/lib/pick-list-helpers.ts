// Shared helpers for pick-list / packing-slip / invoice numbering and
// bin-allocation logic. Extracted from fulfilment.ts so the storefront
// mock endpoint (and any other future caller, e.g. import-from-Excel)
// can build pick lists without going through the request-bound route
// handler.
import { db } from "../db.js";

// Imported (external-channel) orders use their own invoice series so
// reports and audits can distinguish channel revenue from back-office
// billing at a glance. The base sequence starts at 1 so the first
// imported invoice is IMP-INV-2026-0001 regardless of how many B2B
// invoices exist.
export const nextImportedInvoiceNo = async (
  year: number,
  base = 1
): Promise<string> => {
  const where = { startsWith: `IMP-INV-${year}-` };
  const rows = await db.invoice.findMany({
    where: { invoiceNo: where },
    select: { invoiceNo: true },
  });
  const tail = rows
    .map((r) => parseInt(r.invoiceNo.split("-").pop() ?? "0", 10))
    .filter((n) => Number.isFinite(n));
  const max = tail.length > 0 ? Math.max(...tail) : base - 1;
  return `IMP-INV-${year}-${String(max + 1).padStart(4, "0")}`;
};

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
// `variantId` narrows the candidate bins. When provided we prefer
// bins explicitly tagged with that variant; if none exist we fall
// back to bins that hold the parent product without a variant tag
// (legacy untagged stock). When `variantId` is null the function
// returns parent-product bins as before — same behaviour as before
// Bin.variantId existed.
//
// prevAllocations lets callers chain multiple lines in the same pick
// list - earlier allocations are deducted from each bin's free qty so
// two lines for the same SKU can't claim the same physical units.
export const splitAcrossBins = async (
  productId: string,
  qtyNeeded: number,
  prevAllocations: Map<string, number> = new Map(),
  variantId: string | null = null
): Promise<{ binId: string; qty: number }[]> => {
  if (qtyNeeded <= 0) return [];

  // When a variantId is given, prefer variant-tagged bins. If we get
  // none we fall back to legacy untagged bins (variantId IS NULL) for
  // the same parent — that path is intentionally lossy but lets the
  // system keep working on data that pre-dates variant tagging.
  let candidates = variantId
    ? await db.bin.findMany({
        where: { productId, variantId, qty: { gt: 0 } },
        orderBy: [{ qty: "desc" }, { bin: "asc" }],
        select: { id: true, qty: true, reservedQty: true },
      })
    : await db.bin.findMany({
        where: { productId, qty: { gt: 0 } },
        orderBy: [{ qty: "desc" }, { bin: "asc" }],
        select: { id: true, qty: true, reservedQty: true },
      });
  if (variantId && candidates.length === 0) {
    candidates = await db.bin.findMany({
      where: { productId, variantId: null, qty: { gt: 0 } },
      orderBy: [{ qty: "desc" }, { bin: "asc" }],
      select: { id: true, qty: true, reservedQty: true },
    });
  }

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

/** Bin key for walk-path ordering (zone → shelf → bin). Lines without a bin sort last. */
export const comparePickItemsByBinWalkPath = <
  T extends {
    bin?: { zone?: string | null; shelf?: string | null; bin?: string | null } | null;
  },
>(
  a: T,
  b: T
): number => {
  const aKey = a.bin ? `${a.bin.zone}|${a.bin.shelf}|${a.bin.bin}` : "~";
  const bKey = b.bin ? `${b.bin.zone}|${b.bin.shelf}|${b.bin.bin}` : "~";
  return aKey.localeCompare(bKey);
};

/** In-place sort for pick-list lines when walk-path ordering is enabled. */
export const sortPickListItemsByBinWalkPath = <
  T extends {
    bin?: { zone?: string | null; shelf?: string | null; bin?: string | null } | null;
  },
>(
  items: T[]
): T[] => {
  items.sort(comparePickItemsByBinWalkPath);
  return items;
};
