import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { mintShareToken } from "../lib/share.js";
import { recordChange } from "../sync/log.js";
import { checkStockRules } from "../lib/stock-rules.js";
import { resolveGstRate, computeTax, lineTax } from "../lib/tax.js";

const invoiceCreate = z.object({
  customerId: z.string(),
  paymentMode: z.enum(["cash", "card", "upi", "credit", "split"]),
  items: z
    .array(
      z.object({
        productId: z.string(),
        variantId: z.string().nullable().optional(),
        qty: z.number().positive(),
        rate: z.number().nonnegative(),
      })
    )
    .min(1),
});

export const billingRoutes = async (app: FastifyInstance) => {
  app.get("/invoices", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    return db.invoice.findMany({
      where: { ...(q.status ? { status: q.status } : {}) },
      include: {
        customer: { select: { name: true, code: true, city: true } },
        items: {
          include: {
            product: { select: { sku: true, name: true, uom: true } },
            variant: {
              select: {
                sku: true,
                size: true,
                color: true,
                grade: true,
                uom: true,
                packSize: true,
              },
            },
          },
        },
      },
      orderBy: { date: "desc" },
      take: q.limit ? parseInt(q.limit, 10) : 100,
    });
  });

  app.post("/invoices", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = invoiceCreate.parse(req.body);

    // -------- Pre-flight oversell guard --------
    // Refuse to issue an invoice that would drive any product / variant
    // stock-on-hand below zero. We aggregate per (productId, variantId)
    // first so multiple lines for the same SKU are checked together, then
    // compare against the live stock. The check is the single point of
    // truth - the actual decrement below relies on it having passed.
    const requested = new Map<
      string,
      { productId: string; variantId: string | null; qty: number }
    >();
    for (const it of body.items) {
      const k = `${it.productId}::${it.variantId ?? ""}`;
      const cur = requested.get(k);
      if (cur) cur.qty += it.qty;
      else
        requested.set(k, {
          productId: it.productId,
          variantId: it.variantId ?? null,
          qty: it.qty,
        });
    }
    const productIds = [...new Set([...requested.values()].map((v) => v.productId))];
    const variantIds = [
      ...new Set([...requested.values()].map((v) => v.variantId).filter(Boolean) as string[]),
    ];
    const [products, variants] = await Promise.all([
      db.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, sku: true, name: true, stockOnHand: true },
      }),
      variantIds.length
        ? db.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: { id: true, sku: true, stockOnHand: true, productId: true },
          })
        : Promise.resolve([] as { id: string; sku: string; stockOnHand: number; productId: string }[]),
    ]);
    const prodById = new Map(products.map((p) => [p.id, p]));
    const varById = new Map(variants.map((v) => [v.id, v]));
    const oversell: {
      productId: string;
      variantId: string | null;
      sku: string;
      requested: number;
      available: number;
    }[] = [];
    for (const r of requested.values()) {
      if (r.variantId) {
        const v = varById.get(r.variantId);
        if (!v) {
          return reply
            .code(404)
            .send({ error: { code: "variant_not_found", message: r.variantId } });
        }
        if (r.qty > v.stockOnHand + 1e-6) {
          oversell.push({
            productId: r.productId,
            variantId: r.variantId,
            sku: v.sku,
            requested: r.qty,
            available: v.stockOnHand,
          });
        }
      } else {
        const p = prodById.get(r.productId);
        if (!p) {
          return reply
            .code(404)
            .send({ error: { code: "product_not_found", message: r.productId } });
        }
        if (r.qty > p.stockOnHand + 1e-6) {
          oversell.push({
            productId: r.productId,
            variantId: null,
            sku: p.sku,
            requested: r.qty,
            available: p.stockOnHand,
          });
        }
      }
    }
    if (oversell.length > 0) {
      return reply.code(409).send({
        error: {
          code: "insufficient_stock",
          message:
            "Cannot issue invoice: one or more items would exceed available stock. Reduce qty, split across multiple invoices, or run a stock adjustment first.",
          details: oversell,
        },
      });
    }
    // -------- End pre-flight guard --------

    // Resolve per-line GST rates.
    const gstProductIds = [...new Set(body.items.map((i) => i.productId))];
    const gstVariantIds = [...new Set(body.items.map((i) => i.variantId).filter(Boolean) as string[])];
    const [gstProducts, gstVariants] = await Promise.all([
      db.product.findMany({ where: { id: { in: gstProductIds } }, select: { id: true, gstRate: true } }),
      gstVariantIds.length
        ? db.productVariant.findMany({ where: { id: { in: gstVariantIds } }, select: { id: true, gstRate: true } })
        : Promise.resolve([]),
    ]);
    const gstPMap = new Map(gstProducts.map((p) => [p.id, p.gstRate]));
    const gstVMap = new Map(gstVariants.map((v) => [v.id, v.gstRate]));

    const itemsWithGst = body.items.map((i) => ({
      ...i,
      lineAmount: i.qty * i.rate,
      lineGstRate: resolveGstRate(
        { gstRate: gstPMap.get(i.productId) ?? 18 },
        i.variantId ? { gstRate: gstVMap.get(i.variantId) } : null
      ),
    }));

    const sub = itemsWithGst.reduce((s, i) => s + i.lineAmount, 0);
    const tax = computeTax(itemsWithGst.map((i) => ({ amount: i.lineAmount, gstRate: i.lineGstRate })));
    const next = await db.invoice.count();
    const inv = await db.invoice.create({
      data: {
        invoiceNo: `INV-2026-${String(5500 + next)}`,
        shareToken: mintShareToken(),
        customerId: body.customerId,
        amount: sub + tax,
        tax,
        paymentMode: body.paymentMode,
        status: "issued",
        items: {
          create: itemsWithGst.map((i) => ({
            productId: i.productId,
            variantId: i.variantId ?? null,
            qty: i.qty,
            rate: i.rate,
            amount: i.lineAmount,
            gstRate: i.lineGstRate,
            taxAmount: lineTax(i.lineAmount, i.lineGstRate),
          })),
        },
      },
      include: {
        items: { include: { product: true, variant: true } },
        customer: true,
      },
    });
    await recordChange("Invoice", inv.id, "insert", inv, req.user.sub);

    // Decrement stock and record ledger entries — on the variant if present.
    // Stock-on-hand was validated above (pre-flight oversell guard), so the
    // decrement here is guaranteed not to produce a negative balance.
    const wh = await db.warehouse.findFirst();
    const checkedBins = new Set<string>();
    for (const item of body.items) {
      const dec = Math.round(item.qty);
      if (item.variantId) {
        await db.productVariant.update({
          where: { id: item.variantId },
          data: { stockOnHand: { decrement: dec } },
        });
      } else {
        await db.product.update({
          where: { id: item.productId },
          data: { stockOnHand: { decrement: dec } },
        });
      }

      const rules = await db.stockRule.findMany({
        where: {
          productId: item.productId,
          active: true,
          ...(item.variantId
            ? { OR: [{ variantId: item.variantId }, { variantId: null }] }
            : { variantId: null }),
        },
      });
      for (const rule of rules) {
        const monitor = await db.bin.findUnique({
          where: { id: rule.monitorBinId },
        });
        if (monitor && monitor.qty > 0) {
          const take = Math.min(monitor.qty, dec);
          await db.bin.update({
            where: { id: rule.monitorBinId },
            data: { qty: { decrement: take } },
          });
        }
        if (!checkedBins.has(rule.monitorBinId)) {
          checkedBins.add(rule.monitorBinId);
          await checkStockRules(rule.monitorBinId, req.user.sub);
        }
      }

      if (wh) {
        await db.stockLedger.create({
          data: {
            productId: item.productId,
            warehouseId: wh.id,
            txnType: "Sale",
            qty: -item.qty,
            balance: 0,
            ref: inv.invoiceNo,
          },
        });
      }
    }
    return inv;
  });

  // Single invoice detail incl. line items + linked dispatches. Used by
  // the InvoiceDetail drawer in the portal.
  app.get("/invoices/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const inv = await db.invoice.findUnique({
      where: { id },
      include: {
        customer: true,
        // `source` lets the desktop UI tell whether this invoice came
        // from the storefront mock (which gets a courier handoff via
        // the mock ShiprocketAdapter) vs a back-office SO (which is
        // dispatched in-house via Trip assignments). The Billing
        // detail drawer hides the trip-assignment block for ecommerce
        // invoices and shows the AWB/carrier instead.
        salesOrder: { select: { id: true, soNo: true, status: true, source: true } },
        // awb + carrier (and the courier lifecycle timestamps) are
        // stamped on the slip at pack-complete for ecommerce orders
        // or via /assign-courier. We surface them so the invoice
        // detail can render the courier handoff card without a second
        // round-trip.
        packingSlip: {
          select: {
            id: true,
            packingSlipNo: true,
            status: true,
            awb: true,
            carrier: true,
            trackingUrl: true,
            dispatchedAt: true,
            deliveredAt: true,
          },
        },
        items: {
          include: {
            product: { select: { id: true, sku: true, name: true, uom: true, hsn: true } },
            variant: {
              select: {
                id: true,
                sku: true,
                size: true,
                color: true,
                grade: true,
                uom: true,
                packSize: true,
              },
            },
          },
        },
        dispatches: {
          orderBy: { createdAt: "desc" },
          include: {
            trip: {
              select: {
                id: true,
                tripNo: true,
                scheduledDate: true,
                vehicle: true,
                driver: true,
                route: true,
                status: true,
              },
            },
          },
        },
      },
    });
    if (!inv) return reply.code(404).send({ error: { code: "not_found" } });
    return inv;
  });

  app.get("/dispatches", async () =>
    db.dispatchOrder.findMany({
      include: {
        invoice: { include: { customer: true } },
        trip: {
          select: {
            id: true,
            tripNo: true,
            scheduledDate: true,
            vehicle: true,
            driver: true,
            route: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    })
  );

  // Create a dispatch (transport order) from an issued invoice. Two
  // shapes are supported:
  //   1. Trip-based (preferred) - body has tripId; vehicle/driver are
  //      inherited from the trip and DispatchOrder.vehicle/driver are
  //      left null.
  //   2. Direct - body has explicit vehicle/driver. Used only for
  //      one-off dispatches that aren't on a planned trip (legacy /
  //      walk-in flow).
  // Either way: weightKg, etaHours, destination are per-dispatch
  // overrides. Destination defaults to the customer's city.
  const dispatchCreate = z
    .object({
      invoiceId: z.string().min(1),
      tripId: z.string().nullable().optional(),
      vehicle: z.string().optional(),
      driver: z.string().optional(),
      destination: z.string().optional(),
      etaHours: z.number().int().nonnegative().default(0),
      weightKg: z.number().nonnegative().default(0),
      status: z
        .enum(["planned", "loading", "in-transit", "delivered", "delayed"])
        .default("planned"),
    })
    .refine(
      (b) => Boolean(b.tripId) || (b.vehicle && b.driver),
      "Either tripId or both vehicle+driver are required."
    );

  app.post(
    "/dispatches",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const body = dispatchCreate.parse(req.body);
      const inv = await db.invoice.findUnique({
        where: { id: body.invoiceId },
        include: { customer: true },
      });
      if (!inv) return reply.code(404).send({ error: { code: "invoice_not_found" } });
      if (inv.status === "draft") {
        return reply.code(409).send({
          error: {
            code: "invoice_not_issued",
            message: "Issue the invoice before creating a dispatch.",
          },
        });
      }

      // Validate the target trip if tripId is set.
      let trip: Awaited<ReturnType<typeof db.trip.findUnique>> | null = null;
      if (body.tripId) {
        trip = await db.trip.findUnique({ where: { id: body.tripId } });
        if (!trip) {
          return reply
            .code(404)
            .send({ error: { code: "trip_not_found" } });
        }
        if (trip.status !== "scheduled") {
          return reply.code(409).send({
            error: {
              code: "trip_locked",
              message: `Trip is '${trip.status}', cannot add drops.`,
            },
          });
        }
      }

      // Sequential dispatch number: DSP-2026-NNNN.
      const last = await db.dispatchOrder.findFirst({
        where: { dispatchNo: { startsWith: `DSP-2026-` } },
        orderBy: { dispatchNo: "desc" },
        select: { dispatchNo: true },
      });
      const lastN = last ? parseInt(last.dispatchNo.split("-").pop() ?? "9000", 10) : 9000;
      const dispatchNo = `DSP-2026-${lastN + 1}`;

      const created = await db.dispatchOrder.create({
        data: {
          dispatchNo,
          invoiceId: inv.id,
          tripId: trip?.id ?? null,
          // When on a trip, vehicle/driver come from the trip and the
          // dispatch columns stay null. Direct dispatches keep them.
          vehicle: trip ? null : (body.vehicle ?? null),
          driver: trip ? null : (body.driver ?? null),
          destination: body.destination?.trim() || inv.customer.city || inv.customer.name,
          etaHours: body.etaHours,
          weightKg: body.weightKg,
          status: body.status,
        },
        include: { invoice: { include: { customer: true } }, trip: true },
      });
      await recordChange("DispatchOrder", created.id, "insert", created, req.user.sub);
      return created;
    }
  );

  app.post(
    "/dispatches/:id/confirm",
    { preHandler: [app.authenticate] },
    async (req) => {
      const id = (req.params as { id: string }).id;
      const updated = await db.dispatchOrder.update({
        where: { id },
        data: { status: "delivered", otpVerified: true, signedAt: new Date() },
      });
      await recordChange("DispatchOrder", id, "update", updated, req.user.sub);
      return updated;
    }
  );
};
