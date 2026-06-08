// Storefront mock: a single endpoint that lets a non-authenticated
// caller place a *prepaid* order. The intent is to demo what the
// real-storefront flow will look like without standing up the full
// auth/cart/payment-gateway scaffolding.
//
// What POST /storefront-mock/order does, atomically, in one db.$transaction:
//   1. Upsert Customer + CustomerAccount by email.
//   2. Pre-flight oversell check on every line - refuses with
//      `409 insufficient_stock` if any variant lacks stock. Mirrors the
//      existing billing.ts guard so error UX is consistent.
//   3. Create SalesOrder with status="confirmed", source="ecommerce".
//   4. Decrement ProductVariant.stockOnHand (or Product.stockOnHand for
//      non-variant lines).
//   5. Create paid Invoice (status="paid", paymentMode="upi") linked to
//      the SO.
//   6. Write StockLedger rows referencing the invoice number.
//
// After the transaction commits, the existing pick-list creator helper
// drafts a PickList for the new SO. From then on, the order rides the
// regular pick/pack pipeline; the only hint it came from the mock is
// the SalesOrder.source="ecommerce" flag and the AWB stamped on the
// PackingSlip at pack-complete.
//
// Gated by an optional MOCK_STOREFRONT_TOKEN env var: if set, callers
// must send `x-mock-token` matching it. Useful for shared dev boxes.
// In a localhost dev server it can be left unset and the endpoint is
// open.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { mintShareToken } from "../lib/share.js";
import { recordChange } from "../sync/log.js";
import { createPickListForSalesOrder } from "../services/pick-list-create.js";
import { resolveGstRate, computeTax, lineTax } from "../lib/tax.js";

const orderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().min(6).max(20),
  city: z.string().trim().min(1).max(80).optional(),
  notes: z.string().trim().max(500).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        variantId: z.string().nullable().optional(),
        qty: z.number().positive(),
      })
    )
    .min(1)
    .max(40),
});

