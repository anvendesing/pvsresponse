// Transfer-order routes.
//
// Covers:
//   * PutawayRule CRUD  (GET/POST/PATCH/DELETE /putaway-rules)
//   * TransferOrder CRUD + lifecycle  (GET/POST /transfer-orders, /cancel,
//     /claim, /pick, /drop)
//
// Transfer order status flow:
//   ready -> (claim) -> ready [assigned] -> (pick) -> in_transit
//         -> (drop)  -> done
//   any   -> (cancel)  -> cancelled
//
// Inventory side-effects:
//   pick: decrement source Bin.qty, increment Bin.reservedQty on destination,
//         write StockLedger "out" row.
//   drop: decrement Bin.reservedQty on destination, increment destination Bin.qty,
//         write StockLedger "in" row.
//   cancel (while in_transit): reverse the "out" ledger entry + clear reservedQty.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { recordChange } from "../sync/log.js";
import { checkStockRules } from "../lib/stock-rules.js";
import { pickBestBin } from "../lib/putaway.js";
import { resolveReceiveBinForProduct } from "../lib/location-bin.js";

// ------------------------------------------------------------------ helpers

const requireWriter = (
  req: { user: { role: string } },
  reply: { code: (n: number) => { send: (b: unknown) => void } }
) => {
  const r = req.user.role;
  if (r !== "admin" && r !== "supervisor" && r !== "warehouse") {
    reply.code(403).send({
      error: { code: "forbidden", message: "Admins/supervisors/warehouse only" },
    });
    return false;
  }
  return true;
};

// Stricter gate for admin-only TO controls (assign-to-anyone, manual
// status override). Worker self-claim still uses the existing /claim
// endpoint and stays open to all authenticated users.
const requireAdminOrSupervisor = (
  req: { user: { role: string } },
  reply: { code: (n: number) => { send: (b: unknown) => void } }
) => {
  const r = req.user.role;
  if (r !== "admin" && r !== "supervisor") {
    reply.code(403).send({
      error: { code: "forbidden", message: "Admins or supervisors only" },
    });
    return false;
  }
  return true;
};

// Roles eligible to be assigned a transfer order. Sales / billing /
// accountant accounts are intentionally excluded.
const ASSIGNABLE_ROLES = ["admin", "supervisor", "warehouse", "worker"] as const;

// Allowed values for the manual status override. Mirrors the
// TransferOrderRow.status union on the frontend.
const TO_STATUSES = ["draft", "ready", "in_transit", "done", "cancelled"] as const;

const nextTransferNo = async (): Promise<string> => {
  const year = new Date().getUTCFullYear();
  const prefix = `TRF-${year}-`;
  const last = await db.transferOrder.findFirst({
    where: { transferNo: { startsWith: prefix } },
    orderBy: { transferNo: "desc" },
    select: { transferNo: true },
  });
  const n = last
    ? parseInt(last.transferNo.split("-").pop() ?? "2200", 10) + 1
    : 2201;
  return `${prefix}${String(n).padStart(4, "0")}`;
};

// Full include shape reused across GET endpoints.
const toInclude = {
  fromWarehouse: { select: { id: true, code: true, name: true, kind: true } },
  toWarehouse: { select: { id: true, code: true, name: true, kind: true } },
  productionOrder: { select: { id: true, orderNo: true, status: true } },
  assignedTo: { select: { id: true, name: true, username: true } },
  pickedBy: { select: { id: true, name: true } },
  droppedBy: { select: { id: true, name: true } },
  items: {
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true } },
      variant: { select: { id: true, sku: true, size: true } },
      fromBin: { select: { id: true, code: true, zone: true, shelf: true, bin: true, qty: true } },
      tobin: { select: { id: true, code: true, zone: true, shelf: true, bin: true, qty: true } },
    },
  },
} as const;

// ------------------------------------------------------------------ schemas

const putawayRuleCreate = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).nullable().optional(),
  toWarehouseId: z.string().min(1),
  // Zone-only destination (e.g. STR "PR" for the production staging
  // zone). When set without toBinId the resolver picks/creates a
  // per-product slot inside the zone instead of pinning a bin.
  toZone: z.string().trim().min(1).max(32).nullable().optional(),
  toBinId: z.string().min(1).nullable().optional(),
  priority: z.number().int().min(1).max(999).default(100),
  active: z.boolean().default(true),
  notes: z.string().max(500).nullable().optional(),
});
const putawayRuleUpdate = putawayRuleCreate.partial();

