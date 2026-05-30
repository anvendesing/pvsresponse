import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { recordChange } from "../sync/log.js";

const transferSchema = z.object({
  productId: z.string(),
  qty: z.number().positive(),
  fromWarehouseId: z.string(),
  toWarehouseId: z.string(),
  fromBin: z.string().optional(),
  toBin: z.string().optional(),
  ref: z.string().optional(),
});

const adjustSchema = z.object({
  productId: z.string(),
  warehouseId: z.string(),
  qty: z.number(),
  reason: z.string().min(2),
});

export const inventoryRoutes = async (app: FastifyInstance) => {
  app.get("/ledger", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const limit = q.limit ? parseInt(q.limit, 10) : 200;
    return db.stockLedger.findMany({
      where: {
        ...(q.productId ? { productId: q.productId } : {}),
        ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
        ...(q.txnType ? { txnType: q.txnType } : {}),
      },
      orderBy: { date: "desc" },
      take: limit,
      include: {
        product: { select: { sku: true, name: true } },
        warehouse: { select: { code: true } },
      },
    });
  });

  app.get("/valuation", async () => {
    const rows = await db.product.findMany({
      orderBy: { sku: "asc" },
      select: {
        id: true,
        sku: true,
        name: true,
        uom: true,
        stockOnHand: true,
        costPrice: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      value: r.stockOnHand * r.costPrice,
    }));
  });

  app.post("/inventory/transfer", { preHandler: [app.authenticate] }, async (req) => {
    const body = transferSchema.parse(req.body);
    return db.$transaction(async (tx) => {
      const [outLedger, inLedger] = await Promise.all([
        tx.stockLedger.create({
          data: {
            productId: body.productId,
            warehouseId: body.fromWarehouseId,
            bin: body.fromBin,
            txnType: "Transfer",
            qty: -body.qty,
            balance: 0,
            ref: body.ref ?? `TRF-${Date.now().toString().slice(-6)}`,
          },
        }),
        tx.stockLedger.create({
          data: {
            productId: body.productId,
            warehouseId: body.toWarehouseId,
            bin: body.toBin,
            txnType: "Transfer",
            qty: body.qty,
            balance: 0,
            ref: body.ref ?? `TRF-${Date.now().toString().slice(-6)}`,
          },
        }),
      ]);
      await recordChange("StockLedger", outLedger.id, "insert", outLedger, req.user.sub, tx);
      await recordChange("StockLedger", inLedger.id, "insert", inLedger, req.user.sub, tx);
      return { ok: true, outLedger, inLedger };
    });
  });

  // Adjust stock for a product within a warehouse. Posts a ledger row
  // AND moves real inventory:
  //   - bumps Product.stockOnHand by the signed qty
  //   - increments / decrements one bin holding that product (or the
  //     first available bin if none does yet) so bin sums stay in step
  //     with Product.stockOnHand.
  // Prior version only wrote a ledger row, which is why "I changed the
  // stock and it didn't reflect in inventory" was a real bug. Negative
  // adjustments that would push the product below zero are rejected
  // with insufficient_stock so the same guardrail as picking applies.
  app.post("/inventory/adjust", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = adjustSchema.parse(req.body);
    if (body.qty === 0) {
      return reply.code(400).send({
        error: { code: "validation", message: "qty cannot be zero." },
      });
    }
    const product = await db.product.findUnique({
      where: { id: body.productId },
      select: { id: true, sku: true, stockOnHand: true },
    });
    if (!product) {
      return reply.code(404).send({
        error: { code: "product_not_found", message: "Unknown productId." },
      });
    }
    const newSohPreview = (product.stockOnHand ?? 0) + body.qty;
    if (newSohPreview < 0) {
      return reply.code(409).send({
        error: {
          code: "insufficient_stock",
          message: `Cannot adjust ${product.sku} by ${body.qty}: only ${product.stockOnHand ?? 0} on hand.`,
        },
      });
    }

    const result = await db.$transaction(async (tx) => {
      const adjNo = await nextAdjustNo(tx as unknown as typeof db);
      let bin = await tx.bin.findFirst({
        where: { warehouseId: body.warehouseId, productId: body.productId },
        orderBy: { qty: "desc" },
      });
      if (!bin && body.qty > 0) {
        // Create a "RECEIVING" bin if none holds this product yet, so
        // a positive adjustment has somewhere to land.
        bin = await tx.bin.findFirst({
          where: { warehouseId: body.warehouseId, productId: null, reservedQty: 0 },
          orderBy: { createdAt: "asc" },
        });
        if (bin) {
          await tx.bin.update({
            where: { id: bin.id },
            data: { productId: body.productId },
          });
        }
      }
      if (!bin) {
        throw new Error("no_bin_available");
      }
      const before = bin.qty ?? 0;
      const after = before + body.qty;
      if (after < 0) {
        // Pull from any other bin holding this product to cover. For now
        // we keep the simple invariant "all the adjustment lands in one
        // bin" - if it would underflow that bin, fail.
        throw new Error("bin_underflow");
      }
      await tx.bin.update({
        where: { id: bin.id },
        data: { qty: Math.round(after) },
      });
      const ledger = await tx.stockLedger.create({
        data: {
          productId: body.productId,
          warehouseId: body.warehouseId,
          bin: `${bin.zone}/${bin.shelf}/${bin.bin}`,
          txnType: "Adjust",
          qty: body.qty,
          balance: Math.round(after),
          ref: adjNo,
        },
      });
      const newSoh = await recomputeStockOnHand(tx as unknown as typeof db, body.productId);
      // High-value moves still raise an approval row for supervisor review.
      if (Math.abs(body.qty) > 50000) {
        await tx.approval.create({
          data: {
            ref: adjNo,
            type: "Stock Adjustment",
            requestedBy: req.user.name,
            amount: body.qty,
            priority: "high",
            reason: body.reason,
          },
        });
      }
      return { ledger, newSoh };
    }).catch((e: unknown) => {
      const code = e instanceof Error ? e.message : "internal";
      if (code === "no_bin_available") {
        reply.code(409).send({
          error: {
            code: "no_bin_available",
            message:
              "No bin holds this product in the chosen warehouse, and no empty bin is free to receive it. Reassign a bin first.",
          },
        });
        return null;
      }
      if (code === "bin_underflow") {
        reply.code(409).send({
          error: {
            code: "bin_underflow",
            message:
              "Adjustment would push a single bin below zero. Split the adjustment across bins or recount the bin via mobile.",
          },
        });
        return null;
      }
      throw e;
    });
    if (!result) return;

    await recordChange("StockLedger", result.ledger.id, "insert", result.ledger, req.user.sub);
    return { ...result.ledger, newSoh: result.newSoh };
  });

  // ================================================== Cycle counts (mobile) ===
  // Reason codes are deliberately closed-set; "other" + free-text remarks
  // is the escape hatch.
  const RECOUNT_REASONS = [
    "physical_match",
    "damage",
    "found_elsewhere",
    "product_swap",
    "spillage",
    "expired",
    "other",
  ] as const;

  // Variance threshold: any recount where the absolute delta exceeds
  // 10% of the previous qty (or 50 units flat) gets BinCount.flagged=true.
  // Not a hard block - any worker can post per the product decision -
  // but supervisors see flagged rows on the desktop audit page.
  const isVariance = (before: number, after: number): boolean => {
    const delta = Math.abs(after - before);
    if (delta > 50) return true;
    if (before > 0 && delta / before > 0.1) return true;
    return false;
  };

  // Recompute Product.stockOnHand from the sum of all bins holding it,
  // so the SOH column never drifts from physical reality.
  const recomputeStockOnHand = async (
    tx: typeof db,
    productId: string
  ): Promise<number> => {
    const agg = await tx.bin.aggregate({
      where: { productId },
      _sum: { qty: true },
    });
    const total = agg._sum.qty ?? 0;
    await tx.product.update({
      where: { id: productId },
      data: { stockOnHand: total },
    });
    return total;
  };

  // Generate the next sequential CC document number, e.g. "CC-2026-0007".
  // Mirrors the friendly numbering used by GRN / PO / SO so workers and
  // auditors see something memorable in the ledger ref column instead of
  // an opaque cuid.
  const nextCycleCountNo = async (tx: typeof db): Promise<string> => {
    const year = new Date().getUTCFullYear();
    const prefix = `CC-${year}-`;
    const last = await tx.stockLedger.findFirst({
      where: { ref: { startsWith: prefix } },
      orderBy: { ref: "desc" },
      select: { ref: true },
    });
    const seq = last
      ? parseInt(last.ref.slice(prefix.length), 10) || 0
      : 0;
    return `${prefix}${String(seq + 1).padStart(4, "0")}`;
  };

  // Same numbering family for product-swap reassigns. Two ledger rows
  // (out + in) share one number but with -OUT / -IN suffixes so they
  // sort together but stay distinguishable.
  const nextReassignNo = async (tx: typeof db): Promise<string> => {
    const year = new Date().getUTCFullYear();
    const prefix = `RX-${year}-`;
    const last = await tx.stockLedger.findFirst({
      where: { ref: { startsWith: prefix } },
      orderBy: { ref: "desc" },
      select: { ref: true },
    });
    // Refs look like "RX-2026-0007-IN"; pull the numeric segment between
    // the prefix and the next "-".
    const seq = last
      ? parseInt(last.ref.slice(prefix.length).split("-")[0], 10) || 0
      : 0;
    return `${prefix}${String(seq + 1).padStart(4, "0")}`;
  };

  const nextAdjustNo = async (tx: typeof db): Promise<string> => {
    const year = new Date().getUTCFullYear();
    const prefix = `ADJ-${year}-`;
    const last = await tx.stockLedger.findFirst({
      where: { ref: { startsWith: prefix } },
      orderBy: { ref: "desc" },
      select: { ref: true },
    });
    const seq = last
      ? parseInt(last.ref.slice(prefix.length), 10) || 0
      : 0;
    return `${prefix}${String(seq + 1).padStart(4, "0")}`;
  };

  // POST /bins/:id/recount - mobile cycle count.
  // Body: { qtyAfter, reasonCode, remarks?, clientOpId? }
  // Mutations (single transaction):
  //   1. update Bin.qty
  //   2. insert StockLedger (txnType=CycleCount, qty=delta, ref=CC-<id>)
  //   3. insert BinCount audit row with flagged variance bit
  //   4. recompute Product.stockOnHand
  app.post(
    "/bins/:id/recount",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const body = z
        .object({
          qtyAfter: z.number().nonnegative(),
          reasonCode: z.enum(RECOUNT_REASONS),
          remarks: z.string().max(500).nullable().optional(),
          clientOpId: z.string().min(8).max(64).optional(),
        })
        .parse(req.body);

      const bin = await db.bin.findUnique({
        where: { id },
        include: { warehouse: { select: { id: true, code: true } } },
      });
      if (!bin) return reply.code(404).send({ error: { code: "not_found" } });
      if (!bin.productId) {
        return reply.code(409).send({
          error: {
            code: "empty_bin",
            message:
              "Bin has no product assigned. Use /bins/:id/reassign to set a product first.",
          },
        });
      }

      // Idempotent replay.
      if (body.clientOpId) {
        const dupKey = `recount:${id}:${body.clientOpId}`;
        const seen = await db.auditLog.findFirst({
          where: { entity: "BinCount", entityId: dupKey },
          select: { id: true },
        });
        if (seen) {
          // Return the most recent matching count so the caller sees a
          // stable response shape on retry.
          const last = await db.binCount.findFirst({
            where: { binId: id },
            orderBy: { createdAt: "desc" },
          });
          return last;
        }
      }

      const before = bin.qty ?? 0;
      const after = Math.round(body.qtyAfter);
      const delta = after - before;
      const flagged = isVariance(before, after);

      const result = await db.$transaction(async (tx) => {
        await tx.bin.update({
          where: { id },
          data: { qty: after },
        });
        const ccNo = await nextCycleCountNo(tx as unknown as typeof db);
        const ledger = await tx.stockLedger.create({
          data: {
            productId: bin.productId!,
            warehouseId: bin.warehouseId,
            bin: `${bin.zone}/${bin.shelf}/${bin.bin}`,
            txnType: "CycleCount",
            qty: delta,
            balance: after,
            ref: ccNo,
          },
        });
        const count = await tx.binCount.create({
          data: {
            binId: id,
            productIdBefore: bin.productId,
            productIdAfter: bin.productId,
            qtyBefore: before,
            qtyAfter: after,
            delta,
            reason: body.reasonCode,
            remarks: body.remarks ?? null,
            countedById: req.user.sub,
            flagged,
          },
        });
        const newSoh = await recomputeStockOnHand(tx as unknown as typeof db, bin.productId!);
        if (body.clientOpId) {
          await tx.auditLog.create({
            data: {
              userId: req.user.sub,
              action: "recount",
              entity: "BinCount",
              entityId: `recount:${id}:${body.clientOpId}`,
              after: JSON.stringify({ before, after, delta, reason: body.reasonCode }),
            },
          });
        }
        return { count, ledger, newSoh };
      });

      await recordChange("BinCount", result.count.id, "insert", result.count, req.user.sub);
      return result.count;
    }
  );

  // POST /bins/:id/reassign - mobile "change product" / "found elsewhere".
  // Empties the bin of the current product (qty -> 0) and re-stocks it
  // with the new product/qty. Two ledger rows + one BinCount with
  // productIdBefore != productIdAfter capture the swap.
  //
  // Body: { productId, qty, reasonCode, remarks?, batch?, clientOpId? }
  app.post(
    "/bins/:id/reassign",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const body = z
        .object({
          productId: z.string().min(1),
          qty: z.number().nonnegative(),
          reasonCode: z.enum(RECOUNT_REASONS),
          remarks: z.string().max(500).nullable().optional(),
          batch: z.string().max(60).nullable().optional(),
          clientOpId: z.string().min(8).max(64).optional(),
        })
        .parse(req.body);

      const bin = await db.bin.findUnique({ where: { id } });
      if (!bin) return reply.code(404).send({ error: { code: "not_found" } });
      const newProduct = await db.product.findUnique({
        where: { id: body.productId },
        select: { id: true, sku: true },
      });
      if (!newProduct) {
        return reply.code(400).send({
          error: { code: "product_not_found", message: "productId is unknown." },
        });
      }
      if (bin.reservedQty > 0 && bin.productId && bin.productId !== newProduct.id) {
        return reply.code(409).send({
          error: {
            code: "bin_reserved",
            message:
              "Bin holds reserved stock for an open pick list. Cancel the pick list before reassigning.",
          },
        });
      }

      if (body.clientOpId) {
        const dupKey = `reassign:${id}:${body.clientOpId}`;
        const seen = await db.auditLog.findFirst({
          where: { entity: "BinCount", entityId: dupKey },
          select: { id: true },
        });
        if (seen) {
          const last = await db.binCount.findFirst({
            where: { binId: id },
            orderBy: { createdAt: "desc" },
          });
          return last;
        }
      }

      const before = bin.qty ?? 0;
      const after = Math.round(body.qty);
      const oldProductId = bin.productId;
      const newProductId = newProduct.id;
      const flagged =
        oldProductId !== newProductId ||
        isVariance(before, after);

      const result = await db.$transaction(async (tx) => {
        const rxNo = await nextReassignNo(tx as unknown as typeof db);
        // Empty existing product (if any) to zero on this bin.
        if (oldProductId && before > 0) {
          await tx.stockLedger.create({
            data: {
              productId: oldProductId,
              warehouseId: bin.warehouseId,
              bin: `${bin.zone}/${bin.shelf}/${bin.bin}`,
              txnType: "Adjust",
              qty: -before,
              balance: 0,
              ref: `${rxNo}-OUT`,
            },
          });
        }
        await tx.bin.update({
          where: { id },
          data: {
            productId: newProductId,
            qty: after,
            batch: body.batch ?? null,
          },
        });
        await tx.stockLedger.create({
          data: {
            productId: newProductId,
            warehouseId: bin.warehouseId,
            bin: `${bin.zone}/${bin.shelf}/${bin.bin}`,
            txnType: "Adjust",
            qty: after,
            balance: after,
            ref: `${rxNo}-IN`,
          },
        });
        const count = await tx.binCount.create({
          data: {
            binId: id,
            productIdBefore: oldProductId,
            productIdAfter: newProductId,
            qtyBefore: before,
            qtyAfter: after,
            delta: after - before,
            reason: body.reasonCode,
            remarks: body.remarks ?? null,
            countedById: req.user.sub,
            flagged,
          },
        });
        // Recompute SOH on both old and new products (if they differ).
        if (oldProductId && oldProductId !== newProductId) {
          await recomputeStockOnHand(tx as unknown as typeof db, oldProductId);
        }
        await recomputeStockOnHand(tx as unknown as typeof db, newProductId);

        if (body.clientOpId) {
          await tx.auditLog.create({
            data: {
              userId: req.user.sub,
              action: "reassign",
              entity: "BinCount",
              entityId: `reassign:${id}:${body.clientOpId}`,
              after: JSON.stringify({
                before,
                after,
                oldProductId,
                newProductId,
                reason: body.reasonCode,
              }),
            },
          });
        }
        return count;
      });

      await recordChange("BinCount", result.id, "insert", result, req.user.sub);
      return result;
    }
  );
};
