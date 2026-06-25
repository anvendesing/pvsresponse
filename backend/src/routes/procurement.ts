// Procurement: vendors, purchase orders, GRN (goods-receipt-note).
//
// Lifecycle of a PO:
//   draft     - just created, vendor + lines locked but editable
//   approved  - released to vendor (read-only items; only notes editable)
//   partial   - one or more GRNs posted but not all lines fully received
//   received  - sum(item.received) == sum(item.qty) for every line
//   closed    - manually closed (e.g. short-shipped, written off)
//   cancelled - voided before any GRN; cannot be cancelled after partial
//
// GRN flow:
//   * GrnItem rows are the source of truth for "what came in".
//   * On every GRN write, PurchaseOrderItem.received is recomputed
//     from sum(grnItems.receivedQty - grnItems.rejectedQty) so the
//     PO snapshot stays consistent if a later GRN is voided.
//   * Inventory is posted into bins + StockLot rows; ledger rows
//     include batch for FIFO traceability.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { recordChange } from "../sync/log.js";
import { resolveBatchNo } from "../lib/stock-lots.js";
import { getGrnReceiveHints, receiveGrnLineStock } from "../lib/grn-receive.js";
import { nextPoNo, resolvePoLine, type ResolvedPoLine } from "../lib/po-lines.js";
import {
  computeVendorPerformance,
  syncVendorRatingFromPerformance,
} from "../lib/vendor-performance.js";
import { getPoClosePreview } from "../lib/product-supply-outlook.js";
import { scheduleStockRulesCheck } from "../lib/stock-rules-runner.js";

// ---- Vendors ----------------------------------------------------

const vendorCreate = z.object({
  // Code is auto-generated server-side (VEND-NNNN) so callers omit it.
  // Operators may override only when migrating existing data.
  code: z.string().min(1).max(40).optional(),
  name: z.string().min(1).max(200),
  gst: z.string().min(0).max(20).default(""),
  contact: z.string().min(0).max(60).default(""),
  email: z.string().email().nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  city: z.string().min(0).max(80).default(""),
  rating: z.number().min(0).max(5).default(0),
  leadTimeDays: z.number().int().nonnegative().default(7),
  paymentTerms: z.string().max(100).nullable().optional(),
  active: z.boolean().default(true),
});

const vendorUpdate = vendorCreate.partial();