const transferItemInput = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).nullable().optional(),
  qtyRequested: z.number().positive(),
  fromBinId: z.string().min(1).nullable().optional(),
  toBinId: z.string().min(1).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

const transferOrderCreate = z.object({
  kind: z.enum(["putaway", "replenishment", "manual"]).default("manual"),
  fromWarehouseId: z.string().min(1),
  toWarehouseId: z.string().min(1),
  productionOrderId: z.string().min(1).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  tags: z.string().max(500).nullable().optional(),
  items: z.array(transferItemInput).min(1),
});

// ------------------------------------------------------------------ routes

export const transfersRoutes = async (app: FastifyInstance) => {
  // ======================================================================
  // Putaway Rules
  // ======================================================================

  app.get("/putaway-rules", { preHandler: [app.authenticate] }, async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    return db.putawayRule.findMany({
      where: {
        ...(q.productId ? { productId: q.productId } : {}),
        ...(q.active === "1" ? { active: true } : {}),
        ...(q.active === "0" ? { active: false } : {}),
      },
      include: {
        product: { select: { id: true, sku: true, name: true, uom: true, barcode: true } },
        variant: { select: { id: true, sku: true, size: true, barcode: true } },
        toWarehouse: { select: { id: true, code: true, name: true, kind: true } },
        tobin: { select: { id: true, code: true, zone: true, shelf: true, bin: true } },
      },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
  });

  app.post("/putaway-rules", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireWriter(req, reply)) return;
    const body = putawayRuleCreate.parse(req.body);

    const product = await db.product.findUnique({ where: { id: body.productId } });
    if (!product) {
      return reply.code(404).send({ error: { code: "product_not_found" } });
    }
    if (body.variantId) {
      const v = await db.productVariant.findUnique({ where: { id: body.variantId } });
      if (!v || v.productId !== body.productId) {
        return reply.code(400).send({ error: { code: "variant_product_mismatch" } });
      }
    }
    const wh = await db.warehouse.findUnique({ where: { id: body.toWarehouseId } });
    if (!wh) {
      return reply.code(404).send({ error: { code: "warehouse_not_found" } });
    }
    if (body.toBinId) {
      const bin = await db.bin.findUnique({ where: { id: body.toBinId } });
      if (!bin || bin.warehouseId !== body.toWarehouseId) {
        return reply.code(400).send({
          error: { code: "bin_warehouse_mismatch", message: "Bin does not belong to the specified warehouse." },
        });
      }
    }

    const created = await db.putawayRule.create({
      data: {
        productId: body.productId,
        variantId: body.variantId ?? null,
        toWarehouseId: body.toWarehouseId,
        toZone: body.toZone ? body.toZone.trim().toUpperCase() : null,
        toBinId: body.toBinId ?? null,
        priority: body.priority,
        active: body.active,
        notes: body.notes ?? null,
      },
      include: {
        product: { select: { id: true, sku: true, name: true } },
        variant: { select: { id: true, sku: true, size: true } },
        toWarehouse: { select: { id: true, code: true, name: true } },
      },
    });
    await recordChange("PutawayRule" as never, created.id, "insert", created, req.user.sub);
    return created;
  });

  app.patch("/putaway-rules/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireWriter(req, reply)) return;
    const id = (req.params as { id: string }).id;
    const body = putawayRuleUpdate.parse(req.body);

    const existing = await db.putawayRule.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: { code: "not_found" } });

    if (body.toBinId && body.toWarehouseId) {
      const bin = await db.bin.findUnique({ where: { id: body.toBinId } });
      if (!bin || bin.warehouseId !== body.toWarehouseId) {
        return reply.code(400).send({ error: { code: "bin_warehouse_mismatch" } });
      }
    }

    const updated = await db.putawayRule.update({
      where: { id },
      data: {
        ...(body.toWarehouseId !== undefined && { toWarehouseId: body.toWarehouseId }),
        ...(body.toZone !== undefined && {
          toZone: body.toZone ? body.toZone.trim().toUpperCase() : null,
        }),
        ...(body.toBinId !== undefined && { toBinId: body.toBinId }),
        ...(body.priority !== undefined && { priority: body.priority }),
        ...(body.active !== undefined && { active: body.active }),
        ...(body.notes !== undefined && { notes: body.notes }),
      },
      include: {
        product: { select: { id: true, sku: true, name: true } },
        variant: { select: { id: true, sku: true, size: true } },
        toWarehouse: { select: { id: true, code: true, name: true } },
      },
    });
    await recordChange("PutawayRule" as never, id, "update", updated, req.user.sub);
    return updated;
  });

  app.delete("/putaway-rules/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireWriter(req, reply)) return;
    const id = (req.params as { id: string }).id;
    const existing = await db.putawayRule.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: { code: "not_found" } });
    await db.putawayRule.delete({ where: { id } });
    await recordChange("PutawayRule" as never, id, "delete", existing, req.user.sub);
    return { deleted: true };
  });

  // ======================================================================
  // Transfer Orders - CRUD
  // ======================================================================

  app.get("/transfer-orders", { preHandler: [app.authenticate] }, async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
    return db.transferOrder.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.productionOrderId ? { productionOrderId: q.productionOrderId } : {}),
        ...(q.fromWarehouseId ? { fromWarehouseId: q.fromWarehouseId } : {}),
        ...(q.toWarehouseId ? { toWarehouseId: q.toWarehouseId } : {}),
        ...(q.assignedToId ? { assignedToId: q.assignedToId } : {}),
      },
      include: toInclude,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  });

  app.get("/transfer-orders/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const to = await db.transferOrder.findUnique({ where: { id }, include: toInclude });
    if (!to) return reply.code(404).send({ error: { code: "not_found" } });
    return to;
  });

  app.post("/transfer-orders", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireWriter(req, reply)) return;
    const body = transferOrderCreate.parse(req.body);

    const [fromWh, toWh] = await Promise.all([
      db.warehouse.findUnique({ where: { id: body.fromWarehouseId } }),
      db.warehouse.findUnique({ where: { id: body.toWarehouseId } }),
    ]);
    if (!fromWh) return reply.code(404).send({ error: { code: "from_warehouse_not_found" } });
    if (!toWh) return reply.code(404).send({ error: { code: "to_warehouse_not_found" } });
    if (body.fromWarehouseId === body.toWarehouseId) {
      return reply.code(400).send({ error: { code: "same_warehouse", message: "Source and destination must differ." } });
    }

    if (body.productionOrderId) {
      const po = await db.productionOrder.findUnique({ where: { id: body.productionOrderId } });
      if (!po) return reply.code(404).send({ error: { code: "production_order_not_found" } });
    }

    const transferNo = await nextTransferNo();
    const created = await db.transferOrder.create({
      data: {
        transferNo,
        kind: body.kind,
        status: "ready",
        fromWarehouseId: body.fromWarehouseId,
        toWarehouseId: body.toWarehouseId,
        productionOrderId: body.productionOrderId ?? null,
        notes: body.notes ?? null,
        tags: body.tags ?? null,
        items: {
          create: body.items.map((it) => ({
            productId: it.productId,
            variantId: it.variantId ?? null,
            qtyRequested: it.qtyRequested,
            fromBinId: it.fromBinId ?? null,
            toBinId: it.toBinId ?? null,
            notes: it.notes ?? null,
          })),
        },
      },
      include: toInclude,
    });
    await recordChange("TransferOrder" as never, created.id, "insert", created, req.user.sub);
    return created;
  });

  app.post("/transfer-orders/:id/cancel", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireWriter(req, reply)) return;
    const id = (req.params as { id: string }).id;
    const to = await db.transferOrder.findUnique({ where: { id }, include: { items: true } });
    if (!to) return reply.code(404).send({ error: { code: "not_found" } });
    if (to.status === "done" || to.status === "cancelled") {
      return reply.code(409).send({
        error: { code: "invalid_status", message: `Cannot cancel a ${to.status} transfer order.` },
      });
    }

    // If already picked (in_transit), reverse the stock move.
    if (to.status === "in_transit") {
      await db.$transaction(async (tx) => {
        for (const item of to.items) {
          if (item.qtyPicked <= 0) continue;
          // Restore source bin.
          if (item.fromBinId) {
            await tx.bin.update({
              where: { id: item.fromBinId },
              data: { qty: { increment: item.qtyPicked } },
            });
          }
          // Release destination reservation.
          if (item.toBinId) {
            await tx.bin.update({
              where: { id: item.toBinId },
              data: { reservedQty: { decrement: item.qtyPicked } },
            });
          }
          // Reversal ledger row.
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
          // SOH rollback. TransferOrderItem carries variantId when the
          // moved SKU is a variant — return the qty to the variant
          // counter so a variant transfer that's cancelled mid-flight
          // doesn't leak units onto the parent counter.
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
      });
    }

    const updated = await db.transferOrder.update({
      where: { id },
      data: { status: "cancelled", cancelledAt: new Date() },
      include: toInclude,
    });
    await recordChange("TransferOrder" as never, id, "update", updated, req.user.sub);
    return updated;
  });

  // ======================================================================
  // Admin controls - workers list / assign / manual status override
  // ======================================================================

  // GET /transfer-orders/workers
  // Lightweight list of users that can be assigned to a transfer.
  // Restricted to admin + supervisor so it can populate the assignment
  // dropdown on the desktop ERP without exposing the full /users API.
  app.get(
    "/transfer-orders/workers",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdminOrSupervisor(req, reply)) return;
      const users = await db.user.findMany({
        where: {
          active: true,
          role: { in: ASSIGNABLE_ROLES as unknown as string[] },
        },
        select: { id: true, username: true, name: true, role: true },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      });
      return users;
    }
  );

  // POST /transfer-orders/:id/assign
  // Admin / supervisor assigns the TO to a specific user (or clears the
  // assignment by passing assignedToId: null). Differs from /claim which
  // only lets the calling worker self-assign.
  app.post(
    "/transfer-orders/:id/assign",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdminOrSupervisor(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const body = z
        .object({
          assignedToId: z.string().min(1).nullable(),
          note: z.string().max(500).nullable().optional(),
        })
        .parse(req.body);

      const to = await db.transferOrder.findUnique({ where: { id } });
      if (!to) return reply.code(404).send({ error: { code: "not_found" } });
      if (to.status === "done" || to.status === "cancelled") {
        return reply.code(409).send({
          error: {
            code: "invalid_status",
            message: `Cannot reassign a ${to.status} transfer order.`,
          },
        });
      }

      if (body.assignedToId) {
        const target = await db.user.findUnique({
          where: { id: body.assignedToId },
          select: { id: true, active: true, role: true, name: true },
        });
        if (!target) {
          return reply.code(404).send({ error: { code: "user_not_found" } });
        }
        if (!target.active) {
          return reply.code(400).send({
            error: { code: "user_inactive", message: "Selected user is deactivated." },
          });
        }
        if (!(ASSIGNABLE_ROLES as readonly string[]).includes(target.role)) {
          return reply.code(400).send({
            error: {
              code: "role_not_assignable",
              message: `Users with role '${target.role}' cannot be assigned transfer orders.`,
            },
          });
        }
      }

      // Append an audit line to notes so the assignment trail is visible
      // alongside the existing free-form notes column.
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      const assignedLabel = body.assignedToId
        ? `assigned to user ${body.assignedToId}`
        : "unassigned";
      const auditLine = `[${stamp}] ${req.user.sub} ${assignedLabel}${
        body.note?.trim() ? ` — ${body.note.trim()}` : ""
      }`;
      const newNotes = to.notes ? `${to.notes}\n${auditLine}` : auditLine;

      const updated = await db.transferOrder.update({
        where: { id },
        data: {
          assignedToId: body.assignedToId,
          // Stamp claimedAt on first assignment, clear when unassigning.
          claimedAt: body.assignedToId ? to.claimedAt ?? new Date() : null,
          notes: newNotes,
        },
        include: toInclude,
      });
      await recordChange("TransferOrder" as never, id, "update", updated, req.user.sub);
      return updated;
    }
  );

  // POST /transfer-orders/:id/status
  // Manual admin status override ("backup" path used when the normal
  // pick/drop flow can't be completed - e.g. a stuck TO after a mobile
  // device crash). Pure metadata change: this endpoint deliberately
  // does NOT move any stock. Use /pick, /drop, or /cancel for flows
  // that should reverse or write ledger entries.
  app.post(
    "/transfer-orders/:id/status",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdminOrSupervisor(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const body = z
        .object({
          status: z.enum(TO_STATUSES),
          reason: z.string().min(3).max(500),
        })
        .parse(req.body);

      const to = await db.transferOrder.findUnique({ where: { id } });
      if (!to) return reply.code(404).send({ error: { code: "not_found" } });
      if (to.status === body.status) {
        return reply.code(400).send({
          error: { code: "no_change", message: `Status is already ${body.status}.` },
        });
      }

      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      const auditLine = `[${stamp}] ${req.user.sub} manually set status: ${to.status} → ${body.status} — ${body.reason.trim()}`;
      const newNotes = to.notes ? `${to.notes}\n${auditLine}` : auditLine;

      // Tidy up the timestamp columns to keep the meta strip readable
      // even though we're not touching stock.
      const data: Record<string, unknown> = {
        status: body.status,
        notes: newNotes,
      };
      if (body.status === "done") {
        data.droppedAt = to.droppedAt ?? new Date();
        data.droppedById = to.droppedById ?? req.user.sub;
      } else if (body.status === "cancelled") {
        data.cancelledAt = to.cancelledAt ?? new Date();
      } else if (body.status === "in_transit") {
        data.pickedAt = to.pickedAt ?? new Date();
        data.pickedById = to.pickedById ?? req.user.sub;
      }

      const updated = await db.transferOrder.update({
        where: { id },
        data,
        include: toInclude,
      });
      await recordChange("TransferOrder" as never, id, "update", updated, req.user.sub);
      return updated;
    }
  );

  // ======================================================================
  // Transfer Order lifecycle - claim / pick / drop
  // ======================================================================

  // POST /transfer-orders/:id/claim
  // Mobile worker self-assigns the TO.
  app.post("/transfer-orders/:id/claim", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const to = await db.transferOrder.findUnique({ where: { id } });
    if (!to) return reply.code(404).send({ error: { code: "not_found" } });
    if (to.status !== "ready") {
      return reply.code(409).send({
        error: { code: "not_claimable", message: `TO is ${to.status}, only ready TOs can be claimed.` },
      });
    }
    if (to.assignedToId && to.assignedToId !== req.user.sub) {
      return reply.code(409).send({
        error: { code: "already_claimed", message: "This TO is already claimed by another worker." },
      });
    }
    const updated = await db.transferOrder.update({
      where: { id },
      data: { assignedToId: req.user.sub, claimedAt: new Date() },
      include: toInclude,
    });
    await recordChange("TransferOrder" as never, id, "update", updated, req.user.sub);
    return updated;
  });

  // POST /transfer-orders/:id/release
  // Worker releases their claim so another worker can pick up the TO.
  // Only the current assignee, or an admin/supervisor, can release.
  // Permitted while the TO is still 'ready' (pre-pick) - once picking
  // has started the TO is in_transit and is owned by the picker until
  // drop or cancel.
  app.post(
    "/transfer-orders/:id/release",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const to = await db.transferOrder.findUnique({ where: { id } });
      if (!to) return reply.code(404).send({ error: { code: "not_found" } });
      if (to.status !== "ready") {
        return reply.code(409).send({
          error: {
            code: "invalid_status",
            message: `TO is ${to.status}; only ready TOs can be released.`,
          },
        });
      }
      if (!to.assignedToId) {
        return reply.code(409).send({
          error: {
            code: "not_claimed",
            message: "Nothing to release - this TO is not currently claimed.",
          },
        });
      }
      const isOwner = to.assignedToId === req.user.sub;
      const isAdmin = req.user.role === "admin" || req.user.role === "supervisor";
      if (!isOwner && !isAdmin) {
        return reply.code(403).send({
          error: {
            code: "forbidden",
            message: "Only the assignee or a supervisor can release this TO.",
          },
        });
      }
      const updated = await db.transferOrder.update({
        where: { id },
        data: { assignedToId: null, claimedAt: null },
        include: toInclude,
      });
      await recordChange("TransferOrder" as never, id, "update", updated, req.user.sub);
      return updated;
    }
  );

  // POST /transfer-orders/:id/resolve-source-bins
  // Re-runs source-bin discovery for every item whose fromBinId is
  // still null. Use case: the TO was created before any stock landed
  // in the source warehouse; stock has since been adjusted in and the
  // worker wants the system to re-pick the source slot rather than
  // bouncing the TO back to a supervisor.
  //
  // Picks the bin in the source warehouse that holds the product
  // (matching variant when applicable) with sufficient remaining qty
  // (qtyRequested - qtyPicked). When several bins qualify, prefers the
  // smallest qty that covers the need so larger holdings are kept
  // intact for future picks.
  app.post(
    "/transfer-orders/:id/resolve-source-bins",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const to = await db.transferOrder.findUnique({
        where: { id },
        include: {
          items: {
            include: { product: { select: { sku: true } } },
          },
        },
      });
      if (!to) return reply.code(404).send({ error: { code: "not_found" } });
      if (to.status !== "ready") {
        return reply.code(409).send({
          error: {
            code: "invalid_status",
            message: `Source bins can only be resolved while the TO is ready (currently ${to.status}).`,
          },
        });
      }

      const updates: Array<{
        itemId: string;
        sku: string;
        binCode: string;
        qtyAvailable: number;
      }> = [];
      const stillMissing: Array<{ itemId: string; sku: string; needed: number }> = [];

      for (const item of to.items) {
        if (item.fromBinId) continue;
        const needed = Math.max(0, item.qtyRequested - item.qtyPicked);
        if (needed <= 0) continue;

        // Find candidate bins in the source warehouse that hold the
        // product / variant with enough qty. Order: smallest qty
        // covering the need first (consolidate), else largest.
        const variantClause = item.variantId
          ? { variantId: item.variantId }
          : { variantId: null };
        const candidate =
          (await db.bin.findFirst({
            where: {
              warehouseId: to.fromWarehouseId,
              productId: item.productId,
              ...variantClause,
              qty: { gte: needed },
            },
            orderBy: { qty: "asc" },
          })) ??
          (await db.bin.findFirst({
            where: {
              warehouseId: to.fromWarehouseId,
              productId: item.productId,
              ...variantClause,
              qty: { gt: 0 },
            },
            orderBy: { qty: "desc" },
          }));

        if (!candidate) {
          stillMissing.push({ itemId: item.id, sku: item.product.sku, needed });
          continue;
        }

        await db.transferOrderItem.update({
          where: { id: item.id },
          data: { fromBinId: candidate.id },
        });
        updates.push({
          itemId: item.id,
          sku: item.product.sku,
          binCode: candidate.code ?? `${candidate.zone}/${candidate.shelf}/${candidate.bin}`,
          qtyAvailable: candidate.qty,
        });
      }

      const refreshed = await db.transferOrder.findUnique({
        where: { id },
        include: toInclude,
      });
      await recordChange("TransferOrder" as never, id, "update", refreshed, req.user.sub);
      return {
        transferOrder: refreshed,
        resolved: updates,
        stillMissing,
      };
    }
  );

  // POST /transfer-orders/:id/pick
  // Worker confirms picking items from source bins.
  // Body: { lines: [{ itemId, qtyPicked, fromBinId }] }
  app.post("/transfer-orders/:id/pick", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = z.object({
      lines: z.array(z.object({
        itemId: z.string().min(1),
        qtyPicked: z.number().nonnegative(),
        fromBinId: z.string().min(1),
      })).min(1),
    }).parse(req.body);

    const to = await db.transferOrder.findUnique({ where: { id }, include: { items: true } });
    if (!to) return reply.code(404).send({ error: { code: "not_found" } });
    if (to.status !== "ready") {
      return reply.code(409).send({
        error: { code: "invalid_status", message: `TO must be in 'ready' state to pick (currently ${to.status}).` },
      });
    }

    const updated = await db.$transaction(async (tx) => {
      for (const line of body.lines) {
        const item = to.items.find((i) => i.id === line.itemId);
        if (!item) continue;
        if (line.qtyPicked <= 0) continue;

        const srcBin = await tx.bin.findUnique({ where: { id: line.fromBinId } });
        if (!srcBin || srcBin.qty < line.qtyPicked) {
          throw Object.assign(
            new Error(`Insufficient stock in source bin for ${item.productId} (available: ${srcBin?.qty ?? 0}, requested: ${line.qtyPicked})`),
            { statusCode: 409, code: "insufficient_stock_at_source" }
          );
        }

        // Decrement source bin.
        await tx.bin.update({
          where: { id: line.fromBinId },
          data: { qty: { decrement: line.qtyPicked } },
        });

        // Reserve destination bin if known (from putaway rule or TO creation).
        if (item.toBinId) {
          await tx.bin.update({
            where: { id: item.toBinId },
            data: { reservedQty: { increment: line.qtyPicked } },
          });
        }

        // StockLedger out row.
        await tx.stockLedger.create({
          data: {
            productId: item.productId,
            variantId: item.variantId,
            warehouseId: to.fromWarehouseId,
            bin: `${srcBin.zone}/${srcBin.shelf}/${srcBin.bin}`,
            txnType: "Transfer",
            ref: to.transferNo,
            qty: -line.qtyPicked,
            balance: srcBin.qty - line.qtyPicked,
            date: new Date(),
          },
        });

        // SOH decrement. Variant-scoped items deduct from the variant
        // counter; parent-scoped fall through to the parent. Routing
        // is consistent with /inventory/adjust and the dispatch path.
        if (item.variantId) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stockOnHand: { decrement: line.qtyPicked } },
          });
        } else {
          await tx.product.update({
            where: { id: item.productId },
            data: { stockOnHand: { decrement: line.qtyPicked } },
          });
        }

        await tx.transferOrderItem.update({
          where: { id: line.itemId },
          data: { qtyPicked: line.qtyPicked, fromBinId: line.fromBinId },
        });
      }

      return tx.transferOrder.update({
        where: { id },
        data: {
          status: "in_transit",
          pickedById: req.user.sub,
          pickedAt: new Date(),
        },
        include: toInclude,
      });
    }).catch((e: unknown) => {
      const err = e as Error & { statusCode?: number; code?: string };
      reply.code(err.statusCode ?? 500).send({
        error: { code: err.code ?? "internal", message: err.message },
      });
      return null;
    });

    if (!updated) return;
    await recordChange("TransferOrder" as never, id, "update", updated, req.user.sub);
    for (const line of body.lines) {
      if (line.fromBinId) {
        await checkStockRules(line.fromBinId, req.user.sub);
      }
    }
    return updated;
  });

  // POST /transfer-orders/:id/drop
  // Worker confirms dropping items at destination bins.
  // Body: { lines: [{ itemId, qtyDropped, toBinId? }] }
  //
  // `toBinId` is now optional. When omitted, the server auto-picks a bin
  // in the destination warehouse using this priority:
  //   1. The bin that was reserved for the line on /pick (item.toBinId)
  //   2. An existing bin that already holds the same product (consolidate)
  //   3. The least-occupied empty bin (productId IS NULL, qty = 0)
  //   4. Auto-create warehouse-level row when no layout exists (displayed as warehouse name only)
  // If the destination warehouse has zero bins, a warehouse-level slot is
  // created automatically — bins are not required upfront.
  app.post("/transfer-orders/:id/drop", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = z.object({
      lines: z.array(z.object({
        itemId: z.string().min(1),
        qtyDropped: z.number().nonnegative(),
        toBinId: z.string().min(1).nullable().optional(),
      })).min(1),
    }).parse(req.body);

    const to = await db.transferOrder.findUnique({
      where: { id },
      include: {
        items: { include: { product: { select: { id: true, sku: true } } } },
        toWarehouse: { select: { id: true, code: true, name: true, scanPrefix: true } },
      },
    });
    if (!to) return reply.code(404).send({ error: { code: "not_found" } });
    if (to.status !== "in_transit") {
      return reply.code(409).send({
        error: { code: "invalid_status", message: `TO must be 'in_transit' to drop (currently ${to.status}).` },
      });
    }

    // Pre-resolve destination bins for every line (including auto-pick).
    type Resolved = { itemId: string; qtyDropped: number; toBinId: string };
    const resolved: Resolved[] = [];
    for (const line of body.lines) {
      const item = to.items.find((i) => i.id === line.itemId);
      if (!item || line.qtyDropped <= 0) continue;

      let toBinId = line.toBinId ?? item.toBinId ?? null;

      if (toBinId) {
        const supplied = await db.bin.findFirst({
          where: { id: toBinId, warehouseId: to.toWarehouseId },
          include: { product: { select: { sku: true } } },
        });
        if (!supplied) {
          return reply.code(400).send({
            error: {
              code: "bin_warehouse_mismatch",
              message: `Bin ${toBinId} does not belong to destination warehouse ${to.toWarehouse.code}.`,
            },
          });
        }
        if (
          supplied.productId &&
          supplied.productId !== item.productId &&
          supplied.qty > 0
        ) {
          return reply.code(409).send({
            error: {
              code: "bin_product_mismatch",
              message:
                `Bin ${supplied.zone}/${supplied.shelf}/${supplied.bin} holds ${supplied.product?.sku ?? "another product"}. ` +
                `Choose an empty bin or a bin that already holds ${item.product.sku}.`,
            },
          });
        }
      } else {
        const picked = await resolveReceiveBinForProduct(
          db,
          to.toWarehouse,
          item.productId,
          item.product.sku,
          { variantId: item.variantId ?? null }
        );
        toBinId = picked.id;
      }
      resolved.push({ itemId: item.id, qtyDropped: line.qtyDropped, toBinId });
    }

    if (resolved.length === 0) {
      return reply.code(400).send({
        error: { code: "no_lines", message: "No lines to drop." },
      });
    }

    const updated = await db.$transaction(async (tx) => {
      for (const line of resolved) {
        const item = to.items.find((i) => i.id === line.itemId);
        if (!item) continue;

        const dstBin = await tx.bin.findUnique({ where: { id: line.toBinId } });
        if (!dstBin) {
          throw Object.assign(new Error(`Destination bin ${line.toBinId} not found.`), { statusCode: 404, code: "bin_not_found" });
        }

        // Release reservation if we previously reserved this bin.
        const prevToBinId = item.toBinId;
        if (prevToBinId) {
          const reservedRelease = Math.min(item.qtyPicked, line.qtyDropped);
          await tx.bin.update({
            where: { id: prevToBinId },
            data: { reservedQty: { decrement: reservedRelease } },
          });
        }

        // Increment destination bin. Tag with variantId when the moved
        // SKU is a variant so the destination bin's level matches the
        // source — without this, transferring "BAJF-1KG-01" into a
        // fresh bin would leave the bin tagged at parent level only,
        // re-introducing the leak we just fixed for the source side.
        await tx.bin.update({
          where: { id: line.toBinId },
          data: {
            qty: { increment: line.qtyDropped },
            productId: item.productId,
            variantId: item.variantId ?? null,
          },
        });

        // StockLedger in row.
        await tx.stockLedger.create({
          data: {
            productId: item.productId,
            variantId: item.variantId,
            warehouseId: to.toWarehouseId,
            bin: `${dstBin.zone}/${dstBin.shelf}/${dstBin.bin}`,
            txnType: "Transfer",
            ref: to.transferNo,
            qty: line.qtyDropped,
            balance: dstBin.qty + line.qtyDropped,
            date: new Date(),
          },
        });

        // SOH increment, variant-aware (mirrors the pick decrement).
        if (item.variantId) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stockOnHand: { increment: line.qtyDropped } },
          });
        } else {
          await tx.product.update({
            where: { id: item.productId },
            data: { stockOnHand: { increment: line.qtyDropped } },
          });
        }

        await tx.transferOrderItem.update({
          where: { id: line.itemId },
          data: { qtyDropped: line.qtyDropped, toBinId: line.toBinId },
        });
      }

      return tx.transferOrder.update({
        where: { id },
        data: {
          status: "done",
          droppedById: req.user.sub,
          droppedAt: new Date(),
        },
        include: toInclude,
      });
    }).catch((e: unknown) => {
      const err = e as Error & { statusCode?: number; code?: string };
      reply.code(err.statusCode ?? 500).send({
        error: { code: err.code ?? "internal", message: err.message },
      });
      return null;
    });

    if (!updated) return;
    await recordChange("TransferOrder" as never, id, "update", updated, req.user.sub);
    // Use the resolved (auto-picked or supplied) bin ids — body.lines may
    // have left toBinId blank, and TS now narrows the type for us.
    for (const line of resolved) {
      await checkStockRules(line.toBinId, req.user.sub);
    }
    return updated;
  });
};
