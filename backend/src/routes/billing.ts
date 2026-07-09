import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { mintShareToken } from "../lib/share.js";
import { recordChange } from "../sync/log.js";
import { checkStockRules } from "../lib/stock-rules.js";
import { resolveGstRate } from "../lib/tax.js";
import { getCompanyTaxContext } from "../lib/company-tax.js";
import { computeDocumentTax, lineTaxDbFields } from "../lib/document-tax.js";
import { evaluateCreditGate } from "./sales.js";
import { applyAdvancesToInvoice } from "./customer-payments.js";
import { formatCustomerDestination } from "../lib/customer-address.js";
import { recomputeInvoiceWeight } from "../lib/document-weight.js";
import { allocateInvoiceNumber } from "../lib/document-series.js";

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
        customer: { select: { name: true, code: true, addressLine: true, city: true, state: true, pincode: true } },
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

    const baseCtx = await getCompanyTaxContext();
    // Walk-in POS: default intra-state (place of supply = seller state).
    const taxCtx = {
      ...baseCtx,
      placeOfSupplyState: baseCtx.sellerState,
      taxKind: "intra" as const,
    };

    const doc = computeDocumentTax({
      items: body.items.map((i) => ({
        qty: i.qty,
        rate: i.rate,
        gstRate: resolveGstRate(
          { gstRate: gstPMap.get(i.productId) },
          i.variantId ? { gstRate: gstVMap.get(i.variantId) ?? null } : null,
          baseCtx.defaultGstRate ?? 18
        ),
      })),
      transportCharge: 0,
      taxCtx,
    });

    const sub = doc.subTotal;
    const tax = doc.tax;

    // -------- Credit-limit gate (credit-mode invoices only) --------
    // Cash / card / UPI / split invoices are paid at the till and
    // never become AR, so they can't blow a credit limit. Credit-mode
    // walk-in invoices DO add to AR immediately, so they need the
    // same gate the quote-accept and direct-SO flows use. `force:true`
    // lets an authorised cashier override after manager sign-off.
    if (body.paymentMode === "credit") {
      const customer = await db.customer.findUnique({
        where: { id: body.customerId },
        select: { id: true, name: true, creditLimit: true },
      });
      if (!customer) {
        return reply.code(404).send({
          error: { code: "customer_not_found", message: "Customer not found" },
        });
      }
      const limit = customer.creditLimit ?? 0;
      const total = doc.total;
      const gate = await evaluateCreditGate(customer.id, total, customer.name, limit);
      const force = (req.body as { force?: boolean } | null)?.force === true;
      if (!gate.allowed && !force) {
        return reply.code(409).send({
          error: {
            code: "credit_limit_exceeded",
            message: gate.reason,
            details: {
              limit,
              projected: gate.projected,
              exposure: gate.exposure,
              attemptedAmount: total,
            },
          },
        });
      }
    }

    const inv = await db.$transaction(async (tx) => {
      const { documentNo, seriesId, seriesSeq } = await allocateInvoiceNumber(tx, {
        customerId: body.customerId,
        channel: "pos",
      });
      return tx.invoice.create({
        data: {
          invoiceNo: documentNo,
          documentSeriesId: seriesId,
          seriesSeq,
          shareToken: mintShareToken(),
          customerId: body.customerId,
          amount: doc.total,
          tax: doc.tax,
          cgstTotal: doc.cgstTotal,
          sgstTotal: doc.sgstTotal,
          igstTotal: doc.igstTotal,
          taxKind: doc.taxKind,
          placeOfSupplyState: doc.placeOfSupplyState,
          sellerState: doc.sellerState,
          pricingInclusive: doc.pricingInclusive,
          paymentMode: body.paymentMode,
          status: "issued",
          items: {
            create: doc.lineResults.map((line, idx) => {
              const src = body.items[idx];
              const fields = lineTaxDbFields(line);
              return {
                productId: src.productId,
                variantId: src.variantId ?? null,
                qty: src.qty,
                ...fields,
              };
            }),
          },
        },
        include: {
          items: { include: { product: true, variant: true } },
          customer: true,
        },
      });
    });
    // Direct/walk-in invoice — derive weight from line items
    // (no packing slip yet).
    await recomputeInvoiceWeight(db, inv.id);
    await recordChange("Invoice", inv.id, "insert", inv, req.user.sub);

    // Sweep any standing customer advances against this invoice. For
    // cash/card/UPI walk-ins this is normally a no-op (no advance
    // exists), but for credit-mode invoices a customer who paid
    // upfront gets their invoice marked 'paid' immediately rather
    // than sitting at 'issued' until someone runs the FIFO logic.
    if (body.paymentMode === "credit") {
      await applyAdvancesToInvoice(db, inv.id);
    }

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
        if (!rule.monitorBinId) continue;
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
            variantId: item.variantId ?? null,
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
            product: { select: { id: true, sku: true, name: true, uom: true, hsn: true, barcode: true } },
            variant: {
              select: {
                id: true,
                sku: true,
                barcode: true,
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
  //
  // weightKg defaults to 0 in the schema but if the caller leaves it
  // out (or sets it to 0) we now auto-derive it from the linked
  // packing slip's container rollup: prefer
  // totalActualWeightKg (scale readings) when any container has one,
  // otherwise totalEstWeightKg (estimated). This is what lets trip
  // planners trust the per-dispatch weight chip without typing it
  // manually for every drop.
  const dispatchCreate = z
    .object({
      invoiceId: z.string().min(1),
      tripId: z.string().nullable().optional(),
      vehicle: z.string().optional(),
      driver: z.string().optional(),
      destination: z.string().optional(),
      etaHours: z.number().int().nonnegative().default(0),
      weightKg: z.number().nonnegative().optional(),
      status: z
        .enum(["planned", "loading", "in-transit", "delivered", "delayed"])
        .default("planned"),
    })
    .refine(
      (b) => Boolean(b.tripId) || (b.vehicle && b.driver),
      "Either tripId or both vehicle+driver are required."
    );

  // Helper: derive the weight for a dispatch from the invoice's
  // packing slip totals. Returns 0 when no slip is linked (the
  // dispatcher will hand-type it).
  const deriveDispatchWeight = async (invoiceId: string): Promise<number> => {
    const inv = await db.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        totalWeightKg: true,
        packingSlip: {
          select: { totalActualWeightKg: true, totalEstWeightKg: true },
        },
      },
    });
    if (!inv) return 0;
    // Prefer packing slip (closest to physical reality) > invoice
    // weight (computed from line items) > 0.
    const slip = inv.packingSlip;
    if (slip?.totalActualWeightKg != null) return slip.totalActualWeightKg;
    if (slip?.totalEstWeightKg) return slip.totalEstWeightKg;
    if (inv.totalWeightKg) return inv.totalWeightKg;
    return 0;
  };

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
      if (!inv.customer.pincode?.trim()) {
        return reply.code(400).send({
          error: {
            code: "missing_pincode",
            message:
              "Customer pincode is required for dispatch. Update the customer address in Customers.",
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

      // Use the caller's override when set; else fall back to the
      // packing-slip container rollup so dispatchers don't have to
      // hand-type the same number the packer already weighed.
      const effectiveWeight =
        body.weightKg != null && body.weightKg > 0
          ? body.weightKg
          : await deriveDispatchWeight(inv.id);

      const created = await db.dispatchOrder.create({
        data: {
          dispatchNo,
          invoiceId: inv.id,
          tripId: trip?.id ?? null,
          // When on a trip, vehicle/driver come from the trip and the
          // dispatch columns stay null. Direct dispatches keep them.
          vehicle: trip ? null : (body.vehicle ?? null),
          driver: trip ? null : (body.driver ?? null),
          destination:
            body.destination?.trim() || formatCustomerDestination(inv.customer),
          etaHours: body.etaHours,
          weightKg: effectiveWeight,
          status: body.status,
        },
        include: { invoice: { include: { customer: true } }, trip: true },
      });
      await recordChange("DispatchOrder", created.id, "insert", created, req.user.sub);
      return created;
    }
  );

  // Recompute a dispatch's weightKg from the packing slip rollup.
  // Surfaced as a "Recompute weight" action on the dispatch / trip
  // detail screen so dispatchers can refresh after a packer corrected
  // an actual weight on a container post-pack.
  app.post(
    "/dispatches/:id/recompute-weight",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const ex = await db.dispatchOrder.findUnique({
        where: { id },
        select: { id: true, invoiceId: true, weightKg: true },
      });
      if (!ex) return reply.code(404).send({ error: { code: "not_found" } });
      const derived = await deriveDispatchWeight(ex.invoiceId);
      const updated = await db.dispatchOrder.update({
        where: { id },
        data: { weightKg: derived },
        include: { invoice: { include: { customer: true } }, trip: true },
      });
      await recordChange("DispatchOrder", id, "update", updated, req.user.sub);
      return { ...updated, previousWeightKg: ex.weightKg, derivedWeightKg: derived };
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
