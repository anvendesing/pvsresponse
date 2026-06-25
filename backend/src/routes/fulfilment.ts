// Fulfilment: PickList -> PackingSlip -> Invoice
//
// Why these are separate from /sales-orders:
//   - Pick is a warehouse activity (operator + bin assignment).
//   - Pack is a QC/dispatch activity where actual qty is recorded; this
//     can legitimately differ from picked qty (handling damage, weight
//     variance, short count). qtyPacked is the source of truth for
//     invoicing - this is the customer's explicit requirement.
//   - Stock semantics: picking only reserves Bin.qty (Bin.reservedQty
//     ++); the actual ledger entry / Bin.qty decrement happens at
//     invoicing. If qtyPacked < qtyPicked, the excess reservation is
//     released back; if qtyPacked > qtyPicked we 409 (you can't pack
//     more than was picked).

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { mintShareToken } from "../lib/share.js";
import {
  nextFulfilmentDocNo,
  splitAcrossBins,
} from "../lib/pick-list-helpers.js";
import { createPickListForSalesOrder } from "../services/pick-list-create.js";
import { codesEqual } from "../lib/text-search.js";
import {
  ensureAutoBundleContainer,
  nextContainerSeq,
  packContainerInclude,
  recomputeContainer,
  recomputePackingSlipWeight,
  renumberContainers,
  validateContainerAllocations,
} from "../lib/packing-containers.js";
import { ensureDefaultContainerTypes } from "../lib/container-types-seed.js";
import { containerCode, parseContainerCode } from "../lib/container-codes.js";
import {
  ensureInvoiceForSalesOrder,
  reconcileInvoiceWithPack,
} from "../services/invoice-create.js";
import { consumeReservationsForPickedItems } from "../lib/so-reservations.js";
import { createSaleLedgerFromPickBin } from "../lib/stock-ledger.js";
import { recordChange } from "../sync/log.js";

// Local alias kept so the rest of this file - which already uses
// `nextDocNo(...)` in many places - doesn't need to be touched.
const nextDocNo = nextFulfilmentDocNo;

const fullPickInclude = {
  salesOrder: {
    select: {
      id: true,
      soNo: true,
      status: true,
      customerId: true,
      customer: { select: { id: true, name: true, code: true, addressLine: true, city: true, state: true, pincode: true } },
    },
  },
  assignedTo: { select: { id: true, name: true, username: true } },
  // Once a pick is completed it forks into a packing slip - we expose
  // the link so the mobile UI can route the worker forward instead
  // of leaving them stranded on a locked pick page.
  packingSlip: { select: { id: true, packingSlipNo: true, status: true } },
  items: {
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true, stockOnHand: true, barcode: true } },
      variant: {
        select: {
          id: true,
          sku: true,
          size: true,
          color: true,
          grade: true,
          uom: true,
          packSize: true,
          stockOnHand: true,
          barcode: true,
        },
      },
      bin: {
        select: {
          id: true,
          code: true,
          zone: true,
          shelf: true,
          bin: true,
          qty: true,
          reservedQty: true,
        },
      },
    },
  },
} as const;

const fullPackInclude = {
  salesOrder: {
    select: {
      id: true,
      soNo: true,
      status: true,
      customerId: true,
      subTotal: true,
      tax: true,
      total: true,
      transportCharge: true,
      transportTax: true,
      dispatchOptionId: true,
      dispatchOption: { select: { id: true, name: true, code: true } },
      customer: { select: { id: true, name: true, code: true, addressLine: true, city: true, state: true, pincode: true } },
    },
  },
  assignedTo: { select: { id: true, name: true, username: true } },
  pickList: { select: { id: true, pickListNo: true, status: true } },
  invoice: {
    select: {
      id: true,
      invoiceNo: true,
      amount: true,
      tax: true,
      transportCharge: true,
      transportTax: true,
      status: true,
      date: true,
    },
  },
  items: {
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true, stockOnHand: true, barcode: true, weightKg: true } },
      variant: {
        select: {
          id: true,
          sku: true,
          size: true,
          color: true,
          grade: true,
          uom: true,
          packSize: true,
          stockOnHand: true,
          barcode: true,
          weightKg: true,
        },
      },
    },
  },
  containers: {
    include: packContainerInclude,
    orderBy: { seq: "asc" } as const,
  },
} as const;

// =========================================================== route module ===

