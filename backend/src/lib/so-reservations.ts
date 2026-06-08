// Hard-reserve helpers for sales orders.
//
// When an SO is confirmed, we lock specific bin qty against each line
// so the Reserved column in Inventory / Locations actually reflects
// pending sales orders — not just the soft `reservedForSO` figure that
// ATP uses. The bin-side authority is `Bin.reservedQty`, which is
// equal to (sum of SO reservations + sum of pick-list reservations)
// for that bin.
//
// Lifecycle:
//   * SO confirm  / quote-confirm / SO resume     → reserveSalesOrder
//   * SO cancel   / SO hold                       → releaseSalesOrder
//   * Invoice draw-down (qtyInvoiced ↑)           → reserveSalesOrder
//                                                   (release-then-reserve;
//                                                   shrinks reservation
//                                                   to the new remaining)
//   * Pick → picked                               → consumeForPick
//                                                   (transfers reservation
//                                                   from SO row to pick
//                                                   list reservation on
//                                                   the bin Bin.reservedQty
//                                                   stays put unless the
//                                                   picker chose another
//                                                   bin, in which case it
//                                                   transfers).

import { db } from "../db.js";
import { splitAcrossBins } from "./pick-list-helpers.js";

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0] | typeof db;

/**
 * Release every SO reservation for `salesOrderId`, decrementing each
 * bin's reservedQty. Idempotent.
 */
export const releaseSalesOrderReservations = async (
  salesOrderId: string,
  tx: Tx = db
): Promise<{ released: number; bins: number }> => {
  const items = await tx.salesOrderItem.findMany({
    where: { salesOrderId },
    select: { id: true },
  });
  if (items.length === 0) return { released: 0, bins: 0 };
  return releaseSalesOrderItemReservations(
    items.map((i) => i.id),
    tx
  );
};

/**
 * Release SO reservations for a specific set of SO line ids. Used by
 * the pick→picked hook so the picked qty's reservation moves cleanly
 * from the SO-level row to the pick-list-level Bin.reservedQty bump
 * the existing fulfilment code already performs.
 */
export const releaseSalesOrderItemReservations = async (
  salesOrderItemIds: string[],
  tx: Tx = db
): Promise<{ released: number; bins: number }> => {
  if (salesOrderItemIds.length === 0) return { released: 0, bins: 0 };
  const reservations = await tx.salesOrderReservation.findMany({
    where: { salesOrderItemId: { in: salesOrderItemIds } },
    select: { id: true, binId: true, qty: true },
  });
  if (reservations.length === 0) return { released: 0, bins: 0 };

  // Aggregate by bin so we minimize round-trips.
  const byBin = new Map<string, number>();
  for (const r of reservations) {
    byBin.set(r.binId, (byBin.get(r.binId) ?? 0) + r.qty);
  }
  for (const [binId, qty] of byBin) {
    await tx.bin.update({
      where: { id: binId },
      data: { reservedQty: { decrement: qty } },
    });
  }
  await tx.salesOrderReservation.deleteMany({
    where: { id: { in: reservations.map((r) => r.id) } },
  });
  return {
    released: reservations.reduce((s, r) => s + r.qty, 0),
    bins: byBin.size,
  };
};

/**
 * Walk every open line on `salesOrderId` and (re)reserve the
 * outstanding qty (qtyOrdered − qtyInvoiced − qtyCancelled) against
 * the best bins.
 *
 * Idempotent — calling it twice is a no-op. The implementation
 * releases all existing SO reservations first and then reserves
 * fresh, which means it also corrects drift after partial invoicing
 * or qty cancellation.
 *
 * Stock allocation uses `splitAcrossBins` so concurrent SOs don't
 * claim the same physical units (it nets out reservedQty already
 * in flight).
 */
