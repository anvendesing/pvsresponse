// Pick-list creator extracted from fulfilment.ts so non-request callers
// (storefront mock order, future import-from-Excel, scheduled jobs) can
// build a pick list for a confirmed sales order without going through
// the HTTP route. The route handler at
// POST /sales-orders/:id/pick-lists now delegates to this function.
//
// Behaviour mirrors the route exactly:
//   - Refuses if SO is in a terminal/locked state (cancelled/closed/on_hold).
//   - Refuses if there is already an open pick list (draft|picking) on
//     the SO; caller must complete or cancel that first.
//   - Computes per-line "remaining" qty by subtracting both invoiced /
//     cancelled quantities and any qty already on open pick lists.
//   - Splits each line across the largest free bins first, chaining
//     allocations across lines so two lines for the same product can't
//     double-book the same physical units.
//   - Returns the freshly inserted pick list. Caller is responsible for
//     deciding when to recordChange() (route handler does it; storefront
//     mock does it inline so the audit user is the system actor).
import { db } from "../db.js";
import {
  nextFulfilmentDocNo,
  splitAcrossBins,
} from "../lib/pick-list-helpers.js";

export type PickListCreateError =
  | { code: "not_found"; message: string }
  | { code: "bad_state"; message: string }
  | { code: "open_pick_list"; message: string }
  | { code: "fully_invoiced"; message: string };

export type PickListCreateResult =
  | { ok: true; pickList: { id: string; pickListNo: string } }
  | { ok: false; error: PickListCreateError };

export const createPickListForSalesOrder = async (
  salesOrderId: string,
  createdById: string
): Promise<PickListCreateResult> => {
  const so = await db.salesOrder.findUnique({
    where: { id: salesOrderId },
    include: {
      items: true,
      pickLists: {
        where: { status: { in: ["draft", "picking"] } },
        select: { id: true, pickListNo: true },
      },
    },
  });
  if (!so) {
    return {
      ok: false,
      error: { code: "not_found", message: "Sales order not found." },
    };
  }
  if (["cancelled", "closed", "on_hold"].includes(so.status)) {
    return {
      ok: false,
      error: { code: "bad_state", message: `SO is in '${so.status}'.` },
    };
  }
  if (so.pickLists.length > 0) {
    return {
      ok: false,
      error: {
        code: "open_pick_list",
        message: `Pick list ${so.pickLists[0].pickListNo} is already open. Complete or cancel it first.`,
      },
    };
  }

  const onPickAgg = await db.pickListItem.findMany({
    where: {
      salesOrderItemId: { in: so.items.map((i) => i.id) },
      pickList: { status: { in: ["draft", "picking"] } },
    },
    select: { salesOrderItemId: true, qtyToPick: true },
  });
  const onPickMap = new Map<string, number>();
  for (const r of onPickAgg) {
    onPickMap.set(
      r.salesOrderItemId,
      (onPickMap.get(r.salesOrderItemId) ?? 0) + r.qtyToPick
    );
  }

  const itemsToCreate: {
    salesOrderItemId: string;
    productId: string;
    variantId: string | null;
    binId: string | null;
    qtyToPick: number;
    qtyPicked: number;
  }[] = [];
  const allocations = new Map<string, number>();
  for (const it of so.items) {
    const remaining =
      it.qtyOrdered -
      it.qtyInvoiced -
      it.qtyCancelled -
      (onPickMap.get(it.id) ?? 0);
    if (remaining <= 0) continue;
    // Variant-aware bin allocation: prefer bins tagged with the
    // line's variant so a 1KG-pack SO line doesn't pick from a
    // 500g-pack bin under the same parent product.
    const splits = await splitAcrossBins(
      it.productId,
      remaining,
      allocations,
      it.variantId
    );
    for (const sp of splits) {
      itemsToCreate.push({
        salesOrderItemId: it.id,
        productId: it.productId,
        variantId: it.variantId ?? null,
        binId: sp.binId || null,
        qtyToPick: sp.qty,
        // Fresh pick list lines start UNCONFIRMED. The mobile picker
        // bumps qtyPicked at scan time; the desktop editor accepts a
        // manual value or runs auto-pick. Pre-filling with sp.qty
        // (the legacy default) made the PWA show every line as
        // "Picked" before the operator did anything.
        qtyPicked: 0,
      });
    }
  }
  if (itemsToCreate.length === 0) {
    return {
      ok: false,
      error: {
        code: "fully_invoiced",
        message: "Nothing left to pick on this SO.",
      },
    };
  }

  const pickListNo = await nextFulfilmentDocNo("PL", 2026, 7001);
  const created = await db.pickList.create({
    data: {
      pickListNo,
      salesOrderId: so.id,
      createdById,
      items: { create: itemsToCreate },
    },
    select: { id: true, pickListNo: true },
  });
  return { ok: true, pickList: created };
};
