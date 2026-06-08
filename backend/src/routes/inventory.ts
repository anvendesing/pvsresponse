import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { recordChange } from "../sync/log.js";
import { checkStockRules } from "../lib/stock-rules.js";

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
  // Variant SKU this adjustment targets. When the parent product has
  // variants, the caller MUST pass the specific variantId so the
  // delta lands in (and is recomputed against) the right bin family.
  // Omit only for products that have no variants (bulk SKUs without
  // sellable child SKUs) or for legitimate bulk-only stock kept under
  // the parent SKU itself.
  variantId: z.string().nullable().optional(),
  warehouseId: z.string(),
  /** When set, the delta is applied to this bin (Manufacturing reads bin qty). */
  binId: z.string().optional(),
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
        // Variant SKU + size disambiguate variant-scoped rows (e.g. MO
        // producing the 250ml variant from a parent SKU shared with the
        // bulk consumed material).
        variant: { select: { sku: true, size: true } },
        warehouse: { select: { code: true } },
      },
    });
  });

  // GET /inventory/locations?q= — find products/variants and every bin holding stock
  app.get("/inventory/locations", { preHandler: [app.authenticate] }, async (req) => {
    const q = ((req.query as Record<string, string>).q ?? "").trim();
    // Empty query = return all products that have bin stock
    const where = q.length > 0 ? {
      OR: [
        { sku: { contains: q } },
        { name: { contains: q } },
        { barcode: { contains: q } },
        { variants: { some: { sku: { contains: q } } } },
        { variants: { some: { barcode: { contains: q } } } },
      ],
    } : {};
    const products = await db.product.findMany({
      where,
      take: 100,
      orderBy: { sku: "asc" },
      select: {
        id: true,
        sku: true,
        name: true,
        uom: true,
        stockOnHand: true,
        variants: {
          select: {
            id: true,
            sku: true,
            barcode: true,
            size: true,
            stockOnHand: true,
            packSize: true,
            uom: true,
          },
        },
      },
    });

    const productIds = products.map((p) => p.id);
    const allBins =
      productIds.length === 0
        ? []
        : await db.bin.findMany({
            where: { productId: { in: productIds }, qty: { gt: 0 } },
            select: {
              id: true,
              productId: true,
              variantId: true,
              qty: true,
              reservedQty: true,
              zone: true,
              shelf: true,
              bin: true,
              warehouseId: true,
              warehouse: { select: { id: true, code: true, name: true, kind: true } },
            },
            orderBy: [
              { productId: "asc" },
              { warehouse: { code: "asc" } },
              { zone: "asc" },
              { shelf: "asc" },
              { bin: "asc" },
            ],
          });

    const binsByProduct = new Map<string, typeof allBins>();
    for (const b of allBins) {
      if (!b.productId) continue;
      const list = binsByProduct.get(b.productId) ?? [];
      list.push(b);
      binsByProduct.set(b.productId, list);
    }

    // Lookup table for resolving each bin's variant tag back to the
    // human SKU/size — the bin only stores variantId, but the UI wants
    // the variant SKU on each row.
    const variantByIdAcrossProducts = new Map<
      string,
      { id: string; sku: string; size: string | null; uom: string; packSize: number }
    >();
    for (const p of products) {
      for (const v of p.variants) {
        variantByIdAcrossProducts.set(v.id, {
          id: v.id,
          sku: v.sku,
          size: v.size,
          uom: v.uom,
          packSize: v.packSize,
        });
      }
    }

    const matches = products.map((p) => {
      const allBinsForProduct = binsByProduct.get(p.id) ?? [];
      // When the query string matches a specific variant SKU exactly
      // (or as a substring), narrow the bin list to bins tagged with
      // that variant. Legacy untagged bins (variantId = null) are
      // preserved so we don't hide stock that pre-dates the variant
      // tagging migration. Without an exact-variant match, return
      // every bin and let the per-bin chip tell the user what each
      // bin actually holds.
      const matchedVariant = q
        ? p.variants.find(
            (v) => v.sku.includes(q) || (v.barcode && v.barcode.includes(q))
          ) ?? null
        : null;
      // Only narrow when the query genuinely points at this variant —
      // a parent SKU search like "CAOL" must NOT collapse to one
      // variant's bins (that's exactly the bug where every bin
      // appeared as CAOL-AMU-5L-01).
      const queryHitsVariantPrecisely =
        matchedVariant !== null &&
        q.length > 0 &&
        matchedVariant.sku.toLowerCase().includes(q.toLowerCase()) &&
        !p.sku.toLowerCase().includes(q.toLowerCase());
      const bins = queryHitsVariantPrecisely && matchedVariant
        ? allBinsForProduct.filter(
            (b) => b.variantId === matchedVariant.id || b.variantId === null
          )
        : allBinsForProduct;
      const binTotal = bins.reduce((s, b) => s + b.qty, 0);
      const binFree = bins.reduce((s, b) => s + (b.qty - b.reservedQty), 0);
      return {
        productId: p.id,
        sku: p.sku,
        name: p.name,
        uom: p.uom,
        counterOnHand: p.stockOnHand,
        binTotal,
        binFree,
        // matchedVariant remains for callers that explicitly look up a
        // single variant; the inventory locations panel now prefers
        // each bin's own variantSku for display.
        matchedVariant: matchedVariant
          ? {
              id: matchedVariant.id,
              sku: matchedVariant.sku,
              label: [matchedVariant.size, matchedVariant.uom].filter(Boolean).join(" · "),
              stockOnHand: matchedVariant.stockOnHand,
              packSize: matchedVariant.packSize,
            }
          : null,
        bins: bins.map((b) => {
          const v = b.variantId
            ? variantByIdAcrossProducts.get(b.variantId) ?? null
            : null;
          return {
            binId: b.id,
            warehouseId: b.warehouseId,
            warehouseCode: b.warehouse.code,
            warehouseName: b.warehouse.name,
            warehouseKind: b.warehouse.kind,
            location: `${b.zone}/${b.shelf}/${b.bin}`,
            zone: b.zone,
            shelf: b.shelf,
            bin: b.bin,
            qty: b.qty,
            reserved: b.reservedQty,
            free: b.qty - b.reservedQty,
            // Per-bin variant attribution. NULL = parent / bulk bin.
            variantId: b.variantId,
            variantSku: v?.sku ?? null,
            variantSize: v?.size ?? null,
            variantUom: v?.uom ?? null,
          };
        }),
      };
    });

    // Only return products that actually have bins with stock
    return { matches: matches.filter((m) => m.bins.length > 0) };
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

    // Validate the variant if one was supplied — must belong to the
    // parent product and be active. Variants and parents are stored
    // in separate bins with separate UoMs, so an adjustment must
    // declare which level it's targeting.
    const variantId = body.variantId ?? null;
    let variant: { id: string; sku: string; stockOnHand: number } | null = null;
    if (variantId) {
      const v = await db.productVariant.findUnique({
        where: { id: variantId },
        select: { id: true, sku: true, stockOnHand: true, productId: true },
      });
      if (!v) {
        return reply.code(404).send({
          error: { code: "variant_not_found", message: "Unknown variantId." },
        });
      }
      if (v.productId !== body.productId) {
        return reply.code(400).send({
          error: {
            code: "variant_mismatch",
            message: `Variant ${v.sku} does not belong to product ${product.sku}.`,
          },
        });
      }
      variant = { id: v.id, sku: v.sku, stockOnHand: v.stockOnHand };
    }

    // Compare against the right counter — variant SKU vs parent SKU.
    const sohBefore = variant?.stockOnHand ?? product.stockOnHand ?? 0;
    const sohLabel = variant?.sku ?? product.sku;
    if (sohBefore + body.qty < 0) {
      return reply.code(409).send({
        error: {
          code: "insufficient_stock",
          message: `Cannot adjust ${sohLabel} by ${body.qty}: only ${sohBefore} on hand.`,
        },
      });
    }

    const result = await db.$transaction(async (tx) => {
      const adjNo = await nextAdjustNo(tx as unknown as typeof db);
      let bin: {
        id: string;
        zone: string;
        shelf: string;
        bin: string;
        qty: number;
        productId: string | null;
        variantId: string | null;
      } | null = null;

      if (body.binId) {
        const picked = await tx.bin.findFirst({
          where: { id: body.binId, warehouseId: body.warehouseId },
        });
        if (!picked) throw new Error("bin_not_found");

        // The bin must agree with what we're targeting. Variant-level
        // adjustments must land in a variant-tagged bin (or an empty
        // bin we can tag); parent/bulk adjustments must land in a
        // bin without a variantId.
        if (variantId) {
          if (picked.variantId && picked.variantId !== variantId) {
            throw new Error("bin_variant_mismatch");
          }
          if (picked.productId && picked.productId !== body.productId) {
            throw new Error("bin_product_mismatch");
          }
          if (body.qty > 0 && (!picked.productId || !picked.variantId)) {
            await tx.bin.update({
              where: { id: picked.id },
              data: { productId: body.productId, variantId },
            });
          }
        } else {
          if (picked.variantId) {
            // Bulk/parent adjustments cannot land in a variant-tagged
            // bin — that bin is for sellable variant inventory only.
            throw new Error("bin_is_variant_only");
          }
          if (body.qty < 0 && picked.productId !== body.productId) {
            throw new Error("bin_product_mismatch");
          }
          if (body.qty > 0) {
            if (picked.productId && picked.productId !== body.productId) {
              throw new Error("bin_product_mismatch");
            }
            if (!picked.productId) {
              await tx.bin.update({
                where: { id: picked.id },
                data: { productId: body.productId },
              });
            }
          }
        }
        bin = {
          ...picked,
          productId: picked.productId ?? body.productId,
          variantId: variantId ?? picked.variantId,
        };
      } else {
        // No bin specified — auto-pick. Variant adjustments only
        // search variant-tagged bins; parent/bulk only bins where
        // variantId IS NULL.
        bin = await tx.bin.findFirst({
          where: variantId
            ? { warehouseId: body.warehouseId, variantId }
            : { warehouseId: body.warehouseId, productId: body.productId, variantId: null },
          orderBy: { qty: "desc" },
        });
        if (!bin && body.qty > 0) {
          // Land positive stock in the first empty bin in this warehouse.
          const empty = await tx.bin.findFirst({
            where: {
              warehouseId: body.warehouseId,
              productId: null,
              variantId: null,
              reservedQty: 0,
            },
            orderBy: { createdAt: "asc" },
          });
          if (empty) {
            await tx.bin.update({
              where: { id: empty.id },
              data: { productId: body.productId, variantId: variantId ?? null },
            });
            bin = {
              ...empty,
              productId: body.productId,
              variantId: variantId ?? null,
            };
          }
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
          variantId: variantId ?? null,
          warehouseId: body.warehouseId,
          bin: `${bin.zone}/${bin.shelf}/${bin.bin}`,
          txnType: "Adjust",
          qty: body.qty,
          balance: Math.round(after),
          ref: adjNo,
        },
      });
      const newSoh = await recomputeStockOnHand(
        tx as unknown as typeof db,
        body.productId,
        variantId,
        body.qty
      );
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
      if (code === "bin_not_found") {
        reply.code(404).send({
          error: { code: "bin_not_found", message: "Bin not found in this warehouse." },
        });
        return null;
      }
      if (code === "bin_product_mismatch") {
        reply.code(409).send({
          error: {
            code: "bin_product_mismatch",
            message: "That bin holds a different product. Pick another bin or use an empty slot.",
          },
        });
        return null;
      }
      if (code === "bin_variant_mismatch") {
        reply.code(409).send({
          error: {
            code: "bin_variant_mismatch",
            message:
              "That bin is tagged for a different variant of this product. Pick the bin that matches the chosen variant or use an empty slot.",
          },
        });
        return null;
      }
      if (code === "bin_is_variant_only") {
        reply.code(409).send({
          error: {
            code: "bin_is_variant_only",
            message:
              "That bin holds a sellable variant; bulk/parent stock cannot be mixed in. Pick a parent-only bin or pass the variantId so this becomes a variant-level adjustment.",
          },
        });
        return null;
      }
      throw e;
    });
    if (!result) return;

    await recordChange("StockLedger", result.ledger.id, "insert", result.ledger, req.user.sub);
    if (body.qty < 0 && body.binId) {
      await checkStockRules(body.binId, req.user.sub);
    }
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

  // Apply a stock-on-hand delta to the right counter (variant or
  // parent). Returns the post-update SOH value so the caller can
  // surface it in audit logs / response payloads.
  //
  // Why incremental and not "recompute from bins"
  // --------------------------------------------
  // Stock-on-hand is a running balance shared by every flow that
  // touches inventory: GRN posts +qty, sales/dispatch -qty, manuf
  // production +qty, manuf consumption -qty, adjustments ±qty. Some
  // of those flows touch bins (where this delta also applies); some
  // (legacy seed data, sales counter decrements) don't. Aggregating
  // SOH from bin sums on every adjustment would over-correct — it
  // would zero out any counter whose bins were never populated, even
  // though the canonical SOH is right.
  //
  // The bin-sum view is still available — see /products/:id/bin-stock
  // and /inventory/locations — but it lives alongside the counter
  // rather than replacing it. The two only converge when every
  // movement on a SKU is bin-aware (the goal for new SKUs going
  // forward; legacy SKUs converge as they're recounted).
  //
  // Convention for routing the delta:
  //   • variantId set → ProductVariant.stockOnHand += delta
  //   • variantId null → Product.stockOnHand += delta   (bulk parent)
  const recomputeStockOnHand = async (
    tx: typeof db,
    productId: string,
    variantId: string | null,
    delta: number
  ): Promise<number> => {
    if (variantId) {
      const before = await tx.productVariant.findUnique({
        where: { id: variantId },
        select: { stockOnHand: true },
      });
      const after = Math.max(0, (before?.stockOnHand ?? 0) + delta);
      await tx.productVariant.update({
        where: { id: variantId },
        data: { stockOnHand: after },
      });
      return after;
    }
    const before = await tx.product.findUnique({
      where: { id: productId },
      select: { stockOnHand: true },
    });
    const after = Math.max(0, (before?.stockOnHand ?? 0) + delta);
    await tx.product.update({
      where: { id: productId },
      data: { stockOnHand: after },
    });
    return after;
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
        // BinCount delta lands on the variant if the bin is variant-tagged,
        // else on the parent. Mirrors the routing rule used by /inventory/adjust.
        const newSoh = await recomputeStockOnHand(
          tx as unknown as typeof db,
          bin.productId!,
          bin.variantId ?? null,
          delta
        );
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
        // Bin reassign moves units from one product to another. The
        // OLD product loses `before` units; the NEW product gains
        // `after` units. Stay variant-aware on whichever side has a
        // variantId tag (typically neither at this point — reassign
        // is for parent-only flows — but keep the column honest).
        if (oldProductId && oldProductId !== newProductId) {
          await recomputeStockOnHand(
            tx as unknown as typeof db,
            oldProductId,
            null,
            -before
          );
        }
        await recomputeStockOnHand(
          tx as unknown as typeof db,
          newProductId,
          null,
          after
        );

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