export const fulfilmentRoutes = async (app: FastifyInstance) => {
  // ============================================================ Pick Lists ===

  app.get("/pick-lists", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    return db.pickList.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.salesOrderId ? { salesOrderId: q.salesOrderId } : {}),
        ...(q.unassigned === "1" ? { assignedToId: null } : {}),
        ...(q.assignedToId ? { assignedToId: q.assignedToId } : {}),
      },
      include: {
        salesOrder: {
          select: {
            id: true,
            soNo: true,
            customer: { select: { name: true, code: true } },
          },
        },
        assignedTo: { select: { id: true, name: true, username: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
      take: q.limit ? parseInt(q.limit, 10) : 200,
    });
  });

  app.get("/pick-lists/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const pl = await db.pickList.findUnique({ where: { id }, include: fullPickInclude });
    if (!pl) return reply.code(404).send({ error: { code: "not_found" } });
    // Walk-path ordering: sort lines by the bin's zone/shelf/bin
    // so the mobile picker walks the warehouse in a predictable
    // serpentine instead of zig-zagging. Lines without a bin go last.
    pl.items.sort((a, b) => {
      const aKey = a.bin
        ? `${a.bin.zone}|${a.bin.shelf}|${a.bin.bin}`
        : "~";
      const bKey = b.bin
        ? `${b.bin.zone}|${b.bin.shelf}|${b.bin.bin}`
        : "~";
      return aKey.localeCompare(bKey);
    });
    return pl;
  });

  // Create from a Sales Order. Pre-fills suggested bins + qtyToPick =
  // remaining (qtyOrdered - qtyInvoiced - qtyCancelled - reservedOnSoLine).
  app.post(
    "/sales-orders/:id/pick-lists",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const result = await createPickListForSalesOrder(id, req.user.sub);
      if (!result.ok) {
        const status = result.error.code === "not_found" ? 404 : 409;
        return reply.code(status).send({ error: result.error });
      }
      const created = await db.pickList.findUnique({
        where: { id: result.pickList.id },
        include: fullPickInclude,
      });
      await recordChange("PickList", result.pickList.id, "insert", created, req.user.sub);
      return created;
    }
  );

  // Edit per-line bin / qtyPicked / qtyToPick. Allowed in draft|picking.
  app.patch("/pick-lists/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = z
      .object({
        notes: z.string().nullable().optional(),
        items: z
          .array(
            z.object({
              id: z.string(),
              binId: z.string().nullable().optional(),
              qtyPicked: z.number().nonnegative().optional(),
              qtyToPick: z.number().nonnegative().optional(),
              notes: z.string().nullable().optional(),
            })
          )
          .optional(),
      })
      .parse(req.body);

    const pl = await db.pickList.findUnique({ where: { id } });
    if (!pl) return reply.code(404).send({ error: { code: "not_found" } });
    if (!["draft", "picking"].includes(pl.status)) {
      return reply.code(409).send({
        error: { code: "locked", message: `Pick list is '${pl.status}'.` },
      });
    }

    if (body.notes !== undefined) {
      await db.pickList.update({ where: { id }, data: { notes: body.notes } });
    }
    if (body.items) {
      for (const it of body.items) {
        await db.pickListItem.update({
          where: { id: it.id },
          data: {
            ...(it.binId !== undefined ? { binId: it.binId } : {}),
            ...(it.qtyPicked !== undefined ? { qtyPicked: it.qtyPicked } : {}),
            ...(it.qtyToPick !== undefined ? { qtyToPick: it.qtyToPick } : {}),
            ...(it.notes !== undefined ? { notes: it.notes } : {}),
          },
        });
      }
    }
    const updated = await db.pickList.update({
      where: { id },
      data: { status: pl.status === "draft" ? "picking" : pl.status },
      include: fullPickInclude,
    });
    await recordChange("PickList", id, "update", updated, req.user.sub);
    return updated;
  });

  // POST /pick-lists/:id/items - add another bin split to an existing
  // pick-list line. Used when the operator wants to pick the same SO line
  // from a second / third bin (the system's first-fit suggestion isn't
  // enough or the operator finds the goods in a different location).
  app.post(
    "/pick-lists/:id/items",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const body = z
        .object({
          salesOrderItemId: z.string().min(1),
          binId: z.string().nullable().optional(),
          qtyToPick: z.number().positive(),
        })
        .parse(req.body);

      const pl = await db.pickList.findUnique({
        where: { id },
        include: { salesOrder: { include: { items: true } } },
      });
      if (!pl) return reply.code(404).send({ error: { code: "not_found" } });
      if (!["draft", "picking"].includes(pl.status)) {
        return reply.code(409).send({
          error: { code: "locked", message: `Pick list is '${pl.status}'.` },
        });
      }
      const soi = pl.salesOrder.items.find(
        (i) => i.id === body.salesOrderItemId
      );
      if (!soi) {
        return reply.code(400).send({
          error: { code: "bad_request", message: "salesOrderItemId not on this SO" },
        });
      }
      const created = await db.pickListItem.create({
        data: {
          pickListId: pl.id,
          salesOrderItemId: soi.id,
          productId: soi.productId,
          variantId: soi.variantId,
          binId: body.binId || null,
          qtyToPick: body.qtyToPick,
          // Newly added split lines start UNCONFIRMED. qtyPicked is
          // bumped explicitly via the scan flow / desktop edit; auto-
          // filling it with qtyToPick made the mobile screen treat the
          // line as already done.
          qtyPicked: 0,
        },
      });
      // Bump pick list to picking once the operator starts editing splits.
      if (pl.status === "draft") {
        await db.pickList.update({
          where: { id: pl.id },
          data: { status: "picking" },
        });
      }
      await recordChange("PickListItem", created.id, "insert", created, req.user.sub);
      // Return the full pick list so the UI can rebind without a separate fetch.
      return db.pickList.findUnique({ where: { id }, include: fullPickInclude });
    }
  );

  // DELETE /pick-lists/:id/items/:itemId - drop a split row. Refuses if
  // it would leave the SO line with zero rows (use cancel pick list
  // instead) so consumers always have something to scan against.
  app.delete(
    "/pick-lists/:id/items/:itemId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id, itemId } = req.params as { id: string; itemId: string };
      const pl = await db.pickList.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!pl) return reply.code(404).send({ error: { code: "not_found" } });
      if (!["draft", "picking"].includes(pl.status)) {
        return reply.code(409).send({
          error: { code: "locked", message: `Pick list is '${pl.status}'.` },
        });
      }
      const target = pl.items.find((i) => i.id === itemId);
      if (!target) return reply.code(404).send({ error: { code: "not_found" } });
      const siblings = pl.items.filter(
        (i) => i.salesOrderItemId === target.salesOrderItemId
      );
      if (siblings.length <= 1) {
        return reply.code(409).send({
          error: {
            code: "last_split",
            message:
              "This is the only row for that SO line. Edit qty or cancel the pick list instead.",
          },
        });
      }
      await db.pickListItem.delete({ where: { id: itemId } });
      await recordChange("PickListItem", itemId, "delete", target, req.user.sub);
      return db.pickList.findUnique({ where: { id }, include: fullPickInclude });
    }
  );

  // Lock the pick list, reserve stock on bins, auto-create a draft PackingSlip.
  app.post(
    "/pick-lists/:id/complete",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const pl = await db.pickList.findUnique({
        where: { id },
        include: { items: true, salesOrder: true },
      });
      if (!pl) return reply.code(404).send({ error: { code: "not_found" } });
      if (!["draft", "picking"].includes(pl.status)) {
        return reply.code(409).send({
          error: { code: "bad_state", message: `Pick list is '${pl.status}'.` },
        });
      }
      const positives = pl.items.filter((i) => i.qtyPicked > 0);
      if (positives.length === 0) {
        return reply.code(409).send({
          error: { code: "nothing_picked", message: "Pick list has no positive qtyPicked." },
        });
      }

      // Reserve qty on bins. Validate each line first.
      //
      // Two layers of validation, because Bin.qty is tracked at the
      // PARENT product level (a bin doesn't know which variant the
      // units belong to) but a sales-order line can be variant-scoped:
      //
      //   Layer A - bin layer: bin.qty - bin.reservedQty must cover
      //   what we're trying to pick out of THIS bin. Catches "we
      //   physically don't have it on this shelf".
      //
      //   Layer B - variant layer: sum of qtyPicked across ALL pick
      //   lines for the same variant must not exceed
      //   ProductVariant.stockOnHand. Catches "the bin shows 100 of
      //   the parent product but only 2 of THIS specific variant
      //   exist on the floor". Without this, an order for a variant
      //   sails through picking when only sibling variants are stocked.
      const issues: { itemId: string; reason: string }[] = [];
      const variantUsage = new Map<string, number>();
      // Track in-place bin reassignments so we persist them before
      // incrementing reservedQty / completing.
      const reassigned: Array<{ itemId: string; oldBinId: string | null; newBinId: string; binLabel: string }> = [];
      // Find a bin for this pli that has enough free qty (excluding
      // our own SO reservation on it). Used both for the "no bin
      // assigned" path and the sibling-reassign fallback below. When
      // warehouseId is null we search across all warehouses — pick
      // lists in this codebase don't carry a warehouse ref, so on the
      // unassigned-bin path we cast wide.
      const findBinFor = async (
        warehouseId: string | null,
        productId: string | null,
        variantId: string | null,
        salesOrderItemId: string,
        qtyPicked: number,
        excludeBinId: string | null
      ) => {
        if (!productId) return null;
        const candidates = await db.bin.findMany({
          where: {
            ...(warehouseId ? { warehouseId } : {}),
            productId,
            ...(variantId ? { variantId } : {}),
            ...(excludeBinId ? { NOT: { id: excludeBinId } } : {}),
            qty: { gt: 0 },
          },
          orderBy: [{ qty: "desc" }],
        });
        for (const cand of candidates) {
          const candOurs = await db.salesOrderReservation.aggregate({
            where: { salesOrderItemId, binId: cand.id },
            _sum: { qty: true },
          });
          const candFree =
            cand.qty - Math.max(0, cand.reservedQty - (candOurs._sum.qty ?? 0));
          if (candFree + 1e-6 >= qtyPicked) return cand;
        }
        return null;
      };

      for (const it of positives) {
        if (!it.binId) {
          // Try to auto-assign a bin. Most common cause of an
          // unassigned binId is a pick list built before any bin had
          // stock for this variant — by the time the operator picks,
          // a bin does have it. Search any warehouse.
          const picked = await findBinFor(
            null,
            it.productId,
            it.variantId,
            it.salesOrderItemId,
            it.qtyPicked,
            null
          );
          if (!picked) {
            issues.push({
              itemId: it.id,
              reason: "no bin assigned and no bin in the warehouse has enough free qty for this line",
            });
            continue;
          }
          await db.pickListItem.update({
            where: { id: it.id },
            data: { binId: picked.id },
          });
          reassigned.push({
            itemId: it.id,
            oldBinId: null,
            newBinId: picked.id,
            binLabel: `${picked.zone}/${picked.shelf}/${picked.bin}`,
          });
          it.binId = picked.id;
        }
        const bin = await db.bin.findUnique({ where: { id: it.binId } });
        if (!bin) {
          issues.push({ itemId: it.id, reason: "bin_not_found" });
          continue;
        }
        // Exclude THIS SO line's own SO-level reservation on this bin
        // from reservedQty — at /complete the pick is about to take
        // over that reservation, so it should count as ours, not as a
        // competing commitment. Without this, an operator who recounts
        // and corrects a bin downward to match a hard reservation
        // (qty == reservedQty) sees free == 0 and can't complete even
        // though the reservation belongs to this very pick.
        const ourReservation = await db.salesOrderReservation.aggregate({
          where: { salesOrderItemId: it.salesOrderItemId, binId: it.binId },
          _sum: { qty: true },
        });
        const ourReservedHere = ourReservation._sum.qty ?? 0;
        const free = bin.qty - Math.max(0, bin.reservedQty - ourReservedHere);
        if (free + 1e-6 < it.qtyPicked) {
          // Auto-reassign: look for a sibling bin (same product /
          // variant / warehouse) that has enough free qty. This makes
          // "I corrected stock and another bin has it" recover
          // automatically instead of dead-ending the operator.
          const picked = await findBinFor(
            bin.warehouseId,
            bin.productId,
            it.variantId ?? bin.variantId ?? null,
            it.salesOrderItemId,
            it.qtyPicked,
            bin.id
          );
          if (picked) {
            await db.pickListItem.update({
              where: { id: it.id },
              data: { binId: picked.id },
            });
            reassigned.push({
              itemId: it.id,
              oldBinId: bin.id,
              newBinId: picked.id,
              binLabel: `${picked.zone}/${picked.shelf}/${picked.bin}`,
            });
            it.binId = picked.id;
          } else {
            issues.push({
              itemId: it.id,
              reason: `bin ${bin.bin} only has ${Math.max(0, free)} free (qty ${bin.qty}, reserved ${bin.reservedQty}). No sibling bin has enough either — recount or amend.`,
            });
          }
        }
        if (it.variantId) {
          variantUsage.set(
            it.variantId,
            (variantUsage.get(it.variantId) ?? 0) + it.qtyPicked
          );
        }
      }
      if (variantUsage.size > 0) {
        const variantIds = Array.from(variantUsage.keys());
        const variants = await db.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: { id: true, sku: true, stockOnHand: true },
        });
        const vMap = new Map(variants.map((v) => [v.id, v]));
        // Sum qtyPicked from ALL OTHER active pick lists for the same
        // variant (any pick list that has not yet been pack-completed
        // counts as "still committed against current stockOnHand").
        // Without this, two pick lists for the same variant could each
        // pass the per-list check, both pack-complete, and one of them
        // would discover the stock had vanished only at /complete time
        // - which is exactly the stale-pick state the user just hit.
        const inFlight = await db.pickListItem.groupBy({
          by: ["variantId"],
          where: {
            variantId: { in: variantIds },
            qtyPicked: { gt: 0 },
            pickListId: { not: id },
            pickList: {
              status: { in: ["draft", "picking", "picked"] },
              OR: [
                { packingSlip: null },
                { packingSlip: { status: { notIn: ["packed", "invoiced"] } } },
              ],
            },
          },
          _sum: { qtyPicked: true },
        });
        const otherUsage = new Map(
          inFlight.map((r) => [r.variantId!, r._sum.qtyPicked ?? 0])
        );
        // Self-healing cache: if v.stockOnHand looks short, sum the
        // variant's bins to see whether physical stock has actually
        // moved past the cached counter (e.g. a positive cycle-count
        // landed in a bin but the recompute step missed the
        // ProductVariant row). When bin sum is higher, we trust it,
        // update the counter, and proceed.
        const refreshVariantSoh = async (variantId: string, sku: string, fallback: number) => {
          const sum = await db.bin.aggregate({
            where: { variantId },
            _sum: { qty: true },
          });
          const fromBins = sum._sum.qty ?? 0;
          if (fromBins > fallback) {
            await db.productVariant.update({
              where: { id: variantId },
              data: { stockOnHand: fromBins },
            });
            req.log?.info(
              { variantId, sku, before: fallback, after: fromBins },
              "pick complete: refreshed variant.stockOnHand from bins"
            );
            return fromBins;
          }
          return fallback;
        };
        for (const it of positives) {
          if (!it.variantId) continue;
          const v = vMap.get(it.variantId);
          if (!v) continue;
          const usedHere = variantUsage.get(it.variantId) ?? 0;
          const usedElsewhere = otherUsage.get(it.variantId) ?? 0;
          const usedTotal = usedHere + usedElsewhere;
          let soh = v.stockOnHand ?? 0;
          if (usedTotal > soh + 1e-6) {
            soh = await refreshVariantSoh(it.variantId, v.sku, soh);
          }
          if (usedTotal > soh + 1e-6) {
            const elsewhereNote =
              usedElsewhere > 0 ? `; ${usedElsewhere} committed by other pick lists` : "";
            issues.push({
              itemId: it.id,
              reason: `variant ${v.sku} only has ${soh} on hand (this pick wants ${usedHere}${elsewhereNote})`,
            });
          }
        }
      }
      if (issues.length > 0) {
        return reply.code(409).send({
          error: {
            code: "pick_blocked",
            message:
              "Insufficient stock to complete this pick. Recount the bin, move stock from a sibling bin, or amend the order.",
            details: issues,
          },
        });
      }
      if (reassigned.length > 0) {
        req.log?.info(
          { pickListId: id, reassigned },
          "pick complete: auto-reassigned items to sibling bins with stock"
        );
      }
      for (const it of positives) {
        if (it.binId) {
          await db.bin.update({
            where: { id: it.binId },
            data: { reservedQty: { increment: Math.round(it.qtyPicked) } },
          });
        }
      }
      // Transfer SO hard-reservations into pick-list reservations.
      // See so-reservations.ts for the full lifecycle — short version:
      // the bump above + this drain together net to zero on the
      // reserved bin (or transfer to a new bin if the picker chose
      // differently), so total Bin.reservedQty across the warehouse
      // tracks outstanding SO qty without drift.
      try {
        await consumeReservationsForPickedItems(
          positives.map((p) => ({
            salesOrderItemId: p.salesOrderItemId,
            qty: p.qtyPicked,
          }))
        );
      } catch (e) {
        req.log?.warn(
          { err: e, pickListId: id },
          "consumeReservationsForPickedItems failed"
        );
      }

      const updated = await db.pickList.update({
        where: { id },
        data: { status: "picked", pickedAt: new Date() },
        include: fullPickInclude,
      });

      // Auto-create a PackingSlip carrying picked qty forward. When a
      // single SO line was split across multiple bins (multi-location
      // pick), we collapse those rows into ONE packing slip line by
      // summing qtyPicked - the packer doesn't care which bin the units
      // came from once they're staged for shipping.
      const packingSlipNo = await nextDocNo("PS", 2026, 8001);
      const so = await db.salesOrder.findUnique({
        where: { id: pl.salesOrderId },
        include: { items: true },
      });
      const bySoLine = new Map<
        string,
        { productId: string; variantId: string | null; qtyPicked: number }
      >();
      for (const pi of positives) {
        const cur = bySoLine.get(pi.salesOrderItemId);
        if (cur) {
          cur.qtyPicked += pi.qtyPicked;
        } else {
          bySoLine.set(pi.salesOrderItemId, {
            productId: pi.productId,
            variantId: pi.variantId ?? null,
            qtyPicked: pi.qtyPicked,
          });
        }
      }
      // Carry the picker forward as the default packer so anyone
      // viewing the queue immediately sees who owns the next step.
      // Workers can still release + re-claim the slip from the mobile
      // PWA if a different person is doing the packing - this is just
      // the default assignment, not a hard binding.
      const ps = await db.packingSlip.create({
        data: {
          packingSlipNo,
          shareToken: mintShareToken(),
          salesOrderId: pl.salesOrderId,
          pickListId: pl.id,
          createdById: req.user.sub,
          assignedToId: pl.assignedToId ?? null,
          claimedAt: pl.assignedToId ? new Date() : null,
          items: {
            create: Array.from(bySoLine, ([salesOrderItemId, agg]) => {
              const soi = so!.items.find((s) => s.id === salesOrderItemId)!;
              return {
                salesOrderItemId,
                productId: agg.productId,
                variantId: agg.variantId,
                qtyOrdered: soi.qtyOrdered,
                qtyPicked: agg.qtyPicked,
                // qtyPacked starts at 0 — the packer scan-confirms each
                // line on the PWA, hits the desktop "Auto pack" button,
                // or types qtyPacked manually. Pre-filling with the
                // picked qty (the legacy default) made every line show
                // as already packed before the packer did anything.
                qtyPacked: 0,
                rate: soi.rate,
                amount: 0,
              };
            }),
          },
        },
        include: fullPackInclude,
      });
      await recordChange("PickList", id, "update", updated, req.user.sub);
      await recordChange("PackingSlip", ps.id, "insert", ps, req.user.sub);
      return { pickList: updated, packingSlip: ps };
    }
  );

  // -------------------------------------------------- Auto-pick (one-click) ---
  // Fills qtyPicked greedily for every line of a draft/picking list, then
  // runs the same /complete logic. The fill is bounded by:
  //   * the line's own qtyToPick,
  //   * the assigned bin's free qty (qty - reservedQty),
  //   * the variant's stockOnHand minus what's already committed by OTHER
  //     in-flight pick lists for the same variant (cross-list guard).
  // If any line ends up filled below qtyToPick, those rows are reported as
  // `shortfalls` and the call REFUSES to complete unless the operator
  // re-posts with { acceptShortfall: true }. This keeps the one-click path
  // safe by default while letting the UI offer a "complete partial pick"
  // confirmation when the warehouse genuinely is short.
  app.post(
    "/pick-lists/:id/auto-pick",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const body = z
        .object({ acceptShortfall: z.boolean().optional() })
        .parse(req.body ?? {});
      const pl = await db.pickList.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!pl) return reply.code(404).send({ error: { code: "not_found" } });
      if (!["draft", "picking"].includes(pl.status)) {
        return reply.code(409).send({
          error: { code: "bad_state", message: `Pick list is '${pl.status}'.` },
        });
      }

      // ---- Per-bin free qty cache (keyed by binId) -------------------------
      const binIds = Array.from(
        new Set(pl.items.map((i) => i.binId).filter(Boolean) as string[])
      );
      const bins = binIds.length
        ? await db.bin.findMany({
            where: { id: { in: binIds } },
            select: {
              id: true,
              bin: true,
              code: true,
              qty: true,
              reservedQty: true,
            },
          })
        : [];
      const binFreeRemaining = new Map(
        bins.map((b) => [b.id, b.qty - b.reservedQty])
      );
      const binMeta = new Map(bins.map((b) => [b.id, b]));

      // ---- Variant stock budgets (cross-list aware) ------------------------
      const variantIds = Array.from(
        new Set(pl.items.map((i) => i.variantId).filter(Boolean) as string[])
      );
      const variants = variantIds.length
        ? await db.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: { id: true, sku: true, stockOnHand: true },
          })
        : [];
      const vMap = new Map(variants.map((v) => [v.id, v]));
      const inFlight = variantIds.length
        ? await db.pickListItem.groupBy({
            by: ["variantId"],
            where: {
              variantId: { in: variantIds },
              qtyPicked: { gt: 0 },
              pickListId: { not: id },
              pickList: {
                status: { in: ["draft", "picking", "picked"] },
                OR: [
                  { packingSlip: null },
                  { packingSlip: { status: { notIn: ["packed", "invoiced"] } } },
                ],
              },
            },
            _sum: { qtyPicked: true },
          })
        : [];
      const otherUsage = new Map(
        inFlight.map((r) => [r.variantId!, r._sum.qtyPicked ?? 0])
      );
      // Remaining variant budget mutates as we walk the items - the same
      // variant can appear in multiple bin splits and they share one budget.
      const variantBudget = new Map<string, number>();
      for (const vid of variantIds) {
        const v = vMap.get(vid);
        const onHand = v?.stockOnHand ?? 0;
        const used = otherUsage.get(vid) ?? 0;
        variantBudget.set(vid, Math.max(0, onHand - used));
      }

      // ---- Walk items, compute target fill ---------------------------------
      type Shortfall = {
        itemId: string;
        sku: string;
        requested: number;
        filled: number;
        reason: "no_bin" | "bin_capped" | "variant_capped";
        location?: string;
      };
      const shortfalls: Shortfall[] = [];
      const updates: { id: string; qtyPicked: number }[] = [];

      // Process items in stable order so multi-bin splits drain budgets in a
      // predictable way (first split gets stock first, etc).
      const ordered = [...pl.items].sort((a, b) =>
        a.id.localeCompare(b.id)
      );
      for (const it of ordered) {
        if (it.qtyToPick <= 0) {
          updates.push({ id: it.id, qtyPicked: 0 });
          continue;
        }
        const sku = it.variantId
          ? vMap.get(it.variantId)?.sku ?? ""
          : "";
        if (!it.binId) {
          shortfalls.push({
            itemId: it.id,
            sku: sku || "(no-sku)",
            requested: it.qtyToPick,
            filled: 0,
            reason: "no_bin",
          });
          updates.push({ id: it.id, qtyPicked: 0 });
          continue;
        }
        let cap = it.qtyToPick;
        const binFree = binFreeRemaining.get(it.binId) ?? 0;
        if (binFree < cap) cap = Math.max(0, binFree);
        if (it.variantId) {
          const vb = variantBudget.get(it.variantId) ?? 0;
          if (vb < cap) cap = Math.max(0, vb);
        }
        const filled = Math.max(0, Math.floor(cap));
        if (filled < it.qtyToPick) {
          const bm = binMeta.get(it.binId);
          shortfalls.push({
            itemId: it.id,
            sku: sku || "(no-sku)",
            requested: it.qtyToPick,
            filled,
            reason:
              it.variantId &&
              (variantBudget.get(it.variantId) ?? 0) < it.qtyToPick
                ? "variant_capped"
                : "bin_capped",
            location: bm?.code ?? bm?.bin ?? undefined,
          });
        }
        binFreeRemaining.set(it.binId, (binFreeRemaining.get(it.binId) ?? 0) - filled);
        if (it.variantId) {
          variantBudget.set(
            it.variantId,
            (variantBudget.get(it.variantId) ?? 0) - filled
          );
        }
        updates.push({ id: it.id, qtyPicked: filled });
      }

      // Persist filled quantities even when we end up returning shortfalls -
      // the editor opens with the auto-filled numbers visible so the
      // operator can see exactly where the gaps are.
      await db.$transaction(
        updates.map((u) =>
          db.pickListItem.update({
            where: { id: u.id },
            data: { qtyPicked: u.qtyPicked },
          })
        )
      );

      const totalFilled = updates.reduce((s, u) => s + u.qtyPicked, 0);
      if (shortfalls.length > 0 && !body.acceptShortfall) {
        const refreshed = await db.pickList.findUnique({
          where: { id },
          include: fullPickInclude,
        });
        return reply.code(409).send({
          error: {
            code: "auto_pick_partial",
            message: `Auto-pick filled ${totalFilled} of ${pl.items.reduce(
              (s, i) => s + i.qtyToPick,
              0
            )} requested. Accept shortfall to complete a partial pick.`,
            details: { shortfalls, pickList: refreshed },
          },
        });
      }

      if (totalFilled === 0) {
        return reply.code(409).send({
          error: {
            code: "nothing_to_pick",
            message:
              "No stock available to auto-pick. Recount bins or wait for replenishment.",
            details: { shortfalls },
          },
        });
      }

      // Reuse complete logic by calling the existing flow inline. We
      // duplicate the small finalization block (reservation + status +
      // packing-slip seed) to keep this self-contained and avoid leaking
      // request/reply plumbing through a refactor.
      const post = await db.pickList.findUnique({
        where: { id },
        include: { items: true, salesOrder: { include: { items: true } } },
      });
      const positives = (post?.items ?? []).filter((i) => i.qtyPicked > 0);
      // Reserve qty on bins (positions only - qty/stockOnHand decrement
      // happens at invoicing in the existing flow).
      for (const it of positives) {
        if (it.binId) {
          await db.bin.update({
            where: { id: it.binId },
            data: { reservedQty: { increment: Math.round(it.qtyPicked) } },
          });
        }
      }
      // Drain SO-level hard reservations for the picked qty so we
      // don't double-count them on top of the pick-list reservation
      // we just placed. If the picker chose a different bin than the
      // SO had reserved, this releases the original bin and the
      // increment above lands on the picker's chosen bin — net effect
      // is that Bin.reservedQty across the warehouse stays equal to
      // the outstanding SO qty.
      try {
        await consumeReservationsForPickedItems(
          positives.map((p) => ({
            salesOrderItemId: p.salesOrderItemId,
            qty: p.qtyPicked,
          }))
        );
      } catch (e) {
        req.log?.warn(
          { err: e, pickListId: id },
          "consumeReservationsForPickedItems failed (auto-complete)"
        );
      }
      const updated = await db.pickList.update({
        where: { id },
        data: { status: "picked", pickedAt: new Date() },
        include: fullPickInclude,
      });
      const packingSlipNo = await nextDocNo("PS", 2026, 8001);
      const so = post?.salesOrder;
      const bySoLine = new Map<
        string,
        { productId: string; variantId: string | null; qtyPicked: number }
      >();
      for (const pi of positives) {
        const cur = bySoLine.get(pi.salesOrderItemId);
        if (cur) cur.qtyPicked += pi.qtyPicked;
        else
          bySoLine.set(pi.salesOrderItemId, {
            productId: pi.productId,
            variantId: pi.variantId ?? null,
            qtyPicked: pi.qtyPicked,
          });
      }
      const ps = await db.packingSlip.create({
        data: {
          packingSlipNo,
          shareToken: mintShareToken(),
          salesOrderId: pl.salesOrderId,
          pickListId: pl.id,
          createdById: req.user.sub,
          assignedToId: pl.assignedToId ?? null,
          claimedAt: pl.assignedToId ? new Date() : null,
          items: {
            create: Array.from(bySoLine, ([salesOrderItemId, agg]) => {
              const soi = so!.items.find((s) => s.id === salesOrderItemId)!;
              return {
                salesOrderItemId,
                productId: agg.productId,
                variantId: agg.variantId,
                qtyOrdered: soi.qtyOrdered,
                qtyPicked: agg.qtyPicked,
                // See note on the manual-complete branch above —
                // qtyPacked starts at 0 so the packer's scan flow
                // matters. Auto-pack copies qtyPicked across in one
                // click on the desktop.
                qtyPacked: 0,
                rate: soi.rate,
                amount: 0,
              };
            }),
          },
        },
        include: fullPackInclude,
      });
      await recordChange("PickList", id, "update", updated, req.user.sub);
      await recordChange("PackingSlip", ps.id, "insert", ps, req.user.sub);
      return { pickList: updated, packingSlip: ps, shortfalls };
    }
  );

  app.post(
    "/pick-lists/:id/cancel",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const pl = await db.pickList.findUnique({ where: { id } });
      if (!pl) return reply.code(404).send({ error: { code: "not_found" } });
      if (pl.status === "picked") {
        return reply.code(409).send({
          error: {
            code: "already_picked",
            message:
              "Pick list is already picked; cancel the linked Packing Slip instead.",
          },
        });
      }
      const updated = await db.pickList.update({
        where: { id },
        data: { status: "cancelled", cancelledAt: new Date() },
        include: fullPickInclude,
      });
      await recordChange("PickList", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  // ========================================================== Packing Slips ===

  app.get("/packing-slips", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    return db.packingSlip.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.salesOrderId ? { salesOrderId: q.salesOrderId } : {}),
        ...(q.unassigned === "1" ? { assignedToId: null } : {}),
        ...(q.assignedToId ? { assignedToId: q.assignedToId } : {}),
      },
      include: {
        salesOrder: {
          select: {
            id: true,
            soNo: true,
            customer: { select: { name: true, code: true } },
          },
        },
        assignedTo: { select: { id: true, name: true, username: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
      take: q.limit ? parseInt(q.limit, 10) : 200,
    });
  });

  app.get("/packing-slips/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const ps = await db.packingSlip.findUnique({ where: { id }, include: fullPackInclude });
    if (!ps) return reply.code(404).send({ error: { code: "not_found" } });
    return ps;
  });

  // Edit qtyPacked. Allowed in 'open' status. qtyPacked must be in
  // [0, qtyPicked] - you cannot pack more than was picked.
  app.patch(
    "/packing-slips/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const body = z
        .object({
          notes: z.string().nullable().optional(),
          items: z
            .array(
              z.object({
                id: z.string(),
                qtyPacked: z.number().nonnegative(),
                notes: z.string().nullable().optional(),
              })
            )
            .optional(),
        })
        .parse(req.body);

      const ps = await db.packingSlip.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!ps) return reply.code(404).send({ error: { code: "not_found" } });
      if (ps.status !== "open") {
        return reply.code(409).send({
          error: { code: "locked", message: `Packing slip is '${ps.status}'.` },
        });
      }

      if (body.notes !== undefined) {
        await db.packingSlip.update({ where: { id }, data: { notes: body.notes } });
      }
      const issues: { id: string; reason: string }[] = [];
      if (body.items) {
        for (const it of body.items) {
          const existing = ps.items.find((x) => x.id === it.id);
          if (!existing) {
            issues.push({ id: it.id, reason: "not_in_packing_slip" });
            continue;
          }
          if (it.qtyPacked > existing.qtyPicked + 1e-6) {
            issues.push({
              id: it.id,
              reason: `qtyPacked ${it.qtyPacked} exceeds qtyPicked ${existing.qtyPicked}`,
            });
            continue;
          }
        }
        if (issues.length > 0) {
          return reply.code(409).send({
            error: {
              code: "invalid_pack",
              message: "Some lines cannot be packed at the requested qty.",
              details: issues,
            },
          });
        }
        for (const it of body.items) {
          const existing = ps.items.find((x) => x.id === it.id)!;
          await db.packingSlipItem.update({
            where: { id: it.id },
            data: {
              qtyPacked: it.qtyPacked,
              amount: it.qtyPacked * existing.rate,
              ...(it.notes !== undefined ? { notes: it.notes } : {}),
            },
          });
        }
      }
      const updated = await db.packingSlip.findUnique({
        where: { id },
        include: fullPackInclude,
      });
      await recordChange("PackingSlip", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  // Mark as packed (locks the slip; still no stock movement yet).
  app.post(
    "/packing-slips/:id/pack",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const ps = await db.packingSlip.findUnique({ where: { id }, include: { items: true } });
      if (!ps) return reply.code(404).send({ error: { code: "not_found" } });
      if (ps.status !== "open") {
        return reply.code(409).send({
          error: { code: "bad_state", message: `Packing slip is '${ps.status}'.` },
        });
      }
      const total = ps.items.reduce((s, i) => s + i.qtyPacked, 0);
      if (total <= 0) {
        return reply.code(409).send({
          error: { code: "nothing_packed", message: "qtyPacked totals zero." },
        });
      }
      // Container gate. When the global packMultiContainerEnabled flag
      // is on (default for new deployments), every qtyPacked unit must
      // be allocated into a sealed container before we lock the slip.
      // This is what makes the trip weight rollup and the per-item
      // container reports reliable. The flag stays off for legacy
      // tenants who only want the single-bundle workflow.
      const profile = await db.companyProfile.findUnique({
        where: { key: "default" },
        select: { packMultiContainerEnabled: true },
      });
      if (profile?.packMultiContainerEnabled) {
        const issues = await validateContainerAllocations(db, id);
        if (issues.length > 0) {
          return reply.code(409).send({
            error: {
              code: "container_allocation_incomplete",
              message:
                "Allocate every packed unit into a sealed container before packing.",
              details: issues,
            },
          });
        }
      }
      // Pack-complete now ALWAYS settles the invoice. Both B2B and
      // ecommerce SOs are minted with a pre-generated invoice the
      // moment they are confirmed (see services/invoice-create.ts);
      // packing slips just need to attach to that existing invoice,
      // decrement physical stock, and lock. No "Generate Invoice"
      // step is exposed any more - the desktop UI shows the invoice
      // number inline on the slip.
      //
      // Differences between the two channels at this point:
      //   * Ecommerce: stockOnHand was already decremented at order
      //     time. We only move bin.qty / bin.reservedQty here. AWB
      //     gets stamped for the mock courier.
      //   * B2B: stockOnHand is decremented HERE (the change vs the
      //     old "create invoice on pack" flow is just *which*
      //     invoice the stock-ledger row references; the math is
      //     identical).
      const so = await db.salesOrder.findUnique({
        where: { id: ps.salesOrderId },
        select: { id: true, source: true, customerId: true },
      });

      // Defensive: SOs that pre-date the pre-gen rollout may not
      // have an invoice yet. Mint one on the fly so this code path
      // doesn't have to special-case "no invoice" forever.
      if (so) {
        const exists = await db.invoice.findFirst({
          where: { salesOrderId: so.id },
          select: { id: true },
        });
        if (!exists) {
          await ensureInvoiceForSalesOrder(db, so.id);
        }
      }

      const fullSlip = await db.packingSlip.findUnique({
        where: { id },
        include: {
          items: true,
          pickList: { include: { items: true } },
        },
      });
      const pickItems = fullSlip?.pickList?.items ?? [];
      const packLines = fullSlip?.items ?? [];

      // Pre-flight oversell guard for B2B (ecommerce already moved
      // stock at order time, so the only check it needs is the
      // bin-level one which the existing /invoice endpoint owned;
      // here we use stockOnHand for B2B). If B2B can't ship the
      // packed quantity, refuse before any writes.
      if (so?.source !== "ecommerce") {
        const oversell: {
          sku: string;
          requested: number;
          available: number;
        }[] = [];
        const variantIds = packLines
          .filter((p) => p.qtyPacked > 0 && p.variantId)
          .map((p) => p.variantId as string);
        const productIds = packLines
          .filter((p) => p.qtyPacked > 0)
          .map((p) => p.productId);
        const [variants, products] = await Promise.all([
          variantIds.length
            ? db.productVariant.findMany({
                where: { id: { in: variantIds } },
                select: { id: true, sku: true, stockOnHand: true },
              })
            : Promise.resolve(
                [] as { id: string; sku: string; stockOnHand: number }[]
              ),
          db.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, sku: true, stockOnHand: true },
          }),
        ]);
        const vMap = new Map(variants.map((v) => [v.id, v]));
        const pMap = new Map(products.map((p) => [p.id, p]));
        for (const p of packLines) {
          if (p.qtyPacked <= 0) continue;
          if (p.variantId) {
            const v = vMap.get(p.variantId);
            if (v && p.qtyPacked > v.stockOnHand + 1e-6) {
              oversell.push({
                sku: v.sku,
                requested: p.qtyPacked,
                available: v.stockOnHand,
              });
            }
          } else {
            const prod = pMap.get(p.productId);
            if (prod && p.qtyPacked > prod.stockOnHand + 1e-6) {
              oversell.push({
                sku: prod.sku,
                requested: p.qtyPacked,
                available: prod.stockOnHand,
              });
            }
          }
        }
        if (oversell.length > 0) {
          return reply.code(409).send({
            error: {
              code: "insufficient_stock",
              message:
                "Cannot pack: one or more lines would oversell. Reduce qtyPacked or run a stock adjustment.",
              details: oversell,
            },
          });
        }
      }

      // Invoice exists for ecommerce at order time; B2B gets one at SO
      // confirm. We need the invoiceNo here so Sale ledger rows can
      // reference the actual pick bin's warehouse (STR etc.) instead
      // of blindly pinning to warehouse.findFirst() (WH-MAIN).
      const invoiceToAttach = await db.invoice.findFirst({
        where: { salesOrderId: ps.salesOrderId },
        orderBy: { createdAt: "asc" },
        select: { id: true, invoiceNo: true, packingSlipId: true },
      });

      let awbPatch: { awb?: string; carrier?: string } = {};
      if (so?.source === "ecommerce" && !ps.awb) {
        awbPatch = {
          awb: `MOCK-AWB-${Math.random()
            .toString(36)
            .slice(2, 10)
            .toUpperCase()}`,
          carrier: "MockCourier",
        };
      }

      // ----- Apply the pack-complete writes -----
      // Decrement bins (always), decrement stockOnHand (B2B only -
      // ecommerce already paid at order time), bump qtyInvoiced
      // (always - it represents what was physically dispatched).
      for (const p of packLines) {
        if (p.qtyPacked <= 0) continue;
        const pi = pickItems.find(
          (x) => x.salesOrderItemId === p.salesOrderItemId
        );
        const packed = Math.round(p.qtyPacked);
        const picked = Math.round(pi?.qtyPicked ?? p.qtyPacked);
        if (pi?.binId) {
          await db.bin.update({
            where: { id: pi.binId },
            data: {
              qty: { decrement: packed },
              reservedQty: { decrement: picked },
            },
          });
        }
        if (so?.source !== "ecommerce") {
          if (p.variantId) {
            await db.productVariant.update({
              where: { id: p.variantId },
              data: { stockOnHand: { decrement: packed } },
            });
          } else {
            await db.product.update({
              where: { id: p.productId },
              data: { stockOnHand: { decrement: packed } },
            });
          }
        }
        await db.salesOrderItem.update({
          where: { id: p.salesOrderItemId },
          data: { qtyInvoiced: { increment: packed } },
        });
        // Sale ledger: always post at pack-complete from the pick bin's
        // warehouse. Ecommerce used to post at order time against
        // warehouse.findFirst() (WH-MAIN) even though picking happened
        // in STR — that mismatch is what the Inventory Ledger showed.
        if (invoiceToAttach) {
          await createSaleLedgerFromPickBin({
            productId: p.productId,
            variantId: p.variantId,
            qty: packed,
            ref: invoiceToAttach.invoiceNo,
            binId: pi?.binId,
          });
        }
      }

      // Attach the pre-generated invoice to this slip and reconcile
      // its line quantities to match qtyPacked (so partial dispatches
      // produce a correct customer-facing invoice). Idempotent if
      // packingSlipId is already set.
      if (invoiceToAttach) {
        if (invoiceToAttach.packingSlipId !== id) {
          await db.invoice.update({
            where: { id: invoiceToAttach.id },
            data: { packingSlipId: id },
          });
        }
        await reconcileInvoiceWithPack(
          db,
          invoiceToAttach.id,
          packLines.map((p) => ({
            salesOrderItemId: p.salesOrderItemId,
            qtyPacked: p.qtyPacked,
            rate: p.rate,
          }))
        );
      }

      // Snapshot the container weights into the slip's cached totals
      // so downstream dispatch / trip code can read totalEstWeightKg
      // without re-walking containers on every request.
      await recomputePackingSlipWeight(db, id);

      const updated = await db.packingSlip.update({
        where: { id },
        data: {
          status: "invoiced",
          packedAt: new Date(),
          invoicedAt: new Date(),
          ...awbPatch,
        },
        include: fullPackInclude,
      });

      // Roll up SO status (mirrors the legacy /packing-slips/:id/invoice
      // handler). Without this, a /pack call that left a shortfall
      // would leave the SO sitting in 'confirmed' indefinitely while
      // its qtyInvoiced reflected the partial fulfilment - and the
      // customer's open AR kept padding in the un-invoiced remainder
      // because no one ever flipped the SO to a state where the
      // shortfall is observable in the UI.
      const rolledSo = await db.salesOrder.findUnique({
        where: { id: ps.salesOrderId },
        include: { items: true },
      });
      if (rolledSo) {
        const totalOrd = rolledSo.items.reduce(
          (s, it) => s + it.qtyOrdered - it.qtyCancelled,
          0
        );
        const totalInv = rolledSo.items.reduce(
          (s, it) => s + it.qtyInvoiced,
          0
        );
        const newStatus =
          totalInv >= totalOrd - 1e-6
            ? "invoiced"
            : totalInv > 0
              ? "partially_invoiced"
              : "confirmed";
        if (newStatus !== rolledSo.status) {
          const u = await db.salesOrder.update({
            where: { id: rolledSo.id },
            data: { status: newStatus },
          });
          await recordChange("SalesOrder", u.id, "update", u, req.user.sub);
        }
      }

      await recordChange("PackingSlip", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  // -------------------------------------------------- Auto-pack (one-click) --
  // Sets qtyPacked := qtyPicked for every line of an open packing slip and
  // then runs the same /pack lock step. The packer wanted a single button
  // for the common case where the warehouse has nothing to deviate on -
  // qtyPacked equals qtyPicked, which is the default seeded by the pick-
  // complete step anyway. Mismatches between qtyPicked and the seeded
  // qtyPacked (rare; only happens if the slip was hand-edited before
  // auto-pack) are reported via `mismatches` so the desktop UI can
  // highlight the rows.
  app.post(
    "/packing-slips/:id/auto-pack",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const ps = await db.packingSlip.findUnique({
        where: { id },
        include: { items: { include: { variant: true, product: true } } },
      });
      if (!ps) return reply.code(404).send({ error: { code: "not_found" } });
      if (ps.status !== "open") {
        return reply.code(409).send({
          error: { code: "bad_state", message: `Packing slip is '${ps.status}'.` },
        });
      }

      type Mismatch = {
        itemId: string;
        sku: string;
        qtyPicked: number;
        qtyPacked: number;
        variance: number;
      };
      const mismatches: Mismatch[] = [];

      // Set qtyPacked := qtyPicked for every line. We only flag a row
      // as a mismatch when it has a NON-ZERO qtyPacked that differs
      // from qtyPicked — that's the real "operator hand-edited
      // before auto-pack" signal. qtyPacked == 0 is the fresh-slip
      // default (the packer hasn't scanned anything yet) and would
      // otherwise show every line as a phantom mismatch.
      const updates = ps.items.map((it) => {
        if (it.qtyPacked > 0 && it.qtyPacked !== it.qtyPicked) {
          mismatches.push({
            itemId: it.id,
            sku: it.variant?.sku ?? it.product?.sku ?? "(no-sku)",
            qtyPicked: it.qtyPicked,
            qtyPacked: it.qtyPacked,
            variance: it.qtyPacked - it.qtyPicked,
          });
        }
        return db.packingSlipItem.update({
          where: { id: it.id },
          data: {
            qtyPacked: it.qtyPicked,
            amount: it.qtyPicked * it.rate,
          },
        });
      });
      if (updates.length > 0) {
        await db.$transaction(updates);
      }

      const totalPacked = ps.items.reduce((s, i) => s + i.qtyPicked, 0);
      if (totalPacked <= 0) {
        return reply.code(409).send({
          error: {
            code: "nothing_packed",
            message: "Pick yielded zero units; nothing to pack.",
          },
        });
      }

      // Auto-pack is the "trust the picker" one-click path. With the
      // multi-container flag on, drop everything into one auto-sealed
      // container so the slip still has the metadata reports and the
      // dispatch weight rollup need. Operators who want precise per-
      // container splits use the manual /pack flow instead.
      const profile = await db.companyProfile.findUnique({
        where: { key: "default" },
        select: { packMultiContainerEnabled: true },
      });
      if (profile?.packMultiContainerEnabled) {
        await ensureDefaultContainerTypes(db);
        await ensureAutoBundleContainer(db, id, req.user.sub);
      }
      await recomputePackingSlipWeight(db, id);

      // Reuse the pack flow inline (ecommerce branch + status transition).
      const so = await db.salesOrder.findUnique({
        where: { id: ps.salesOrderId },
        select: { id: true, source: true },
      });
      let awbPatch: { awb?: string; carrier?: string } = {};
      let ecomInvoiced = false;
      if (so?.source === "ecommerce" && !ps.awb) {
        const awb = `MOCK-AWB-${Math.random()
          .toString(36)
          .slice(2, 10)
          .toUpperCase()}`;
        awbPatch = { awb, carrier: "MockCourier" };
        const fullSlip = await db.packingSlip.findUnique({
          where: { id },
          include: {
            items: true,
            pickList: { include: { items: true } },
          },
        });
        const pickItems = fullSlip?.pickList?.items ?? [];
        const existingInv = await db.invoice.findFirst({
          where: { salesOrderId: ps.salesOrderId, packingSlipId: null },
          orderBy: { createdAt: "desc" },
          select: { id: true, invoiceNo: true },
        });
        for (const p of fullSlip?.items ?? []) {
          if (p.qtyPacked <= 0) continue;
          const pi = pickItems.find(
            (x) => x.salesOrderItemId === p.salesOrderItemId
          );
          const packed = Math.round(p.qtyPacked);
          const picked = Math.round(pi?.qtyPicked ?? p.qtyPacked);
          if (pi?.binId) {
            await db.bin.update({
              where: { id: pi.binId },
              data: {
                qty: { decrement: packed },
                reservedQty: { decrement: picked },
              },
            });
          }
          await db.salesOrderItem.update({
            where: { id: p.salesOrderItemId },
            data: { qtyInvoiced: { increment: packed } },
          });
          if (existingInv) {
            await createSaleLedgerFromPickBin({
              productId: p.productId,
              variantId: p.variantId,
              qty: packed,
              ref: existingInv.invoiceNo,
              binId: pi?.binId,
            });
          }
        }
        if (existingInv) {
          await db.invoice.update({
            where: { id: existingInv.id },
            data: { packingSlipId: id },
          });
          ecomInvoiced = true;
        }
      }

      const updated = await db.packingSlip.update({
        where: { id },
        data: ecomInvoiced
          ? {
              status: "invoiced",
              packedAt: new Date(),
              invoicedAt: new Date(),
              ...awbPatch,
            }
          : { status: "packed", packedAt: new Date(), ...awbPatch },
        include: fullPackInclude,
      });
      await recordChange("PackingSlip", id, "update", updated, req.user.sub);
      return { packingSlip: updated, mismatches };
    }
  );

  // Legacy "Generate invoice from packed slip" endpoint. Kept for
  // backwards compatibility - all new callers should just hit /pack
  // which now also attaches the pre-generated invoice and decrements
  // stock atomically. This endpoint is now effectively an alias:
  //   * if the slip is 'open', it short-circuits to /pack;
  //   * if the slip is already 'packed' (legacy data only), it
  //     attaches the pre-generated invoice and applies the same
  //     stock-decrement logic /pack would have applied;
  //   * if the slip is already 'invoiced', it just returns the
  //     attached invoice (idempotent).
  // The body's paymentMode is ignored on the new path because
  // payment is settled via the Invoice's /pay endpoint, not at
  // pack/invoice time. Kept in the schema so old clients don't 400.
  app.post(
    "/packing-slips/:id/invoice",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      z.object({
        paymentMode: z
          .enum(["cash", "card", "upi", "credit", "split"])
          .default("credit"),
      })
        .parse(req.body ?? {});
      const ps = await db.packingSlip.findUnique({
        where: { id },
        include: {
          items: true,
          salesOrder: { select: { id: true, customerId: true } },
          pickList: { include: { items: true } },
        },
      });
      if (!ps) return reply.code(404).send({ error: { code: "not_found" } });

      // Migrate truly legacy SOs (created before the pre-gen rollout
      // and never invoiced) by minting their invoice now. The
      // helper is idempotent, so this is a no-op for everything
      // else.
      await ensureInvoiceForSalesOrder(db, ps.salesOrderId);

      // Idempotency / prepaid handoff. If an invoice is already linked
      // to this packing slip - either because the operator double-
      // clicked Generate invoice, or because the slip came from an
      // ecommerce order whose prepaid invoice was attached at pack-
      // complete - return the existing one instead of attempting a
      // second insert (which would 500 on the unique
      // Invoice.packingSlipId constraint and was the original bug).
      const existing = await db.invoice.findUnique({
        where: { packingSlipId: id },
        include: { items: { include: { product: true, variant: true } }, customer: true },
      });
      if (existing) {
        return reply.send(existing);
      }

      // Pre-generated invoice attached to the SO (but not yet to
      // this slip). Settle stock and bins per qtyPacked, attach the
      // invoice, and mark the slip 'invoiced'. This is the path
      // hit when older UI code still POSTs to this endpoint after
      // a /pack call - we do the work the /pack endpoint would
      // have done if the slip had been 'open'.
      const preGen = await db.invoice.findFirst({
        where: { salesOrderId: ps.salesOrderId, packingSlipId: null },
        orderBy: { createdAt: "asc" },
        include: {
          items: { include: { product: true, variant: true } },
          customer: true,
        },
      });
      if (preGen) {
        const positives = ps.items.filter((i) => i.qtyPacked > 0);
        if (positives.length === 0) {
          return reply.code(409).send({
            error: { code: "nothing_to_invoice", message: "No qtyPacked > 0." },
          });
        }
        const pickItems = ps.pickList?.items ?? [];
        for (const p of positives) {
          const pi = pickItems.find(
            (x) => x.salesOrderItemId === p.salesOrderItemId
          );
          const packed = Math.round(p.qtyPacked);
          const picked = Math.round(pi?.qtyPicked ?? p.qtyPacked);
          if (pi?.binId) {
            await db.bin.update({
              where: { id: pi.binId },
              data: {
                qty: { decrement: packed },
                reservedQty: { decrement: picked },
              },
            });
          }
          if (p.variantId) {
            await db.productVariant.update({
              where: { id: p.variantId },
              data: { stockOnHand: { decrement: packed } },
            });
          } else {
            await db.product.update({
              where: { id: p.productId },
              data: { stockOnHand: { decrement: packed } },
            });
          }
          await db.salesOrderItem.update({
            where: { id: p.salesOrderItemId },
            data: { qtyInvoiced: { increment: packed } },
          });
          await createSaleLedgerFromPickBin({
            productId: p.productId,
            variantId: p.variantId,
            qty: packed,
            ref: preGen.invoiceNo,
            binId: pi?.binId,
          });
        }
        await db.invoice.update({
          where: { id: preGen.id },
          data: { packingSlipId: id },
        });
        const reconciled = await reconcileInvoiceWithPack(
          db,
          preGen.id,
          ps.items.map((p) => ({
            salesOrderItemId: p.salesOrderItemId,
            qtyPacked: p.qtyPacked,
            rate: p.rate,
          }))
        );
        await db.packingSlip.update({
          where: { id },
          data: { status: "invoiced", invoicedAt: new Date() },
        });

        // Roll up SO status (mirrors the /pack handler).
        const so = await db.salesOrder.findUnique({
          where: { id: ps.salesOrderId },
          include: { items: true },
        });
        if (so) {
          const totalOrd = so.items.reduce(
            (s, it) => s + it.qtyOrdered - it.qtyCancelled,
            0
          );
          const totalInv = so.items.reduce((s, it) => s + it.qtyInvoiced, 0);
          const newStatus =
            totalInv >= totalOrd - 1e-6
              ? "invoiced"
              : totalInv > 0
                ? "partially_invoiced"
                : "confirmed";
          if (newStatus !== so.status) {
            const u = await db.salesOrder.update({
              where: { id: so.id },
              data: { status: newStatus },
            });
            await recordChange("SalesOrder", u.id, "update", u, req.user.sub);
          }
        }
        await recordChange("Invoice", preGen.id, "update", reconciled, req.user.sub);
        return reply.send(reconciled);
      }

      // Unreachable: ensureInvoiceForSalesOrder ran at the top of
      // the handler, so either `existing` (slip already attached)
      // or `preGen` (SO had an unattached invoice) must have
      // matched. Falling through here implies a logic bug upstream,
      // so 500 with a clear marker.
      return reply.code(500).send({
        error: {
          code: "invoice_pre_gen_missing",
          message:
            "Pre-generated invoice could not be located after ensureInvoiceForSalesOrder. This is a bug.",
        },
      });
    }
  );

  // ----------------------------- Courier dispatch (ecommerce orders) ---
  // Static catalogue of supported couriers. We keep this in code rather
  // than a Master table because the list is short, rarely changes, and
  // the production deployment will swap the mock with real adapter
  // bindings. The trackingUrl uses {AWB} as a placeholder that the
  // frontend resolves before opening the link.
  const COURIERS = [
    {
      code: "shiprocket",
      name: "Shiprocket (mock)",
      trackingUrlTemplate: "https://app.shiprocket.in/courier-tracking/{AWB}",
    },
    {
      code: "bluedart",
      name: "Blue Dart",
      trackingUrlTemplate: "https://www.bluedart.com/tracking/{AWB}",
    },
    {
      code: "delhivery",
      name: "Delhivery",
      trackingUrlTemplate: "https://www.delhivery.com/track/package/{AWB}",
    },
    {
      code: "dtdc",
      name: "DTDC",
      trackingUrlTemplate: "https://www.dtdc.in/tracking.asp?strCnno={AWB}",
    },
    {
      code: "fedex",
      name: "FedEx",
      trackingUrlTemplate: "https://www.fedex.com/fedextrack/?trknbr={AWB}",
    },
    {
      code: "indiapost",
      name: "India Post Speed Post",
      trackingUrlTemplate: "https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx?ID={AWB}",
    },
  ] as const;

  app.get("/couriers", async () => {
    return COURIERS.map((c) => ({ code: c.code, name: c.name }));
  });

  // Assign a courier (and AWB) to a packing slip. Mirrors the
  // "Assign to trip" flow used by B2B - the operator picks a courier
  // from the list, optionally types/pastes an AWB (or lets the server
  // mint a mock one), and the slip's tracking strip lights up. Allowed
  // anywhere except 'cancelled' so the operator can assign or correct
  // tracking even after the slip is technically invoiced.
  const courierAssignBody = z.object({
    courier: z.string().min(2),
    awb: z.string().min(3).max(60).optional(),
  });
  app.post(
    "/packing-slips/:id/assign-courier",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const body = courierAssignBody.parse(req.body);
      const ps = await db.packingSlip.findUnique({ where: { id } });
      if (!ps) return reply.code(404).send({ error: { code: "not_found" } });
      if (ps.status === "cancelled") {
        return reply.code(409).send({
          error: {
            code: "bad_state",
            message: "Cannot assign a courier to a cancelled packing slip.",
          },
        });
      }
      // Map courier code -> display name + tracking template. If the
      // operator typed a freeform value we keep it as-is so the desktop
      // can show whatever they entered.
      const known = COURIERS.find((c) => c.code === body.courier);
      const displayName = known?.name ?? body.courier;
      const awb =
        body.awb?.trim() ||
        `MOCK-AWB-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
      const trackingUrl = known
        ? known.trackingUrlTemplate.replace("{AWB}", encodeURIComponent(awb))
        : null;
      const updated = await db.packingSlip.update({
        where: { id },
        data: {
          carrier: displayName,
          awb,
          trackingUrl,
          dispatchedAt: ps.dispatchedAt ?? new Date(),
        },
        include: fullPackInclude,
      });
      await recordChange("PackingSlip", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  // Mark the courier-handed package as delivered. Final state for an
  // ecommerce order. We don't move slip.status here (it's already
  // 'invoiced' for prepaid orders) - just stamp deliveredAt so the UI
  // can show "Delivered ddd at hh:mm" in the courier strip.
  app.post(
    "/packing-slips/:id/confirm-delivery",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const ps = await db.packingSlip.findUnique({ where: { id } });
      if (!ps) return reply.code(404).send({ error: { code: "not_found" } });
      if (!ps.awb) {
        return reply.code(409).send({
          error: {
            code: "no_courier",
            message: "Assign a courier before confirming delivery.",
          },
        });
      }
      if (ps.deliveredAt) {
        const fresh = await db.packingSlip.findUnique({
          where: { id },
          include: fullPackInclude,
        });
        return fresh;
      }
      const updated = await db.packingSlip.update({
        where: { id },
        data: { deliveredAt: new Date() },
        include: fullPackInclude,
      });
      await recordChange("PackingSlip", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  app.post(
    "/packing-slips/:id/cancel",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const ps = await db.packingSlip.findUnique({
        where: { id },
        include: { pickList: { include: { items: true } } },
      });
      if (!ps) return reply.code(404).send({ error: { code: "not_found" } });
      if (ps.status === "invoiced") {
        return reply.code(409).send({
          error: {
            code: "already_invoiced",
            message: "Cannot cancel; the slip has been invoiced.",
          },
        });
      }
      // Release any reservations from the linked pick list
      for (const pi of ps.pickList?.items ?? []) {
        if (pi.binId && pi.qtyPicked > 0) {
          await db.bin.update({
            where: { id: pi.binId },
            data: { reservedQty: { decrement: Math.round(pi.qtyPicked) } },
          });
        }
      }
      const updated = await db.packingSlip.update({
        where: { id },
        data: { status: "cancelled", cancelledAt: new Date() },
        include: fullPackInclude,
      });
      // Also revert linked pick list to 'cancelled' so the SO can be re-picked
      if (ps.pickListId) {
        await db.pickList.update({
          where: { id: ps.pickListId },
          data: { status: "cancelled", cancelledAt: new Date() },
        });
      }
      await recordChange("PackingSlip", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  // ====================================================== Mobile claim/scan ===

  // Self-claim a pick list. 409 if already claimed by someone else;
  // re-claim by the same user is a no-op (lets the mobile resume after
  // a network hiccup without showing an error).
  app.post(
    "/pick-lists/:id/claim",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const pl = await db.pickList.findUnique({ where: { id } });
      if (!pl) return reply.code(404).send({ error: { code: "not_found" } });
      if (!["draft", "picking"].includes(pl.status)) {
        return reply.code(409).send({
          error: { code: "bad_state", message: `Pick list is '${pl.status}'.` },
        });
      }
      if (pl.assignedToId && pl.assignedToId !== req.user.sub) {
        return reply.code(409).send({
          error: {
            code: "already_claimed",
            message: "Already claimed by another worker.",
          },
        });
      }
      const updated = await db.pickList.update({
        where: { id },
        data: {
          assignedToId: req.user.sub,
          claimedAt: pl.claimedAt ?? new Date(),
          status: pl.status === "draft" ? "picking" : pl.status,
        },
        include: fullPickInclude,
      });
      await recordChange("PickList", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  // Release a claim. Only the owner (or an admin) can release. We don't
  // touch status; the next worker can pick up where this one left off.
  app.post(
    "/pick-lists/:id/release",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const pl = await db.pickList.findUnique({ where: { id } });
      if (!pl) return reply.code(404).send({ error: { code: "not_found" } });
      if (
        pl.assignedToId &&
        pl.assignedToId !== req.user.sub &&
        req.user.role !== "admin" &&
        req.user.role !== "supervisor"
      ) {
        return reply.code(403).send({
          error: { code: "forbidden", message: "Only the claimer can release." },
        });
      }
      const updated = await db.pickList.update({
        where: { id },
        data: { assignedToId: null, claimedAt: null },
        include: fullPickInclude,
      });
      await recordChange("PickList", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  // Stale-line recovery. When a worker discovers at /complete time
  // that a previously confirmed line has zero stock left (because
  // another in-flight pick drained the variant before this one was
  // packed), they can't proceed and they can't naturally un-confirm
  // the line either. This endpoint resets the line back to qtyPicked=0
  // so the worker can either rescan with the correct (lower) qty or
  // skip the line entirely. We also drop any bin reservation that
  // would have ridden along with it. The endpoint is idempotent.
  app.post(
    "/pick-lists/:id/items/:itemId/reset",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id, itemId } = req.params as { id: string; itemId: string };
      const pl = await db.pickList.findUnique({ where: { id } });
      if (!pl) return reply.code(404).send({ error: { code: "not_found" } });
      if (!["draft", "picking"].includes(pl.status)) {
        return reply.code(409).send({
          error: { code: "bad_state", message: `Pick list is '${pl.status}'.` },
        });
      }
      const item = await db.pickListItem.findFirst({
        where: { id: itemId, pickListId: id },
      });
      if (!item) return reply.code(404).send({ error: { code: "not_found" } });
      if (item.qtyPicked === 0) {
        const fresh = await db.pickList.findUnique({
          where: { id },
          include: fullPickInclude,
        });
        return fresh;
      }
      await db.pickListItem.update({
        where: { id: item.id },
        data: { qtyPicked: 0 },
      });
      const updated = await db.pickList.findUnique({
        where: { id },
        include: fullPickInclude,
      });
      await recordChange("PickList", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  // Per-line scan-confirm. Mobile sends { binCode?, productCode?, qty,
  // reasonCode?, clientOpId }. The endpoint:
  //   1. validates the scanned bin matches the line's assigned bin
  //      (or assigns it if unassigned),
  //   2. validates the scanned product matches the line's productId
  //      / variantId,
  //   3. updates qtyPicked,
  //   4. records a ScanEvent for forensics.
  //
  // clientOpId is the idempotency key. If the same id is sent twice we
  // return the existing line as-is and don't double-write.
  app.post(
    "/pick-lists/:id/items/:itemId/scan",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id, itemId } = req.params as { id: string; itemId: string };
      const body = z
        .object({
          binCode: z.string().min(1).optional(),
          productCode: z.string().min(1).optional(),
          qty: z.number().nonnegative(),
          reasonCode: z
            .enum([
              "ok",
              "short_pick",
              "damage",
              "not_found",
              "wrong_bin",
              "substitute",
              "other",
            ])
            .default("ok"),
          remarks: z.string().max(500).nullable().optional(),
          clientOpId: z.string().min(8).max(64).optional(),
        })
        .parse(req.body);

      const pl = await db.pickList.findUnique({
        where: { id },
        include: {
          items: {
            where: { id: itemId },
            include: {
              bin: { include: { warehouse: { select: { code: true } } } },
              product: { select: { id: true, sku: true, barcode: true } },
              variant: { select: { id: true, sku: true, barcode: true } },
            },
          },
        },
      });
      if (!pl) return reply.code(404).send({ error: { code: "not_found" } });
      if (!["draft", "picking"].includes(pl.status)) {
        // Make the scan-time refusal actionable: we tell the worker
        // exactly which document moved on so they're not stuck guessing.
        // 'picked' = pick is locked, packing slip auto-created and is
        // where the next scan should happen. 'cancelled' = nothing to
        // do here. Either way the mobile page has a "Back to tasks"
        // button gated on the same status check, so the worker should
        // rarely see this message - but if they hit a stale tab, this
        // sentence is what they'll read.
        const slip = await db.packingSlip.findUnique({
          where: { pickListId: pl.id },
          select: { packingSlipNo: true, status: true },
        });
        const hint =
          pl.status === "picked" && slip
            ? ` Continue on packing slip ${slip.packingSlipNo}.`
            : pl.status === "cancelled"
              ? ` This pick was cancelled.`
              : "";
        return reply.code(409).send({
          error: {
            code: "bad_state",
            message: `Pick list ${pl.pickListNo} is '${pl.status}', no further scans allowed.${hint}`,
          },
        });
      }
      const item = pl.items[0];
      if (!item) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "Pick line not found." } });
      }

      // Idempotent replay: same clientOpId + same line + same qty -> no-op.
      // We re-use AuditLog as a cheap append-only ledger keyed by entity
      // id "pickItem:<itemId>:<clientOpId>".
      if (body.clientOpId) {
        const dupKey = `pickItem:${itemId}:${body.clientOpId}`;
        const seen = await db.auditLog.findFirst({
          where: { entity: "PickListItemScan", entityId: dupKey },
          select: { id: true },
        });
        if (seen) {
          return db.pickList.findUnique({ where: { id }, include: fullPickInclude });
        }
      }

      // Bin validation.
      let scannedBin: typeof item.bin = null;
      if (body.binCode) {
        scannedBin = await db.bin.findFirst({
          where: { code: body.binCode.trim().toUpperCase() },
          include: { warehouse: { select: { code: true } } },
        });
        if (!scannedBin) {
          await db.scanEvent.create({
            data: {
              userId: req.user.sub,
              kind: "bin",
              code: body.binCode,
              context: `pick:${pl.pickListNo}`,
              outcome: "not_found",
            },
          });
          return reply.code(404).send({
            error: { code: "bin_not_found", message: "Scanned bin code is unknown." },
          });
        }
        // If the line already had a bin, the new scan must match.
        if (item.binId && item.binId !== scannedBin.id) {
          await db.scanEvent.create({
            data: {
              userId: req.user.sub,
              kind: "bin",
              code: body.binCode,
              context: `pick:${pl.pickListNo}`,
              outcome: "mismatch",
            },
          });
          if (body.reasonCode === "ok") {
            return reply.code(409).send({
              error: {
                code: "bin_mismatch",
                message: `Expected bin ${item.bin?.code ?? "(none)"}, scanned ${body.binCode}. Re-send with reasonCode=wrong_bin to override.`,
              },
            });
          }
        }
      }

      // Product validation. Accept the parent SKU/barcode or the
      // variant SKU/barcode (whichever the operator scanned).
      if (body.productCode) {
        const probe = body.productCode.trim();
        const codeMatch = (a: string | null | undefined) =>
          a != null && codesEqual(a, probe);
        const matchesProduct =
          codeMatch(item.product?.sku) || codeMatch(item.product?.barcode);
        const matchesVariant =
          codeMatch(item.variant?.sku) || codeMatch(item.variant?.barcode);
        if (!matchesProduct && !matchesVariant) {
          await db.scanEvent.create({
            data: {
              userId: req.user.sub,
              kind: "product",
              code: body.productCode,
              context: `pick:${pl.pickListNo}`,
              outcome: "mismatch",
            },
          });
          if (body.reasonCode === "ok") {
            return reply.code(409).send({
              error: {
                code: "product_mismatch",
                message: `Scanned ${probe} does not match expected ${item.variant?.sku ?? item.product?.sku ?? "?"}. Re-send with reasonCode=substitute to override.`,
              },
            });
          }
        }
      }

      // Qty validation: short-pick is allowed (it's the whole point of
      // mobile scan-confirm), over-pick is blocked unless reason=other.
      if (body.qty > item.qtyToPick + 1e-6 && body.reasonCode === "ok") {
        return reply.code(409).send({
          error: {
            code: "over_pick",
            message: `Cannot pick ${body.qty} when only ${item.qtyToPick} was suggested.`,
          },
        });
      }

      // Variant stock guard. Bin.qty is parent-product level so the
      // bin reservation alone won't catch "I want 5 of variant V but
      // only 2 V exist on the floor (the rest of bin.qty is sibling
      // variants)". We check the variant's running stockOnHand here
      // and refuse the scan, letting the worker recount the bin or
      // amend the pick before they walk away from the shelf.
      //
      // The "already committed" total covers BOTH:
      //   (a) sibling lines on this pick list (multi-bin splits), and
      //   (b) lines on OTHER active pick lists that haven't been
      //       pack-completed yet (so their qtyPicked is still riding
      //       on top of stockOnHand). Without (b) two concurrent picks
      //       for the same variant could each individually pass the
      //       per-list check, both flow into packing, and the second
      //       one only fails at pack-time - by which point the worker
      //       is at the buttons screen, line marked confirmed, with a
      //       message they can't act on. This is the bug that made the
      //       UI say "confirmed" while /complete returned "0 on hand".
      if (item.variantId && body.qty > 0) {
        const v = await db.productVariant.findUnique({
          where: { id: item.variantId },
          select: { stockOnHand: true, sku: true },
        });
        if (v) {
          const [siblingHere, siblingElsewhere] = await Promise.all([
            db.pickListItem.aggregate({
              where: {
                pickListId: id,
                variantId: item.variantId,
                id: { not: item.id },
              },
              _sum: { qtyPicked: true },
            }),
            db.pickListItem.aggregate({
              where: {
                variantId: item.variantId,
                qtyPicked: { gt: 0 },
                pickListId: { not: id },
                pickList: {
                  status: { in: ["draft", "picking", "picked"] },
                  OR: [
                    { packingSlip: null },
                    { packingSlip: { status: { notIn: ["packed", "invoiced"] } } },
                  ],
                },
              },
              _sum: { qtyPicked: true },
            }),
          ]);
          const otherHere = siblingHere._sum.qtyPicked ?? 0;
          const otherElsewhere = siblingElsewhere._sum.qtyPicked ?? 0;
          const otherUsed = otherHere + otherElsewhere;
          const wantTotal = otherUsed + body.qty;
          if (wantTotal > (v.stockOnHand ?? 0) + 1e-6) {
            await db.scanEvent.create({
              data: {
                userId: req.user.sub,
                kind: "product",
                code: body.productCode ?? v.sku,
                context: `pick:${pl.pickListNo}`,
                outcome: "insufficient_stock",
              },
            });
            const elsewhereNote =
              otherElsewhere > 0
                ? ` (${otherHere} on this pick, ${otherElsewhere} on other in-flight picks)`
                : otherHere > 0
                  ? ` (other lines on this pick already commit ${otherHere})`
                  : "";
            return reply.code(409).send({
              error: {
                code: "insufficient_stock",
                message: `Only ${v.stockOnHand ?? 0} of ${v.sku} on hand${elsewhereNote}. Recount the bin or amend the pick.`,
                details: {
                  variantSku: v.sku,
                  available: v.stockOnHand ?? 0,
                  alreadyCommittedOnThisPick: otherHere,
                  alreadyCommittedElsewhere: otherElsewhere,
                  requested: body.qty,
                },
              },
            });
          }
        }
      }

      // Compose updated notes line with the reason code.
      const reasonNote =
        body.reasonCode === "ok"
          ? null
          : `[${body.reasonCode}] ${body.remarks ?? ""}`.trim();
      const updatedItem = await db.pickListItem.update({
        where: { id: item.id },
        data: {
          qtyPicked: body.qty,
          ...(scannedBin && !item.binId ? { binId: scannedBin.id } : {}),
          ...(reasonNote
            ? { notes: [item.notes, reasonNote].filter(Boolean).join("\n") }
            : {}),
        },
      });

      await db.scanEvent.create({
        data: {
          userId: req.user.sub,
          kind: scannedBin ? "bin" : "product",
          code: body.binCode ?? body.productCode ?? "manual",
          context: `pick:${pl.pickListNo}`,
          outcome: "ok",
        },
      });
      if (body.clientOpId) {
        await db.auditLog.create({
          data: {
            userId: req.user.sub,
            action: "scan_confirm",
            entity: "PickListItemScan",
            entityId: `pickItem:${itemId}:${body.clientOpId}`,
            after: JSON.stringify({
              qty: body.qty,
              reason: body.reasonCode,
              binCode: body.binCode ?? null,
              productCode: body.productCode ?? null,
            }),
          },
        });
      }
      await recordChange("PickListItem", item.id, "update", updatedItem, req.user.sub);

      return db.pickList.findUnique({ where: { id }, include: fullPickInclude });
    }
  );

  // -------- Packing slips: claim / release / scan-confirm ---------------------

  app.post(
    "/packing-slips/:id/claim",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const ps = await db.packingSlip.findUnique({ where: { id } });
      if (!ps) return reply.code(404).send({ error: { code: "not_found" } });
      if (ps.status !== "open") {
        return reply.code(409).send({
          error: { code: "bad_state", message: `Packing slip is '${ps.status}'.` },
        });
      }
      if (ps.assignedToId && ps.assignedToId !== req.user.sub) {
        return reply.code(409).send({
          error: {
            code: "already_claimed",
            message: "Already claimed by another worker.",
          },
        });
      }
      const updated = await db.packingSlip.update({
        where: { id },
        data: {
          assignedToId: req.user.sub,
          claimedAt: ps.claimedAt ?? new Date(),
        },
        include: fullPackInclude,
      });
      await recordChange("PackingSlip", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  app.post(
    "/packing-slips/:id/release",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const ps = await db.packingSlip.findUnique({ where: { id } });
      if (!ps) return reply.code(404).send({ error: { code: "not_found" } });
      if (
        ps.assignedToId &&
        ps.assignedToId !== req.user.sub &&
        req.user.role !== "admin" &&
        req.user.role !== "supervisor"
      ) {
        return reply.code(403).send({
          error: { code: "forbidden", message: "Only the claimer can release." },
        });
      }
      const updated = await db.packingSlip.update({
        where: { id },
        data: { assignedToId: null, claimedAt: null },
        include: fullPackInclude,
      });
      await recordChange("PackingSlip", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  // Per-line pack scan-confirm. qtyPacked is clamped to qtyPicked
  // (matches the existing /packing-slips/:id PATCH semantics) and
  // returns 409 if the operator scanned the wrong product.
  app.post(
    "/packing-slips/:id/items/:itemId/scan",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id, itemId } = req.params as { id: string; itemId: string };
      const body = z
        .object({
          productCode: z.string().min(1).optional(),
          qty: z.number().nonnegative(),
          reasonCode: z
            .enum([
              "ok",
              "short_pack",
              "damage",
              "substitute",
              "other",
            ])
            .default("ok"),
          remarks: z.string().max(500).nullable().optional(),
          clientOpId: z.string().min(8).max(64).optional(),
        })
        .parse(req.body);

      const ps = await db.packingSlip.findUnique({
        where: { id },
        include: {
          items: {
            where: { id: itemId },
            include: {
              product: { select: { sku: true, barcode: true } },
              variant: { select: { sku: true, barcode: true } },
            },
          },
        },
      });
      if (!ps) return reply.code(404).send({ error: { code: "not_found" } });
      if (ps.status !== "open") {
        return reply.code(409).send({
          error: { code: "bad_state", message: `Packing slip is '${ps.status}'.` },
        });
      }
      const item = ps.items[0];
      if (!item) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "Pack line not found." } });
      }

      if (body.clientOpId) {
        const dupKey = `packItem:${itemId}:${body.clientOpId}`;
        const seen = await db.auditLog.findFirst({
          where: { entity: "PackingSlipItemScan", entityId: dupKey },
          select: { id: true },
        });
        if (seen) {
          return db.packingSlip.findUnique({
            where: { id },
            include: fullPackInclude,
          });
        }
      }

      if (body.productCode) {
        const probe = body.productCode.trim();
        const codeMatch = (a: string | null | undefined) =>
          a != null && codesEqual(a, probe);
        const matches =
          codeMatch(item.product?.sku) ||
          codeMatch(item.product?.barcode) ||
          codeMatch(item.variant?.sku) ||
          codeMatch(item.variant?.barcode);
        if (!matches) {
          await db.scanEvent.create({
            data: {
              userId: req.user.sub,
              kind: "product",
              code: body.productCode,
              context: `pack:${ps.packingSlipNo}`,
              outcome: "mismatch",
            },
          });
          if (body.reasonCode === "ok") {
            return reply.code(409).send({
              error: {
                code: "product_mismatch",
                message: `Scanned ${probe} does not match line. Re-send with reasonCode=substitute to override.`,
              },
            });
          }
        }
      }

      // Cap at qtyPicked - you cannot pack more than you picked.
      if (body.qty > item.qtyPicked + 1e-6) {
        return reply.code(409).send({
          error: {
            code: "over_pack",
            message: `qtyPacked ${body.qty} exceeds qtyPicked ${item.qtyPicked}.`,
          },
        });
      }

      const reasonNote =
        body.reasonCode === "ok"
          ? null
          : `[${body.reasonCode}] ${body.remarks ?? ""}`.trim();
      await db.packingSlipItem.update({
        where: { id: item.id },
        data: {
          qtyPacked: body.qty,
          amount: body.qty * item.rate,
          ...(reasonNote
            ? { notes: [item.notes, reasonNote].filter(Boolean).join("\n") }
            : {}),
        },
      });

      await db.scanEvent.create({
        data: {
          userId: req.user.sub,
          kind: "product",
          code: body.productCode ?? "manual",
          context: `pack:${ps.packingSlipNo}`,
          outcome: "ok",
        },
      });
      if (body.clientOpId) {
        await db.auditLog.create({
          data: {
            userId: req.user.sub,
            action: "scan_confirm",
            entity: "PackingSlipItemScan",
            entityId: `packItem:${itemId}:${body.clientOpId}`,
            after: JSON.stringify({
              qty: body.qty,
              reason: body.reasonCode,
              productCode: body.productCode ?? null,
            }),
          },
        });
      }
      return db.packingSlip.findUnique({ where: { id }, include: fullPackInclude });
    }
  );

  // ===================================================== Packing containers ===
  // Multi-container packing. Every slip starts with zero containers;
  // the operator creates one per physical box / bag / sack, allocates
  // items into it, optionally sets an actual scale reading, and then
  // seals. Once sealed the container's contents and tare contribute to
  // the cached PackingSlip.totalEstWeightKg / totalActualWeightKg, which
  // is what the trip dispatch flow reads when rolling up weights.

  // Resolve the slip + assert that it is editable (open). Used by every
  // container-mutation endpoint below so we don't drift.
  const requireOpenSlip = async (
    slipId: string,
    reply: Parameters<typeof app.post>[1]
  ) => {
    const slip = await db.packingSlip.findUnique({
      where: { id: slipId },
      select: { id: true, status: true },
    });
    if (!slip) {
      (reply as unknown as { code: (n: number) => unknown; send: (b: unknown) => unknown }).code(404);
      return { slip: null };
    }
    if (slip.status !== "open") {
      return { slip: null, locked: true };
    }
    return { slip };
  };

  app.get(
    "/packing-slips/:id/containers",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const exists = await db.packingSlip.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!exists) return reply.code(404).send({ error: { code: "not_found" } });
      return db.packingContainer.findMany({
        where: { packingSlipId: id },
        include: packContainerInclude,
        orderBy: { seq: "asc" },
      });
    }
  );

  const containerCreateBody = z.object({
    containerTypeId: z.string().min(1).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  });

  app.post(
    "/packing-slips/:id/containers",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const body = containerCreateBody.parse(req.body ?? {});
      const slip = await db.packingSlip.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!slip) return reply.code(404).send({ error: { code: "not_found" } });
      if (slip.status !== "open") {
        return reply.code(409).send({
          error: { code: "locked", message: `Packing slip is '${slip.status}'.` },
        });
      }
      await ensureDefaultContainerTypes(db);
      const { seq, label } = await nextContainerSeq(db, id);
      const created = await db.packingContainer.create({
        data: {
          packingSlipId: id,
          seq,
          label,
          containerTypeId: body.containerTypeId ?? null,
          notes: body.notes ?? null,
          status: "open",
          estWeightKg: 0,
        },
        include: packContainerInclude,
      });
      await recomputeContainer(db, created.id);
      await recomputePackingSlipWeight(db, id);
      await recordChange("PackingContainer", created.id, "insert", created, req.user.sub);
      return db.packingContainer.findUnique({
        where: { id: created.id },
        include: packContainerInclude,
      });
    }
  );

  const containerUpdateBody = z.object({
    containerTypeId: z.string().min(1).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    tareKgOverride: z.number().min(0).max(500).nullable().optional(),
    actualWeightKg: z.number().min(0).max(5000).nullable().optional(),
  });

  app.patch(
    "/packing-slips/:id/containers/:cid",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id, cid } = req.params as { id: string; cid: string };
      const body = containerUpdateBody.parse(req.body);
      const container = await db.packingContainer.findUnique({
        where: { id: cid },
        select: { id: true, packingSlipId: true, status: true },
      });
      if (!container || container.packingSlipId !== id) {
        return reply.code(404).send({ error: { code: "not_found" } });
      }
      // We let the packer correct the actual weight even after sealing
      // (e.g. the scale was zeroed wrong) but everything else is frozen
      // once sealed.
      if (
        container.status === "sealed" &&
        (body.containerTypeId !== undefined ||
          body.tareKgOverride !== undefined ||
          body.notes !== undefined)
      ) {
        return reply.code(409).send({
          error: {
            code: "container_sealed",
            message: "Unseal the container before changing type / tare / notes.",
          },
        });
      }
      const updated = await db.packingContainer.update({
        where: { id: cid },
        data: {
          ...(body.containerTypeId !== undefined ? { containerTypeId: body.containerTypeId } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.tareKgOverride !== undefined ? { tareKgOverride: body.tareKgOverride } : {}),
          ...(body.actualWeightKg !== undefined ? { actualWeightKg: body.actualWeightKg } : {}),
        },
      });
      await recomputeContainer(db, cid);
      await recomputePackingSlipWeight(db, id);
      await recordChange("PackingContainer", cid, "update", updated, req.user.sub);
      return db.packingContainer.findUnique({
        where: { id: cid },
        include: packContainerInclude,
      });
    }
  );

  app.delete(
    "/packing-slips/:id/containers/:cid",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id, cid } = req.params as { id: string; cid: string };
      const container = await db.packingContainer.findUnique({
        where: { id: cid },
        select: { id: true, packingSlipId: true, status: true },
      });
      if (!container || container.packingSlipId !== id) {
        return reply.code(404).send({ error: { code: "not_found" } });
      }
      const slip = await db.packingSlip.findUnique({
        where: { id },
        select: { status: true },
      });
      if (slip && slip.status !== "open") {
        return reply.code(409).send({
          error: { code: "locked", message: `Packing slip is '${slip.status}'.` },
        });
      }
      await db.packingContainer.delete({ where: { id: cid } });
      // Close the gap so the operator never sees 01, 03 — labels must
      // remain contiguous because they're printed on physical stickers.
      await renumberContainers(db, id);
      await recomputePackingSlipWeight(db, id);
      await recordChange("PackingContainer", cid, "delete", { id: cid }, req.user.sub);
      return { ok: true };
    }
  );

  // ----- container <-> item allocation -----
  const itemAddBody = z.object({
    packingSlipItemId: z.string().min(1),
    qty: z.number().positive(),
  });

  // Upsert an item allocation in a container. Sums with existing qty
  // for the same line — the mobile scan path calls this with qty=1 per
  // scan, so the operator keeps incrementing without thinking about
  // existing rows. Refuses if total allocation across all containers
  // would exceed the slip line's qtyPacked (with a small epsilon).
  app.post(
    "/packing-slips/:id/containers/:cid/items",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id, cid } = req.params as { id: string; cid: string };
      const body = itemAddBody.parse(req.body);
      const container = await db.packingContainer.findUnique({
        where: { id: cid },
        include: {
          packingSlip: { select: { status: true, id: true } },
        },
      });
      if (!container || container.packingSlipId !== id) {
        return reply.code(404).send({ error: { code: "not_found" } });
      }
      if (container.packingSlip.status !== "open") {
        return reply.code(409).send({
          error: {
            code: "locked",
            message: `Packing slip is '${container.packingSlip.status}'.`,
          },
        });
      }
      if (container.status !== "open") {
        return reply.code(409).send({
          error: { code: "container_sealed", message: "Unseal the container to edit it." },
        });
      }
      const line = await db.packingSlipItem.findUnique({
        where: { id: body.packingSlipItemId },
        select: { id: true, packingSlipId: true, qtyPacked: true },
      });
      if (!line || line.packingSlipId !== id) {
        return reply.code(404).send({ error: { code: "line_not_found" } });
      }
      if (line.qtyPacked <= 0) {
        return reply.code(409).send({
          error: {
            code: "qty_not_confirmed",
            message:
              "Confirm the pack qty for this line before allocating it to a container.",
          },
        });
      }
      // Sum allocations across every container for this line so we
      // can refuse over-allocation. The operator can still split a
      // line across multiple containers — that's the whole point.
      const allocs = await db.packingContainerItem.findMany({
        where: { packingSlipItemId: line.id },
        select: { containerId: true, qty: true },
      });
      const otherTotal = allocs
        .filter((a) => a.containerId !== cid)
        .reduce((s, a) => s + a.qty, 0);
      const myExisting = allocs.find((a) => a.containerId === cid)?.qty ?? 0;
      const newMine = myExisting + body.qty;
      if (otherTotal + newMine > line.qtyPacked + 1e-6) {
        return reply.code(409).send({
          error: {
            code: "over_allocate",
            message: `Total allocation ${(otherTotal + newMine).toFixed(2)} exceeds qty packed ${line.qtyPacked}.`,
            details: {
              qtyPacked: line.qtyPacked,
              alreadyAllocatedElsewhere: otherTotal,
              attempted: newMine,
            },
          },
        });
      }
      const upserted = await db.packingContainerItem.upsert({
        where: {
          containerId_packingSlipItemId: {
            containerId: cid,
            packingSlipItemId: line.id,
          },
        },
        update: { qty: newMine },
        create: {
          containerId: cid,
          packingSlipItemId: line.id,
          qty: body.qty,
        },
      });
      await recomputeContainer(db, cid);
      await recomputePackingSlipWeight(db, id);
      await recordChange(
        "PackingContainerItem",
        upserted.id,
        "update",
        upserted,
        req.user.sub
      );
      return db.packingContainer.findUnique({
        where: { id: cid },
        include: packContainerInclude,
      });
    }
  );

  const itemPatchBody = z.object({ qty: z.number().nonnegative() });

  // Replace the allocated qty for a single (container, slip-line)
  // row. Setting qty=0 is the canonical "remove this line from the
  // container" operation — we delete instead of carrying zero rows.
  app.patch(
    "/packing-slips/:id/containers/:cid/items/:itemId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id, cid, itemId } = req.params as {
        id: string;
        cid: string;
        itemId: string;
      };
      const body = itemPatchBody.parse(req.body);
      const ci = await db.packingContainerItem.findUnique({
        where: { id: itemId },
        include: {
          container: { select: { id: true, status: true, packingSlipId: true } },
          packingSlipItem: { select: { id: true, qtyPacked: true, packingSlipId: true } },
        },
      });
      if (
        !ci ||
        ci.container.id !== cid ||
        ci.container.packingSlipId !== id ||
        ci.packingSlipItem.packingSlipId !== id
      ) {
        return reply.code(404).send({ error: { code: "not_found" } });
      }
      const slip = await db.packingSlip.findUnique({
        where: { id },
        select: { status: true },
      });
      if (slip && slip.status !== "open") {
        return reply.code(409).send({
          error: { code: "locked", message: `Packing slip is '${slip.status}'.` },
        });
      }
      if (ci.container.status !== "open") {
        return reply.code(409).send({
          error: { code: "container_sealed", message: "Unseal the container to edit it." },
        });
      }
      if (body.qty === 0) {
        await db.packingContainerItem.delete({ where: { id: itemId } });
      } else {
        const sibling = await db.packingContainerItem.findMany({
          where: { packingSlipItemId: ci.packingSlipItem.id, NOT: { id: itemId } },
          select: { qty: true },
        });
        const otherTotal = sibling.reduce((s, a) => s + a.qty, 0);
        if (otherTotal + body.qty > ci.packingSlipItem.qtyPacked + 1e-6) {
          return reply.code(409).send({
            error: {
              code: "over_allocate",
              message: "Allocation exceeds qty packed.",
            },
          });
        }
        await db.packingContainerItem.update({
          where: { id: itemId },
          data: { qty: body.qty },
        });
      }
      await recomputeContainer(db, cid);
      await recomputePackingSlipWeight(db, id);
      await recordChange("PackingContainerItem", itemId, "update", { qty: body.qty }, req.user.sub);
      return db.packingContainer.findUnique({
        where: { id: cid },
        include: packContainerInclude,
      });
    }
  );

  app.delete(
    "/packing-slips/:id/containers/:cid/items/:itemId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id, cid, itemId } = req.params as {
        id: string;
        cid: string;
        itemId: string;
      };
      const ci = await db.packingContainerItem.findUnique({
        where: { id: itemId },
        select: {
          id: true,
          container: { select: { id: true, status: true, packingSlipId: true } },
        },
      });
      if (
        !ci ||
        ci.container.id !== cid ||
        ci.container.packingSlipId !== id
      ) {
        return reply.code(404).send({ error: { code: "not_found" } });
      }
      const slip = await db.packingSlip.findUnique({
        where: { id },
        select: { status: true },
      });
      if (slip && slip.status !== "open") {
        return reply.code(409).send({
          error: { code: "locked", message: `Packing slip is '${slip.status}'.` },
        });
      }
      if (ci.container.status !== "open") {
        return reply.code(409).send({
          error: { code: "container_sealed", message: "Unseal the container to edit it." },
        });
      }
      await db.packingContainerItem.delete({ where: { id: itemId } });
      await recomputeContainer(db, cid);
      await recomputePackingSlipWeight(db, id);
      await recordChange("PackingContainerItem", itemId, "delete", { id: itemId }, req.user.sub);
      return db.packingContainer.findUnique({
        where: { id: cid },
        include: packContainerInclude,
      });
    }
  );

  // ----- seal / unseal -----
  const sealBody = z.object({
    actualWeightKg: z.number().min(0).max(5000).nullable().optional(),
  });

  app.post(
    "/packing-slips/:id/containers/:cid/seal",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id, cid } = req.params as { id: string; cid: string };
      const body = sealBody.parse(req.body ?? {});
      const container = await db.packingContainer.findUnique({
        where: { id: cid },
        include: {
          packingSlip: { select: { status: true } },
          items: true,
        },
      });
      if (!container || container.packingSlipId !== id) {
        return reply.code(404).send({ error: { code: "not_found" } });
      }
      if (container.packingSlip.status !== "open") {
        return reply.code(409).send({
          error: {
            code: "locked",
            message: `Packing slip is '${container.packingSlip.status}'.`,
          },
        });
      }
      if (container.items.length === 0) {
        return reply.code(409).send({
          error: {
            code: "empty_container",
            message: "Add at least one item before sealing.",
          },
        });
      }
      const updated = await db.packingContainer.update({
        where: { id: cid },
        data: {
          status: "sealed",
          sealedAt: new Date(),
          sealedById: req.user.sub,
          ...(body.actualWeightKg !== undefined
            ? { actualWeightKg: body.actualWeightKg }
            : {}),
        },
      });
      await recomputeContainer(db, cid);
      await recomputePackingSlipWeight(db, id);
      await recordChange("PackingContainer", cid, "update", updated, req.user.sub);
      return db.packingContainer.findUnique({
        where: { id: cid },
        include: packContainerInclude,
      });
    }
  );

  // ----- container scan-out (dispatch loading) -----
  // Loader scans a container sticker at the dispatch bay. We resolve
  // the canonical code (C.<slipNo>.<NN>) to a PackingContainer, return
  // the slip + linked dispatch / trip so the mobile UI can show "this
  // container is on TRP-2026-101 -> KA-01-AB-1234". Records a ScanEvent
  // for the dispatch audit log.
  app.post(
    "/packing-containers/scan",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const body = z.object({ code: z.string().min(3) }).parse(req.body);
      const parsed = parseContainerCode(body.code);
      if (!parsed) {
        await db.scanEvent.create({
          data: {
            userId: req.user.sub,
            kind: "container",
            code: body.code,
            context: "dispatch-scan",
            outcome: "bad_format",
          },
        });
        return reply.code(400).send({
          error: {
            code: "bad_format",
            message:
              "Container code must look like C.<packingSlipNo>.<NN> (e.g. C.PS-2026-8042.03).",
          },
        });
      }
      const slip = await db.packingSlip.findUnique({
        where: { packingSlipNo: parsed.packingSlipNo },
        include: {
          salesOrder: { select: { id: true, soNo: true, customer: { select: { id: true, name: true, addressLine: true, city: true, state: true, pincode: true } } } },
          invoice: {
            select: {
              id: true,
              invoiceNo: true,
              dispatches: {
                select: {
                  id: true,
                  dispatchNo: true,
                  status: true,
                  weightKg: true,
                  vehicle: true,
                  driver: true,
                  trip: {
                    select: {
                      id: true,
                      tripNo: true,
                      scheduledDate: true,
                      vehicle: true,
                      driver: true,
                    },
                  },
                },
              },
            },
          },
          containers: {
            where: { seq: parsed.seq },
            include: packContainerInclude,
          },
        },
      });
      if (!slip || slip.containers.length === 0) {
        await db.scanEvent.create({
          data: {
            userId: req.user.sub,
            kind: "container",
            code: body.code,
            context: "dispatch-scan",
            outcome: "not_found",
          },
        });
        return reply.code(404).send({
          error: {
            code: "not_found",
            message: `No container ${parsed.seq} on slip ${parsed.packingSlipNo}.`,
          },
        });
      }
      const container = slip.containers[0]!;
      await db.scanEvent.create({
        data: {
          userId: req.user.sub,
          kind: "container",
          code: body.code,
          context: `dispatch-scan:${slip.packingSlipNo}`,
          outcome: container.status === "sealed" ? "ok" : "unsealed",
        },
      });
      return {
        code: containerCode(slip.packingSlipNo, container.seq),
        container,
        packingSlip: {
          id: slip.id,
          packingSlipNo: slip.packingSlipNo,
          status: slip.status,
          totalEstWeightKg: slip.totalEstWeightKg,
          totalActualWeightKg: slip.totalActualWeightKg,
          containerCount: await db.packingContainer.count({
            where: { packingSlipId: slip.id },
          }),
        },
        salesOrder: slip.salesOrder,
        invoice: slip.invoice,
      };
    }
  );

  app.post(
    "/packing-slips/:id/containers/:cid/unseal",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id, cid } = req.params as { id: string; cid: string };
      const container = await db.packingContainer.findUnique({
        where: { id: cid },
        select: { id: true, packingSlipId: true, status: true, packingSlip: { select: { status: true } } },
      });
      if (!container || container.packingSlipId !== id) {
        return reply.code(404).send({ error: { code: "not_found" } });
      }
      if (container.packingSlip.status !== "open") {
        return reply.code(409).send({
          error: {
            code: "locked",
            message: `Packing slip is '${container.packingSlip.status}'.`,
          },
        });
      }
      const updated = await db.packingContainer.update({
        where: { id: cid },
        data: { status: "open", sealedAt: null, sealedById: null },
      });
      await recomputePackingSlipWeight(db, id);
      await recordChange("PackingContainer", cid, "update", updated, req.user.sub);
      return db.packingContainer.findUnique({
        where: { id: cid },
        include: packContainerInclude,
      });
    }
  );
};