// Generate the next CUST-NNNN code. Mirrors catalog.ts logic; kept
// inline (and not extracted) because there's only this one extra
// caller and the helper is dead simple.
const nextCustomerCode = async (): Promise<string> => {
  const last = await db.customer.findFirst({
    where: { code: { startsWith: "CUST-" } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const n = last ? parseInt(last.code.replace("CUST-", ""), 10) || 0 : 0;
  return `CUST-${(n + 1).toString().padStart(4, "0")}`;
};

const nextSoNo = async (): Promise<string> => {
  const rows = await db.salesOrder.findMany({
    where: { soNo: { startsWith: "SO-2026-" } },
    select: { soNo: true },
  });
  const tail = rows
    .map((r) => parseInt(r.soNo.split("-").pop() ?? "0", 10))
    .filter((n) => Number.isFinite(n));
  const max = tail.length > 0 ? Math.max(...tail) : 2000;
  return `SO-2026-${String(max + 1).padStart(4, "0")}`;
};

const nextInvoiceNo = async (): Promise<string> => {
  const rows = await db.invoice.findMany({
    where: { invoiceNo: { startsWith: "INV-2026-" } },
    select: { invoiceNo: true },
  });
  const tail = rows
    .map((r) => parseInt(r.invoiceNo.split("-").pop() ?? "0", 10))
    .filter((n) => Number.isFinite(n));
  const max = tail.length > 0 ? Math.max(...tail) : 5499;
  return `INV-2026-${String(max + 1).padStart(4, "0")}`;
};

// Resolve a "system" user id once at startup. The pick-list creator
// needs a User.id for createdById. Falls back to the seeded admin -
// every fresh install has one. If even that is missing we leave it
// null and the route will surface a 500 on first call rather than
// silently corrupt audit logs.
let systemUserIdCache: string | null | undefined;
const getSystemUserId = async (): Promise<string | null> => {
  if (systemUserIdCache !== undefined) return systemUserIdCache;
  const u = await db.user.findFirst({
    where: { username: "admin" },
    select: { id: true },
  });
  systemUserIdCache = u?.id ?? null;
  return systemUserIdCache;
};

export const storefrontMockRoutes = async (app: FastifyInstance) => {
  app.post("/storefront-mock/order", async (req, reply) => {
    const expectedToken = process.env.MOCK_STOREFRONT_TOKEN;
    if (expectedToken) {
      const got = req.headers["x-mock-token"];
      if (got !== expectedToken) {
        return reply
          .code(401)
          .send({ error: { code: "unauthorized", message: "Bad mock token." } });
      }
    }

    const body = orderSchema.parse(req.body);

    // ---- Pre-flight oversell guard. Same shape as billing.ts. -----------
    const variantIds = body.items
      .map((i) => i.variantId)
      .filter((v): v is string => typeof v === "string" && v.length > 0);
    const productIds = body.items.map((i) => i.productId);

    const variants = variantIds.length
      ? await db.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: {
            id: true,
            sku: true,
            stockOnHand: true,
            productId: true,
            sellingPriceOverride: true,
            active: true,
            gstRate: true,
          },
        })
      : [];
    const products = await db.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        sku: true,
        name: true,
        state: true,
        stockOnHand: true,
        sellingPrice: true,
        gstRate: true,
      },
    });
    const vMap = new Map(variants.map((v) => [v.id, v]));
    const pMap = new Map(products.map((p) => [p.id, p]));

    type Issue = { sku: string; requested: number; available: number };
    const oversell: Issue[] = [];
    for (const it of body.items) {
      const p = pMap.get(it.productId);
      if (!p) {
        return reply.code(400).send({
          error: {
            code: "product_not_found",
            message: `Unknown productId ${it.productId}.`,
          },
        });
      }
      if (p.state !== "active") {
        return reply.code(409).send({
          error: {
            code: "product_inactive",
            message: `${p.sku} is not on sale (state=${p.state}).`,
          },
        });
      }
      if (it.variantId) {
        const v = vMap.get(it.variantId);
        if (!v || v.productId !== it.productId) {
          return reply.code(400).send({
            error: {
              code: "variant_mismatch",
              message: `Variant ${it.variantId} does not belong to product ${p.sku}.`,
            },
          });
        }
        if (!v.active) {
          return reply.code(409).send({
            error: {
              code: "variant_inactive",
              message: `Variant ${v.sku} is no longer on sale.`,
            },
          });
        }
        if (it.qty > (v.stockOnHand ?? 0)) {
          oversell.push({
            sku: v.sku,
            requested: it.qty,
            available: v.stockOnHand ?? 0,
          });
        }
      } else {
        if (it.qty > (p.stockOnHand ?? 0)) {
          oversell.push({
            sku: p.sku,
            requested: it.qty,
            available: p.stockOnHand ?? 0,
          });
        }
      }
    }
    if (oversell.length > 0) {
      return reply.code(409).send({
        error: {
          code: "insufficient_stock",
          message: `One or more lines exceed available stock: ${oversell
            .map((o) => `${o.sku} (need ${o.requested}, have ${o.available})`)
            .join("; ")}`,
          details: oversell,
        },
      });
    }

    // ---- Compute totals using per-line GST rates. ---------------------------------
    type LineCalc = {
      productId: string;
      variantId: string | null;
      qty: number;
      rate: number;
      amount: number;
      gstRate: number;
    };
    const lines: LineCalc[] = body.items.map((it) => {
      const p = pMap.get(it.productId)!;
      const v = it.variantId ? vMap.get(it.variantId) : null;
      const rate = v?.sellingPriceOverride ?? p.sellingPrice ?? 0;
      return {
        productId: it.productId,
        variantId: it.variantId ?? null,
        qty: it.qty,
        rate,
        amount: it.qty * rate,
        gstRate: resolveGstRate({ gstRate: p.gstRate }, v ? { gstRate: v.gstRate } : null),
      };
    });
    const subTotal = lines.reduce((s, l) => s + l.amount, 0);
    const tax = computeTax(lines.map((l) => ({ amount: l.amount, gstRate: l.gstRate })));
    const total = subTotal + tax;

    // Atomic write: customer/account upsert -> SO -> invoice -> stock decs.
    const sysUserId = await getSystemUserId();
    if (!sysUserId) {
      return reply.code(500).send({
        error: {
          code: "no_system_user",
          message:
            "Seeded admin user not found - storefront mock cannot create pick lists.",
        },
      });
    }

    const result = await db.$transaction(async (tx) => {
      // 1. Customer + CustomerAccount upsert by email.
      let account = await tx.customerAccount.findUnique({
        where: { email: body.email },
        include: { customer: true },
      });
      let customer;
      if (account) {
        customer = account.customer;
        // Refresh any updated phone/city/name on the linked Customer
        // row so the order reflects what the user just typed.
        customer = await tx.customer.update({
          where: { id: customer.id },
          data: {
            name: body.name,
            contact: body.phone,
            city: body.city ?? customer.city,
          },
        });
      } else {
        const code = await nextCustomerCode();
        customer = await tx.customer.create({
          data: {
            code,
            name: body.name,
            contact: body.phone,
            city: body.city ?? null,
          },
        });
        account = await tx.customerAccount.create({
          data: {
            customerId: customer.id,
            email: body.email,
          },
          include: { customer: true },
        });
      }

      // 2. Sales order (confirmed, source=ecommerce).
      const soNo = await nextSoNo();
      const so = await tx.salesOrder.create({
        data: {
          soNo,
          shareToken: mintShareToken(),
          customerId: customer.id,
          status: "confirmed",
          source: "ecommerce",
          notes: body.notes ?? null,
          subTotal,
          tax,
          total,
          items: {
            create: lines.map((l) => ({
              productId: l.productId,
              variantId: l.variantId,
              qtyOrdered: l.qty,
              rate: l.rate,
              amount: l.amount,
            })),
          },
        },
      });

      // 3. Stock decrement (variant first, fall back to product).
      for (const l of lines) {
        const dec = Math.round(l.qty);
        if (l.variantId) {
          await tx.productVariant.update({
            where: { id: l.variantId },
            data: { stockOnHand: { decrement: dec } },
          });
        } else {
          await tx.product.update({
            where: { id: l.productId },
            data: { stockOnHand: { decrement: dec } },
          });
        }
      }

      // 4. Paid invoice. paymentMode=upi as a placeholder; the mock
      //    payment provider would set this to whatever the real
      //    rail used.
      const invoiceNo = await nextInvoiceNo();
      const invoice = await tx.invoice.create({
        data: {
          invoiceNo,
          shareToken: mintShareToken(),
          customerId: customer.id,
          salesOrderId: so.id,
          amount: total,
          tax,
          status: "paid",
          paymentMode: "upi",
          items: {
            create: lines.map((l) => ({
              productId: l.productId,
              variantId: l.variantId,
              qty: l.qty,
              rate: l.rate,
              amount: l.amount,
              gstRate: l.gstRate,
              taxAmount: lineTax(l.amount, l.gstRate),
            })),
          },
        },
      });

      // Sale ledger rows are NOT posted here. The storefront doesn't
      // know which bin/warehouse will fulfil the order — that is
      // decided at pick/pack time (often WH-FG). Ledger posts happen
      // in POST /packing-slips/:id/pack from the pick bin's warehouse.

      // qtyInvoiced is intentionally left at 0 on the SO lines even
      // though the invoice exists. Reason: qtyInvoiced doubles as
      // "qty already drawn down on the pick pipeline" in the existing
      // pick-list creator (it computes remaining = qtyOrdered -
      // qtyInvoiced - qtyCancelled - onPick). Bumping it here would
      // make the pick list creator think there's nothing left to
      // pick. The qtyInvoiced increment happens at pack-complete for
      // ecommerce SOs instead, mirroring how B2B orders bump it at
      // /packing-slips/:id/invoice.

      return { customer, account, so, invoice };
    });

    // 7. Outside the transaction so we don't hold locks while the
    //    pick-list helper itself runs nested writes. The pick list is
    //    drafted from the freshly-created SO; if it fails, the SO and
    //    invoice are still valid (warehouse can re-issue the pick
    //    list manually from the desktop).
    const pickResult = await createPickListForSalesOrder(
      result.so.id,
      sysUserId
    );

    await recordChange("SalesOrder", result.so.id, "insert", result.so, sysUserId);
    await recordChange("Invoice", result.invoice.id, "insert", result.invoice, sysUserId);
    // recordChange's verb enum doesn't include "upsert"; the storefront-mock
    // path either inserts a brand-new Customer or updates an existing one, so
    // surface the more accurate "insert" / "update" verb at the call site.
    await recordChange("Customer", result.customer.id, "update", result.customer, sysUserId);
    if (pickResult.ok) {
      await recordChange(
        "PickList",
        pickResult.pickList.id,
        "insert",
        pickResult.pickList,
        sysUserId
      );
    }

    return reply.code(201).send({
      customer: {
        id: result.customer.id,
        code: result.customer.code,
        name: result.customer.name,
      },
      customerAccount: {
        id: result.account.id,
        email: result.account.email,
      },
      salesOrder: {
        id: result.so.id,
        soNo: result.so.soNo,
        status: result.so.status,
        total: result.so.total,
        shareToken: result.so.shareToken,
      },
      invoice: {
        id: result.invoice.id,
        invoiceNo: result.invoice.invoiceNo,
        amount: result.invoice.amount,
        status: result.invoice.status,
        shareToken: result.invoice.shareToken,
      },
      pickList: pickResult.ok
        ? pickResult.pickList
        : { error: pickResult.error },
    });
  });

  // Active storefront categories for home page / nav (admin-configurable).
  app.get("/storefront-mock/categories", async () => {
    return db.productCategory.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        slug: true,
        name: true,
        sortOrder: true,
        imageUrl: true,
      },
    });
  });

  // Public enquiry capture — lets the storefront submit a lead (product
  // interest, dealership application, farm-visit request, …) without auth.
  // Lands in the CRM pipeline at stage "new", source "website".
  app.post("/storefront-mock/enquiries", async (req, reply) => {
    const body = z
      .object({
        type: z.enum(["product", "dealership", "farm_visit", "other"]).default("product"),
        contactName: z.string().trim().min(1).max(160),
        phone: z.string().trim().max(40).optional(),
        email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
        company: z.string().trim().max(160).optional(),
        city: z.string().trim().max(120).optional(),
        subject: z.string().trim().min(1).max(200),
        requirement: z.string().trim().max(4000).optional(),
      })
      .parse(req.body);

    if (!body.phone && !body.email) {
      return reply.code(400).send({
        error: { code: "contact_required", message: "Provide a phone or email so we can reach you." },
      });
    }

    const year = new Date().getUTCFullYear();
    const prefix = `ENQ-${year}-`;
    const last = await db.enquiry.findFirst({
      where: { enquiryNo: { startsWith: prefix } },
      orderBy: { enquiryNo: "desc" },
      select: { enquiryNo: true },
    });
    const n = last ? parseInt(last.enquiryNo.slice(prefix.length), 10) || 0 : 0;
    const enquiryNo = `${prefix}${String(n + 1).padStart(4, "0")}`;

    const created = await db.enquiry.create({
      data: {
        enquiryNo,
        type: body.type,
        source: "website",
        priority: "medium",
        contactName: body.contactName,
        phone: body.phone || null,
        email: body.email ? body.email : null,
        company: body.company || null,
        city: body.city || null,
        subject: body.subject,
        requirement: body.requirement || null,
        activities: {
          create: { type: "note", body: "Enquiry submitted via website." },
        },
      },
      select: { id: true, enquiryNo: true },
    });
    return reply.code(201).send({ ok: true, enquiryNo: created.enquiryNo });
  });

  // Public catalog used by the dummy store page so it doesn't need a
  // login to render variants. Filters out inactive products and
  // variants/products with zero stock so the demo can't accidentally
  // place orders that will immediately fail the oversell check.
  app.get("/storefront-mock/catalog", async () => {
    const products = await db.product.findMany({
      where: { state: "active", category: { active: true } },
      orderBy: { sku: "asc" },
      include: {
        category: { select: { id: true, slug: true, name: true } },
        variants: {
          select: {
            id: true,
            sku: true,
            size: true,
            color: true,
            grade: true,
            uom: true,
            packSize: true,
            stockOnHand: true,
            sellingPriceOverride: true,
            active: true,
            gstRate: true,
          },
        },
      },
    });
    return products
      .filter((p) => p.category)
      .map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        categoryId: p.categoryId,
        categorySlug: p.category!.slug,
        categoryName: p.category!.name,
        category: p.category!.name,
        uom: p.uom,
        sellingPrice: p.sellingPrice,
        stockOnHand: p.stockOnHand,
        gstRate: p.gstRate,
        description: p.description ?? null,
        imageHint: p.imageHint ?? null,
        imageUrl: p.imageUrl ?? null,
        tags: p.tags ? p.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        variants: p.variants
          .filter((v) => v.active && (v.stockOnHand ?? 0) > 0)
          .map((v) => ({
            id: v.id,
            sku: v.sku,
            size: v.size,
            color: v.color,
            grade: v.grade,
            uom: v.uom,
            packSize: v.packSize,
            stockOnHand: v.stockOnHand,
            price: v.sellingPriceOverride ?? p.sellingPrice,
            gstRate: v.gstRate ?? p.gstRate,
          })),
      }))
      .filter((p) => p.variants.length > 0 || p.stockOnHand > 0)
      .slice(0, 200);
  });

  // Full product detail for the storefront product page.
  app.get("/storefront-mock/products/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const p = await db.product.findFirst({
      where: { OR: [{ id }, { sku: id }], state: "active" },
      include: {
        category: { select: { id: true, slug: true, name: true } },
        variants: {
          select: {
            id: true,
            sku: true,
            size: true,
            color: true,
            grade: true,
            uom: true,
            packSize: true,
            stockOnHand: true,
            sellingPriceOverride: true,
            active: true,
            gstRate: true,
          },
        },
      },
    });
    if (!p) return reply.code(404).send({ error: { code: "not_found" } });
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      categoryId: p.categoryId,
      categorySlug: p.category?.slug ?? null,
      categoryName: p.category?.name ?? null,
      category: p.category?.name ?? null,
      uom: p.uom,
      sellingPrice: p.sellingPrice,
      stockOnHand: p.stockOnHand,
      gstRate: p.gstRate,
      description: p.description ?? null,
      ingredients: p.ingredients ?? null,
      imageHint: p.imageHint ?? null,
      imageUrl: p.imageUrl ?? null,
      tags: p.tags ? p.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      variants: p.variants
        .filter((v) => v.active)
        .map((v) => ({
          id: v.id,
          sku: v.sku,
          size: v.size,
          color: v.color,
          grade: v.grade,
          uom: v.uom,
          packSize: v.packSize,
          stockOnHand: v.stockOnHand ?? 0,
          price: v.sellingPriceOverride ?? p.sellingPrice,
          gstRate: v.gstRate ?? p.gstRate,
        })),
    };
  });

  // Order history for the storefront customer dashboard. Public
  // because the storefront has no real auth - we just trust the
  // email the dummy login form captured. Returns the customer's
  // sales orders with whatever invoice / packing slip metadata is
  // useful for rendering "Confirmed / Packed / Dispatched / Delivered"
  // on the dashboard. If the email doesn't map to any
  // CustomerAccount we return [] (a fresh customer hasn't placed an
  // order yet) rather than 404, so the UI can still render a
  // sensible empty state.
  app.get<{ Querystring: { email?: string } }>(
    "/storefront-mock/orders",
    async (req, reply) => {
      const email = (req.query.email ?? "").trim().toLowerCase();
      if (!email) {
        return reply.code(400).send({
          error: { code: "missing_email", message: "?email= is required." },
        });
      }
      const account = await db.customerAccount.findUnique({
        where: { email },
        select: { customerId: true },
      });
      if (!account) return [];

      const orders = await db.salesOrder.findMany({
        where: { customerId: account.customerId },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          invoices: {
            select: { invoiceNo: true, status: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          packingSlips: {
            select: {
              packingSlipNo: true,
              status: true,
              awb: true,
              carrier: true,
              trackingUrl: true,
              dispatchedAt: true,
              deliveredAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          items: { select: { id: true } },
        },
      });

      return orders.map((o) => ({
        id: o.id,
        soNo: o.soNo,
        status: o.status,
        total: o.total,
        createdAt: o.createdAt,
        invoiceNo: o.invoices[0]?.invoiceNo ?? null,
        invoiceStatus: o.invoices[0]?.status ?? null,
        packingSlip: o.packingSlips[0]
          ? {
              packingSlipNo: o.packingSlips[0].packingSlipNo,
              status: o.packingSlips[0].status,
              awb: o.packingSlips[0].awb,
              carrier: o.packingSlips[0].carrier,
              trackingUrl: o.packingSlips[0].trackingUrl,
              dispatchedAt: o.packingSlips[0].dispatchedAt,
              deliveredAt: o.packingSlips[0].deliveredAt,
            }
          : null,
        itemCount: o.items.length,
      }));
    }
  );
};