export const reserveSalesOrderStock = async (
  salesOrderId: string,
  tx: Tx = db
): Promise<{
  reserved: Array<{
    salesOrderItemId: string;
    productId: string;
    sku: string;
    requested: number;
    reserved: number;
    short: number;
    splits: Array<{ binId: string; qty: number; binPath: string }>;
  }>;
}> => {
  const so = await tx.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: {
      status: true,
      items: {
        select: {
          id: true,
          productId: true,
          variantId: true,
          qtyOrdered: true,
          qtyInvoiced: true,
          qtyCancelled: true,
          product: { select: { sku: true } },
        },
      },
    },
  });
  if (!so) throw new Error(`Sales order ${salesOrderId} not found`);

  // Only confirmed-ish statuses hold reservations. on_hold / cancelled
  // / closed / fully invoiced should not. Caller is responsible for
  // calling release in those flows; we defensively no-op here too.
  if (
    so.status !== "confirmed" &&
    so.status !== "partially_invoiced"
  ) {
    await releaseSalesOrderReservations(salesOrderId, tx);
    return { reserved: [] };
  }

  // Wipe and re-allocate from scratch.
  await releaseSalesOrderReservations(salesOrderId, tx);

  const reserved: Awaited<ReturnType<typeof reserveSalesOrderStock>>["reserved"] = [];
  // prevAllocations is shared across lines so two lines for the same
  // SKU never both claim the same physical units in the same call.
  const prev = new Map<string, number>();

  for (const it of so.items) {
    const remaining = Math.max(
      0,
      Math.round(it.qtyOrdered - it.qtyInvoiced - it.qtyCancelled)
    );
    if (remaining === 0) continue;

    // Variant-aware reservation. splitAcrossBins prefers bins tagged
    // with the requested variant (Bin.variantId) and falls back to
    // legacy untagged parent-product bins when no variant-tagged bin
    // exists. This keeps SOs for different variants of the same
    // parent product from landing on each other's physical stock.
    const splits = await splitAcrossBins(
      it.productId,
      remaining,
      prev,
      it.variantId
    );
    const realSplits = splits.filter((s) => s.binId);
    const short = splits
      .filter((s) => !s.binId)
      .reduce((sum, s) => sum + s.qty, 0);

    let reservedQty = 0;
    const splitDetails: Array<{ binId: string; qty: number; binPath: string }> = [];
    for (const sp of realSplits) {
      await tx.bin.update({
        where: { id: sp.binId },
        data: { reservedQty: { increment: sp.qty } },
      });
      const created = await tx.salesOrderReservation.create({
        data: {
          salesOrderItemId: it.id,
          binId: sp.binId,
          qty: sp.qty,
        },
      });
      const bin = await tx.bin.findUnique({
        where: { id: created.binId },
        select: { zone: true, shelf: true, bin: true },
      });
      splitDetails.push({
        binId: sp.binId,
        qty: sp.qty,
        binPath: bin
          ? `${bin.zone}/${bin.shelf}/${bin.bin}`
          : "—",
      });
      reservedQty += sp.qty;
    }

    reserved.push({
      salesOrderItemId: it.id,
      productId: it.productId,
      sku: it.product.sku,
      requested: remaining,
      reserved: reservedQty,
      short,
      splits: splitDetails,
    });
  }
  return { reserved };
};

/**
 * Called from pick→picked. For each (SO line, qty) about to be
 * "physically" reserved at the picker's chosen bin, drain that qty
 * from the SO reservations on that line so we don't double-count.
 *
 * The existing pick→picked code increments Bin.reservedQty by
 * qtyPicked at the picker's bin, so the net effect is "the
 * reservation moves from SO-level to pick-list-level on the same
 * bin". If the picker chose a different bin than reserved, the
 * original bin sees a release, the new bin sees an increment, and
 * total reservedQty across the warehouse stays equal to the
 * outstanding SO qty.
 */
export const consumeReservationsForPickedItems = async (
  picks: Array<{ salesOrderItemId: string; qty: number }>,
  tx: Tx = db
): Promise<void> => {
  // Aggregate per SO line.
  const byLine = new Map<string, number>();
  for (const p of picks) {
    if (p.qty <= 0) continue;
    byLine.set(
      p.salesOrderItemId,
      (byLine.get(p.salesOrderItemId) ?? 0) + Math.round(p.qty)
    );
  }
  if (byLine.size === 0) return;

  for (const [salesOrderItemId, qtyToConsume] of byLine) {
    let remaining = qtyToConsume;
    const reservations = await tx.salesOrderReservation.findMany({
      where: { salesOrderItemId },
      orderBy: { createdAt: "asc" },
    });
    for (const r of reservations) {
      if (remaining <= 0) break;
      const take = Math.min(r.qty, remaining);
      await tx.bin.update({
        where: { id: r.binId },
        data: { reservedQty: { decrement: take } },
      });
      if (r.qty <= take) {
        await tx.salesOrderReservation.delete({ where: { id: r.id } });
      } else {
        await tx.salesOrderReservation.update({
          where: { id: r.id },
          data: { qty: r.qty - take },
        });
      }
      remaining -= take;
    }
    // If `remaining > 0` here, it means the picker is picking more
    // than was reserved (e.g. a manual top-up after partial reserve).
    // That's fine — the existing pick→picked Bin.reservedQty bump
    // takes care of those units, just without a SO row to consume.
  }
};