const nextVendorCode = async (): Promise<string> => {
  const last = await db.vendor.findFirst({
    where: { code: { startsWith: "VEND-" } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const n = last ? parseInt(last.code.split("-").pop() ?? "0", 10) + 1 : 1;
  return `VEND-${String(n).padStart(4, "0")}`;
};

// ---- Purchase orders ---------------------------------------------

const poItemInput = z.object({
  productId: z.string().min(1),
  qty: z.number().positive().optional(),
  rate: z.number().nonnegative().optional(),
  vendorProductId: z.string().optional(),
  vendorQty: z.number().positive().optional(),
  vendorRate: z.number().nonnegative().optional(),
});

const poCreate = z.object({
  vendorId: z.string().min(1),
  expectedDate: z.string().min(1),
  notes: z.string().max(2000).nullable().optional(),
  items: z.array(poItemInput).min(1),
});

const poUpdate = z.object({
  expectedDate: z.string().min(1).optional(),
  notes: z.string().max(2000).nullable().optional(),
  // Item replacement is allowed only while the PO is still 'draft' -
  // approved POs are immutable to keep the audit trail clean.
  items: z.array(poItemInput).optional(),
});

// ---- GRN ---------------------------------------------------------

const grnLineInput = z.object({
  poItemId: z.string().min(1),
  receivedQty: z.number().nonnegative(),
  rejectedQty: z.number().nonnegative().default(0),
  remarks: z.string().max(500).nullable().optional(),
  batchNo: z.string().max(60).nullable().optional(),
  expiryDate: z.string().max(30).nullable().optional(),
  /** Split accepted qty across bins. Must sum to receivedQty − rejectedQty. */
  allocations: z
    .array(
      z.object({
        binId: z.string().min(1),
        qty: z.number().positive(),
      })
    )
    .optional(),
});

const grnCreate = z.object({
  poId: z.string().min(1),
  qcStatus: z.enum(["pending", "pass", "rework", "reject"]).default("pending"),
  truckNo: z.string().max(40).nullable().optional(),
  driver: z.string().max(80).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  // At least one line; line-level rejectedQty + receivedQty drive
  // both inventory posting and PO.received roll-up.
  items: z.array(grnLineInput).min(1),
});

const nextGrnNo = async (): Promise<string> => {
  const last = await db.grn.findFirst({
    where: { grnNo: { startsWith: "GRN-" } },
    orderBy: { grnNo: "desc" },
    select: { grnNo: true },
  });
  const n = last ? parseInt(last.grnNo.split("-").pop() ?? "1140", 10) + 1 : 1141;
  return `GRN-${String(n).padStart(4, "0")}`;
};

const vendorProductCreate = z.object({
  productId: z.string().min(1),
  variantId: z.string().nullable().optional(),
  vendorProductCode: z.string().max(80).nullable().optional(),
  vendorProductName: z.string().max(200).nullable().optional(),
  vendorUom: z.string().min(1).max(40),
  packSize: z.number().positive().default(1),
  price: z.number().nonnegative().default(0),
  minOrderQty: z.number().positive().default(1),
  leadTimeDays: z.number().int().nonnegative().nullable().optional(),
  priority: z.number().int().default(100),
  active: z.boolean().default(true),
  notes: z.string().max(500).nullable().optional(),
});

const vendorProductUpdate = vendorProductCreate.partial();

const vendorProductInclude = {
  product: { select: { id: true, sku: true, name: true, uom: true, type: true } },
  variant: { select: { id: true, sku: true, size: true, color: true } },
} as const;

// Recompute PurchaseOrderItem.received from its GrnItems. Each line's
// received is sum(receivedQty) - sum(rejectedQty). We also recompute
// the PO header status and receivedPct here so callers don't have to.
const recomputePoStatus = async (poId: string, userId: string) => {
  const po = await db.purchaseOrder.findUnique({
    where: { id: poId },
    include: {
      items: { include: { grnItems: true } },
    },
  });
  if (!po) return null;
  let totalQty = 0;
  let totalReceived = 0;
  for (const item of po.items) {
    const received = item.grnItems.reduce(
      (s, g) => s + g.receivedQty - g.rejectedQty,
      0
    );
    if (received !== item.received) {
      await db.purchaseOrderItem.update({
        where: { id: item.id },
        data: { received },
      });
    }
    totalQty += item.qty;
    totalReceived += received;
  }
  const pct = totalQty > 0 ? Math.min(100, Math.round((totalReceived / totalQty) * 100)) : 0;
  // Don't downgrade a manually 'closed' or 'cancelled' PO.
  let nextStatus = po.status;
  if (po.status !== "closed" && po.status !== "cancelled") {
    if (totalReceived >= totalQty - 0.0001 && totalQty > 0) {
      nextStatus = "received";
    } else if (totalReceived > 0) {
      nextStatus = "partial";
    } else if (po.status === "partial" || po.status === "received") {
      // No GRNs left - revert to approved (or draft if never approved).
      nextStatus = "approved";
    }
  }
  if (nextStatus !== po.status || pct !== po.receivedPct) {
    const updated = await db.purchaseOrder.update({
      where: { id: poId },
      data: { status: nextStatus, receivedPct: pct },
    });
    await recordChange("PurchaseOrder", poId, "update", updated, userId);
    return updated;
  }
  return po;
};

// ----------------------------------------------------------------
// Routes

export const procurementRoutes = async (app: FastifyInstance) => {
  // ============= Vendors =============

  app.get("/vendors", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const where: Record<string, unknown> = {};
    if (q.includeInactive !== "1") where.active = true;
    if (q.search) {
      where.OR = [
        { name: { contains: q.search } },
        { code: { contains: q.search } },
        { city: { contains: q.search } },
        { gst: { contains: q.search } },
      ];
    }
    const vendors = await db.vendor.findMany({
      where,
      orderBy: { name: "asc" },
      include: {
        _count: { select: { pos: true } },
      },
    });
    // Decorate with rolled-up "outstandingPO" and "totalSpend" so the
    // listing UI can render KPIs without N+1 fetches.
    return Promise.all(
      vendors.map(async (v) => {
        const open = await db.purchaseOrder.count({
          where: {
            vendorId: v.id,
            status: { in: ["draft", "approved", "partial"] },
          },
        });
        const spendAgg = await db.purchaseOrder.aggregate({
          _sum: { amount: true },
          where: { vendorId: v.id, status: { not: "cancelled" } },
        });
        return {
          ...v,
          outstandingPO: open,
          totalSpend: spendAgg._sum.amount ?? 0,
        };
      })
    );
  });

  app.get("/vendors/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const v = await db.vendor.findUnique({ where: { id } });
    if (!v) return reply.code(404).send({ error: { code: "not_found" } });
    return v;
  });

  app.post("/vendors", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = vendorCreate.parse(req.body);
    const code = body.code ?? (await nextVendorCode());
    const dup = await db.vendor.findUnique({ where: { code } });
    if (dup) {
      return reply.code(409).send({
        error: { code: "duplicate_code", message: `Vendor "${code}" already exists.` },
      });
    }
    const created = await db.vendor.create({
      data: { ...body, code },
    });
    await recordChange("Vendor", created.id, "insert", created, req.user.sub);
    return created;
  });

  app.patch("/vendors/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = vendorUpdate.parse(req.body);
    const before = await db.vendor.findUnique({ where: { id } });
    if (!before) return reply.code(404).send({ error: { code: "not_found" } });
    if (body.code && body.code !== before.code) {
      const dup = await db.vendor.findUnique({ where: { code: body.code } });
      if (dup) {
        return reply.code(409).send({
          error: { code: "duplicate_code", message: `Vendor "${body.code}" already exists.` },
        });
      }
    }
    const updated = await db.vendor.update({ where: { id }, data: body });
    await recordChange("Vendor", id, "update", updated, req.user.sub);
    return updated;
  });

  // Soft-delete when the vendor has POs (preserves history); hard
  // delete is only allowed when the vendor is unused.
  app.delete(
    "/vendors/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const before = await db.vendor.findUnique({ where: { id } });
      if (!before) return reply.code(404).send({ error: { code: "not_found" } });
      const poCount = await db.purchaseOrder.count({ where: { vendorId: id } });
      if (poCount > 0) {
        const updated = await db.vendor.update({
          where: { id },
          data: { active: false },
        });
        await recordChange("Vendor", id, "update", updated, req.user.sub);
        return reply.send({
          softDeleted: true,
          message: `Vendor has ${poCount} PO${poCount === 1 ? "" : "s"} - marked inactive instead of deleted.`,
          vendor: updated,
        });
      }
      await db.vendor.delete({ where: { id } });
      await recordChange("Vendor", id, "delete", { id }, req.user.sub);
      return reply.send({ deleted: true });
    }
  );

  // ============= Vendor supplier catalog =============

  app.get("/vendors/:id/products", async (req, reply) => {
    const vendorId = (req.params as { id: string }).id;
    const vendor = await db.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) return reply.code(404).send({ error: { code: "not_found" } });
    const q = (req.query as Record<string, string>) ?? {};
    return db.vendorProduct.findMany({
      where: {
        vendorId,
        ...(q.active === "1" ? { active: true } : {}),
        ...(q.productId ? { productId: q.productId } : {}),
      },
      include: vendorProductInclude,
      orderBy: [{ priority: "asc" }, { product: { sku: "asc" } }],
    });
  });

  app.post(
    "/vendors/:id/products",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const vendorId = (req.params as { id: string }).id;
      const body = vendorProductCreate.parse(req.body);
      const vendor = await db.vendor.findUnique({ where: { id: vendorId } });
      if (!vendor) return reply.code(404).send({ error: { code: "not_found" } });
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
      const created = await db.vendorProduct.create({
        data: { ...body, vendorId, variantId: body.variantId ?? null },
        include: vendorProductInclude,
      });
      await recordChange("VendorProduct", created.id, "insert", created, req.user.sub);
      return created;
    }
  );

  app.patch(
    "/vendors/:vendorId/products/:lineId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { vendorId, lineId } = req.params as { vendorId: string; lineId: string };
      const body = vendorProductUpdate.parse(req.body);
      const existing = await db.vendorProduct.findFirst({
        where: { id: lineId, vendorId },
      });
      if (!existing) return reply.code(404).send({ error: { code: "not_found" } });
      const updated = await db.vendorProduct.update({
        where: { id: lineId },
        data: body,
        include: vendorProductInclude,
      });
      await recordChange("VendorProduct", lineId, "update", updated, req.user.sub);
      return updated;
    }
  );

  app.delete(
    "/vendors/:vendorId/products/:lineId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { vendorId, lineId } = req.params as { vendorId: string; lineId: string };
      const existing = await db.vendorProduct.findFirst({
        where: { id: lineId, vendorId },
      });
      if (!existing) return reply.code(404).send({ error: { code: "not_found" } });
      const used = await db.purchaseOrderItem.count({ where: { vendorProductId: lineId } });
      if (used > 0) {
        const updated = await db.vendorProduct.update({
          where: { id: lineId },
          data: { active: false },
        });
        return { softDeleted: true, line: updated };
      }
      await db.vendorProduct.delete({ where: { id: lineId } });
      await recordChange("VendorProduct", lineId, "delete", existing, req.user.sub);
      return { deleted: true };
    }
  );

  app.get("/vendors/:id/performance", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const vendor = await db.vendor.findUnique({ where: { id } });
    if (!vendor) return reply.code(404).send({ error: { code: "not_found" } });
    const days = Number((req.query as Record<string, string>)?.days ?? "365");
    return computeVendorPerformance(id, Number.isFinite(days) ? days : 365);
  });

  app.post(
    "/vendors/:id/sync-rating",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const vendor = await db.vendor.findUnique({ where: { id } });
      if (!vendor) return reply.code(404).send({ error: { code: "not_found" } });
      return syncVendorRatingFromPerformance(id);
    }
  );

  // ============= Purchase orders =============

  const poInclude = {
    vendor: {
      select: {
        id: true,
        code: true,
        name: true,
        city: true,
        contact: true,
        email: true,
      },
    },
    items: {
      include: {
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            uom: true,
            hsn: true,
            type: true,
            batchTracked: true,
          },
        },
        vendorProduct: {
          select: {
            id: true,
            vendorProductCode: true,
            vendorProductName: true,
            vendorUom: true,
            packSize: true,
          },
        },
      },
    },
    grns: { orderBy: { date: "desc" as const } },
  };

  app.get("/purchase-orders", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const where: Record<string, unknown> = {};
    if (q.status) where.status = q.status;
    if (q.vendorId) where.vendorId = q.vendorId;
    if (q.search) {
      where.OR = [
        { poNo: { contains: q.search } },
        { vendor: { name: { contains: q.search } } },
      ];
    }
    return db.purchaseOrder.findMany({
      where,
      include: poInclude,
      orderBy: { date: "desc" },
    });
  });

  app.get("/purchase-orders/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const po = await db.purchaseOrder.findUnique({
      where: { id },
      include: {
        ...poInclude,
        grns: {
          orderBy: { date: "desc" },
          include: {
            items: {
              include: {
                poItem: {
                  include: {
                    product: { select: { sku: true, name: true, uom: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!po) return reply.code(404).send({ error: { code: "not_found" } });
    return po;
  });

  app.post("/purchase-orders", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = poCreate.parse(req.body);
    const vendor = await db.vendor.findUnique({ where: { id: body.vendorId } });
    if (!vendor) {
      return reply.code(404).send({ error: { code: "vendor_not_found" } });
    }
    // Reject duplicate productIds in the same PO. Operators sometimes
    // hit "add line" twice instead of incrementing qty - merge them
    // is the right answer but we surface the issue first so they see
    // it explicitly.
    const seen = new Set<string>();
    const resolvedLines: ResolvedPoLine[] = [];
    for (const it of body.items) {
      try {
        const line = await resolvePoLine(it, body.vendorId);
        if (seen.has(line.productId)) {
          return reply.code(400).send({
            error: { code: "duplicate_line", productId: line.productId },
          });
        }
        seen.add(line.productId);
        resolvedLines.push(line);
      } catch (e) {
        return reply.code(400).send({
          error: { code: "invalid_line", message: (e as Error).message },
        });
      }
    }
    const total = resolvedLines.reduce((s, i) => s + i.amount, 0);
    const poNo = await nextPoNo();
    const po = await db.purchaseOrder.create({
      data: {
        poNo,
        vendorId: body.vendorId,
        date: new Date(),
        expectedDate: new Date(body.expectedDate),
        amount: total,
        status: "draft",
        notes: body.notes ?? null,
        items: { create: resolvedLines },
      },
      include: poInclude,
    });
    await recordChange("PurchaseOrder", po.id, "insert", po, req.user.sub);
    return po;
  });

  app.patch(
    "/purchase-orders/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const body = poUpdate.parse(req.body);
      const before = await db.purchaseOrder.findUnique({ where: { id } });
      if (!before) return reply.code(404).send({ error: { code: "not_found" } });
      // Item replacement is restricted to drafts.
      if (body.items && before.status !== "draft") {
        return reply.code(409).send({
          error: {
            code: "po_locked",
            message: `Items can only be edited while the PO is in draft (current: ${before.status}).`,
          },
        });
      }
      const data: Record<string, unknown> = {};
      if (body.expectedDate !== undefined)
        data.expectedDate = new Date(body.expectedDate);
      if (body.notes !== undefined) data.notes = body.notes;
      let updated;
      if (body.items) {
        const seen = new Set<string>();
        const resolvedLines: ResolvedPoLine[] = [];
        for (const it of body.items) {
          try {
            const line = await resolvePoLine(it, before.vendorId);
            if (seen.has(line.productId)) {
              return reply.code(400).send({
                error: { code: "duplicate_line", productId: line.productId },
              });
            }
            seen.add(line.productId);
            resolvedLines.push(line);
          } catch (e) {
            return reply.code(400).send({
              error: { code: "invalid_line", message: (e as Error).message },
            });
          }
        }
        const total = resolvedLines.reduce((s, i) => s + i.amount, 0);
        data.amount = total;
        updated = await db.$transaction(async (tx) => {
          await tx.purchaseOrderItem.deleteMany({ where: { poId: id } });
          await tx.purchaseOrderItem.createMany({
            data: resolvedLines.map((i) => ({
              poId: id,
              productId: i.productId,
              qty: i.qty,
              rate: i.rate,
              amount: i.amount,
              vendorProductId: i.vendorProductId,
              vendorQty: i.vendorQty,
              vendorUom: i.vendorUom,
              vendorRate: i.vendorRate,
            })),
          });
          return tx.purchaseOrder.update({
            where: { id },
            data,
            include: poInclude,
          });
        });
      } else {
        updated = await db.purchaseOrder.update({
          where: { id },
          data,
          include: poInclude,
        });
      }
      await recordChange("PurchaseOrder", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  app.post(
    "/purchase-orders/:id/approve",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const before = await db.purchaseOrder.findUnique({ where: { id } });
      if (!before) return reply.code(404).send({ error: { code: "not_found" } });
      if (before.status !== "draft") {
        return reply.code(409).send({
          error: {
            code: "bad_state",
            message: `PO is in '${before.status}'; only drafts can be approved.`,
          },
        });
      }
      const updated = await db.purchaseOrder.update({
        where: { id },
        data: { status: "approved" },
        include: poInclude,
      });
      await recordChange("PurchaseOrder", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  app.post(
    "/purchase-orders/:id/cancel",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const before = await db.purchaseOrder.findUnique({
        where: { id },
        include: { grns: { select: { id: true } } },
      });
      if (!before) return reply.code(404).send({ error: { code: "not_found" } });
      if (before.grns.length > 0) {
        return reply.code(409).send({
          error: {
            code: "po_has_grns",
            message: "Cannot cancel a PO that already has goods receipts. Close it instead.",
          },
        });
      }
      if (before.status === "cancelled") {
        return reply.code(409).send({ error: { code: "already_cancelled" } });
      }
      const updated = await db.purchaseOrder.update({
        where: { id },
        data: { status: "cancelled" },
        include: poInclude,
      });
      await recordChange("PurchaseOrder", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  app.post(
    "/purchase-orders/:id/close",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const before = await db.purchaseOrder.findUnique({ where: { id } });
      if (!before) return reply.code(404).send({ error: { code: "not_found" } });
      if (!["partial", "received", "approved"].includes(before.status)) {
        return reply.code(409).send({
          error: {
            code: "bad_state",
            message: `PO is in '${before.status}'; cannot close.`,
          },
        });
      }
      const updated = await db.purchaseOrder.update({
        where: { id },
        data: { status: "closed" },
        include: poInclude,
      });
      await recordChange("PurchaseOrder", id, "update", updated, req.user.sub);
      scheduleStockRulesCheck("po-close", req.user.sub, req.log);
      return updated;
    }
  );

  app.get(
    "/purchase-orders/:id/close-preview",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const preview = await getPoClosePreview(id);
      if (!preview) return reply.code(404).send({ error: { code: "not_found" } });
      return preview;
    }
  );

  // ============= GRN =============

  app.post(
    "/grns/receive-hints",
    { preHandler: [app.authenticate] },
    async (req) => {
      const body = z
        .object({ productIds: z.array(z.string().min(1)).min(1).max(50) })
        .parse(req.body);
      const hints = await getGrnReceiveHints(body.productIds);
      return { hints };
    }
  );

  app.get("/grns", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const where: Record<string, unknown> = {};
    if (q.qcStatus) where.qcStatus = q.qcStatus;
    if (q.poId) where.poId = q.poId;
    return db.grn.findMany({
      where,
      orderBy: { date: "desc" },
      include: {
        po: {
          include: { vendor: { select: { id: true, name: true, code: true } } },
        },
        items: {
          include: {
            poItem: {
              include: {
                product: { select: { id: true, sku: true, name: true, uom: true } },
              },
            },
          },
        },
      },
    });
  });

  // POST /grns - record a goods receipt against a PO. Each line:
  //   * pulls from the PO line via poItemId
  //   * marks receivedQty against the PO's running total
  //   * posts inventory + ledger for the *non-rejected* portion
  //   * never lets total received exceed PO.qty (prevents over-receipt)
  app.post("/grns", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = grnCreate.parse(req.body);
    const po = await db.purchaseOrder.findUnique({
      where: { id: body.poId },
      include: { items: { include: { grnItems: true } } },
    });
    if (!po) return reply.code(404).send({ error: { code: "po_not_found" } });
    if (!["approved", "partial"].includes(po.status)) {
      return reply.code(409).send({
        error: {
          code: "bad_state",
          message: `Cannot receive against a PO in '${po.status}'. Approve it first.`,
        },
      });
    }
    // Validate every receipt line: poItemId must belong to this PO
    // and the new running total mustn't exceed the PO line qty.
    const itemMap = new Map(po.items.map((i) => [i.id, i]));
    for (const line of body.items) {
      const poi = itemMap.get(line.poItemId);
      if (!poi) {
        return reply.code(400).send({
          error: { code: "bad_line", message: `poItemId ${line.poItemId} is not on this PO.` },
        });
      }
      const alreadyReceived = poi.grnItems.reduce(
        (s, g) => s + g.receivedQty - g.rejectedQty,
        0
      );
      const net = line.receivedQty - line.rejectedQty;
      if (net < 0) {
        return reply.code(400).send({
          error: { code: "bad_line", message: "rejectedQty cannot exceed receivedQty." },
        });
      }
      if (alreadyReceived + net > poi.qty + 0.0001) {
        return reply.code(409).send({
          error: {
            code: "over_receipt",
            message: `Line for ${poi.productId}: receiving ${net} would exceed remaining ${poi.qty - alreadyReceived}.`,
            poItemId: poi.id,
            remaining: poi.qty - alreadyReceived,
          },
        });
      }
      if (line.allocations?.length) {
        const sum = line.allocations.reduce((s, a) => s + a.qty, 0);
        if (Math.abs(sum - net) > 0.001) {
          return reply.code(400).send({
            error: {
              code: "allocation_qty_mismatch",
              message: `Bin allocations (${sum}) must equal accepted qty (${net}) for this line.`,
              poItemId: poi.id,
            },
          });
        }
      }
    }

    const grnNo = await nextGrnNo();

    const productIds = [...new Set(body.items.map((l) => itemMap.get(l.poItemId)!.productId))];
    const products = await db.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, sku: true, type: true, batchTracked: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    const resolvedLines = body.items.map((line, idx) => {
      const poi = itemMap.get(line.poItemId)!;
      const product = productById.get(poi.productId)!;
      const batchNo = resolveBatchNo({
        provided: line.batchNo,
        grnNo,
        lineIndex: idx,
        product,
      });
      return {
        ...line,
        batchNo,
        expiryDate: line.expiryDate
          ? new Date(line.expiryDate.includes("T") ? line.expiryDate : `${line.expiryDate}T00:00:00.000Z`)
          : null,
      };
    });

    const grn = await db.grn.create({
      data: {
        grnNo,
        poId: body.poId,
        qcStatus: body.qcStatus,
        truckNo: body.truckNo ?? null,
        driver: body.driver ?? null,
        notes: body.notes ?? null,
        receivedBy: req.user.name,
        items: {
          create: resolvedLines.map((line) => ({
            poItemId: line.poItemId,
            receivedQty: line.receivedQty,
            rejectedQty: line.rejectedQty,
            remarks: line.remarks ?? null,
            batchNo: line.batchNo,
            expiryDate: line.expiryDate,
          })),
        },
      },
      include: {
        items: {
          include: {
            poItem: {
              include: {
                product: { select: { id: true, sku: true, name: true, uom: true } },
              },
            },
          },
        },
      },
    });

    // Post inventory only for accepted (non-rejected) qty AND only when
    // QC didn't reject the whole shipment. 'pending' QC still posts to
    // a "received" location - that's the realistic floor flow; QC
    // rework happens later via stock-adjust if needed.
    const postsInventory = body.qcStatus !== "reject";
    const ledgerEntries: Array<{
      productId: string;
      sku: string;
      qty: number;
      bin: string | null;
      batch: string | null;
      lotId: string | null;
    }> = [];
    if (postsInventory) {
      const inputByPoItem = new Map(body.items.map((l) => [l.poItemId, l]));
      for (const line of grn.items) {
        const accepted = Math.round(line.receivedQty - line.rejectedQty);
        if (accepted <= 0) continue;
        const productId = line.poItem.productId;
        const inputLine = inputByPoItem.get(line.poItemId);
        try {
          const postedRows = await receiveGrnLineStock({
            grnItemId: line.id,
            productId,
            batchNo: line.batchNo ?? `${grn.grnNo}-LOT`,
            qty: accepted,
            sourceRef: grn.grnNo,
            expiryDate: line.expiryDate,
            allocations: inputLine?.allocations,
          });
          await db.product.update({
            where: { id: productId },
            data: { stockOnHand: { increment: accepted } },
          });
          for (const posted of postedRows) {
            ledgerEntries.push({
              productId,
              sku: line.poItem.product.sku,
              qty: posted.lot.qtyOnHand,
              bin: posted.binLabel,
              batch: line.batchNo,
              lotId: posted.lot.id,
            });
          }
        } catch (e) {
          const msg = (e as Error).message;
          if (msg === "no_receive_bin") {
            return reply.code(409).send({
              error: {
                code: "no_receive_bin",
                message: `No bin available to receive ${line.poItem.product.sku}. Configure putaway rules or pick a bin.`,
              },
            });
          }
          if (msg === "allocation_qty_mismatch") {
            return reply.code(400).send({
              error: {
                code: "allocation_qty_mismatch",
                message: `Bin qty split does not match accepted qty for ${line.poItem.product.sku}.`,
              },
            });
          }
          if (msg === "bin_not_found") {
            return reply.code(400).send({
              error: { code: "bin_not_found", message: "One of the selected bins was not found." },
            });
          }
          if (msg === "bin_product_mismatch") {
            return reply.code(409).send({
              error: {
                code: "bin_product_mismatch",
                message: `Selected bin already holds a different product for ${line.poItem.product.sku}.`,
              },
            });
          }
          throw e;
        }
      }
    }

    // Roll up PO status now that the GRN lines exist.
    const updatedPo = await recomputePoStatus(po.id, req.user.sub);
    await recordChange("Grn", grn.id, "insert", grn, req.user.sub);
    scheduleStockRulesCheck("grn", req.user.sub, req.log);
    return { grn, postedToInventory: postsInventory, ledgerEntries, po: updatedPo };
  });

  app.patch(
    "/grns/:id/qc",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const body = z
        .object({
          qcStatus: z.enum(["pending", "pass", "rework", "reject"]),
          notes: z.string().max(500).optional(),
        })
        .parse(req.body);
      const before = await db.grn.findUnique({ where: { id } });
      if (!before) return reply.code(404).send({ error: { code: "not_found" } });
      const updated = await db.grn.update({
        where: { id },
        data: {
          qcStatus: body.qcStatus,
          notes: body.notes ?? before.notes,
        },
      });
      await recordChange("Grn", id, "update", updated, req.user.sub);
      return updated;
    }
  );
};
