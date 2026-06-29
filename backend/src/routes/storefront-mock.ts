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
//      the SO, plus a CustomerPayment + allocation so the AR statement
//      shows the matching credit (prepaid at checkout).
//   6. Stock ledger posts at pack-complete from the pick bin warehouse.
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
import { getRazorpayClient, inrToPaise } from "../lib/razorpay.js";
import {
  buildPayuRequestHash,
  formatPayuAmount,
  generatePayuTxnId,
  getPayuCredentials,
  payuCheckoutUrl,
} from "../lib/payu.js";
import {
  isGatewayConfigured,
  listActiveStorefrontGateways,
  resolveStorefrontGateway,
} from "../lib/storefront-payment.js";
import { config } from "../config.js";
import {
  storefrontOrderSchema,
  storefrontOrderItemSchema,
  validateStorefrontOrder,
  fulfillPrepaidStorefrontOrder,
  buildOrderResponse,
  confirmPaymentIntentById,
  type CartSnapshot,
} from "../services/storefront-order.js";
import { quoteStorefrontShipping } from "../lib/storefront-shipping.js";
import { logSystemError, logSystemInfo, logSystemWarn } from "../lib/system-log.js";
import {
  getCustomerOrderBySoNo,
  optionalStorefrontAuth,
  mapCustomerOrderRow,
  serializeCustomerOrders,
} from "../lib/storefront-customer.js";
import { consumeOtpToken, validateOtp } from "../lib/otp.js";
import { normalizePhone } from "../lib/phone.js";
import { canonicalCategorySlug } from "../lib/category-slug-map.js";

const shippingQuoteSchema = z.object({
  pincode: z.string().trim().min(6).max(10),
  state: z.string().trim().max(80).optional(),
  addressId: z.string().trim().optional(),
  subTotal: z.number().min(0),
  items: z.array(storefrontOrderItemSchema).min(1).max(40),
});

const orderInitSchema = storefrontOrderSchema.extend({
  gateway: z.enum(["razorpay", "payu"]).optional(),
});

const confirmSchema = z.object({
  intentId: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_order_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

const lookupSchema = z.object({
  soNo: z.string().trim().min(1),
  phone: z.string().trim().min(6).max(20),
  code: z.string().trim().length(6),
});

export const storefrontMockRoutes = async (app: FastifyInstance) => {
  app.get("/storefront-mock/payment/gateways", async () => {
    const active = await listActiveStorefrontGateways();
    const configured: string[] = [];
    for (const g of active) {
      if (await isGatewayConfigured(g)) configured.push(g);
    }
    return { active: configured };
  });

  app.post("/storefront-mock/shipping/quote", async (req, reply) => {
    const body = shippingQuoteSchema.parse(req.body);
    const user = await optionalStorefrontAuth(req);
    const result = await quoteStorefrontShipping({
      deliveryPincode: body.pincode,
      subTotal: body.subTotal,
      items: body.items,
      deliveryState: body.state,
      addressId: body.addressId ?? null,
      customerId: user?.customerId ?? null,
    });
    if (!result.ok) {
      return reply.code(400).send({
        error: { code: result.code, message: result.message },
      });
    }
    await logSystemInfo("storefront", "shipping_quote", "Shipping quote returned", {
      pincode: result.quote.deliveryPincode,
      weightKg: result.quote.weightKg,
      source: result.quote.source,
      options: result.quote.options.map((o) => ({
        id: o.id,
        fee: o.fee,
        transportTax: o.transportTax,
        payableTotal: o.payableTotal,
      })),
    });
    return result.quote;
  });

  // Legacy direct order (test seeding only) â€” requires MOCK_STOREFRONT_TOKEN when set.
  app.post("/storefront-mock/order", async (req, reply) => {
    const expectedToken = process.env.MOCK_STOREFRONT_TOKEN;
    if (expectedToken) {
      const got = req.headers["x-mock-token"];
      if (got !== expectedToken) {
        return reply
          .code(401)
          .send({ error: { code: "unauthorized", message: "Bad mock token." } });
      }
    } else {
      return reply.code(403).send({
        error: {
          code: "use_payment_gateway",
          message:
            "Direct order placement is disabled. Use /storefront-mock/order/init with Razorpay or PayU.",
        },
      });
    }

    const body = storefrontOrderSchema.parse(req.body);
    const validated = await validateStorefrontOrder(body, reply);
    if (!validated) return;

    const fulfilled = await fulfillPrepaidStorefrontOrder(body, validated, {
      mode: "upi",
      reference: "mock-storefront",
    });
    if (!fulfilled.ok) {
      return reply.code(500).send({
        error: { code: fulfilled.code, message: fulfilled.message },
      });
    }

    return reply.code(201).send(
      buildOrderResponse(fulfilled.result, fulfilled.pickList)
    );
  });

  app.post("/storefront-mock/order/init", async (req, reply) => {
    const session = await optionalStorefrontAuth(req);
    let body = orderInitSchema.parse(req.body);

    if (session) {
      const account = await db.customerAccount.findUnique({
        where: { id: session.accountId },
        include: { customer: true },
      });
      if (account) {
        body = {
          ...body,
          phone: account.phone ?? body.phone,
          name: account.customer.name || body.name,
          email: account.email ?? body.email,
        };
        if (body.addressId) {
          const addr = await db.customerAddress.findFirst({
            where: { id: body.addressId, customerId: session.customerId },
          });
          if (!addr) {
            return reply.code(400).send({
              error: { code: "invalid_address", message: "Address not found on your account." },
            });
          }
        }
      }
    }

    const gatewayPick = await resolveStorefrontGateway(body.gateway ?? null);
    if (!gatewayPick.ok) {
      return reply.code(503).send({
        error: { code: gatewayPick.code, message: gatewayPick.message },
      });
    }
    const gateway = gatewayPick.gateway;

    const validated = await validateStorefrontOrder(body, reply, {
      customerId: session?.customerId,
    });
    if (!validated) return;

    await logSystemInfo("storefront", "order_init", `${gateway} checkout initiated`, {
      gateway,
      phone: body.phone,
      deliveryMethod: body.deliveryMethod,
      pincode: body.pincode ?? null,
      addressId: body.addressId ?? null,
      totals: {
        subTotal: validated.subTotal,
        tax: validated.tax,
        transportTax: validated.transportTax,
        shippingFee: validated.shippingFee,
        total: validated.total,
      },
      weightKg: validated.weightKg,
      shipping: validated.shippingMeta ?? null,
    }, body.phone);

    const snapshot: CartSnapshot = {
      ...body,
      subTotal: validated.subTotal,
      tax: validated.tax,
      transportTax: validated.transportTax,
      total: validated.total,
      weightKg: validated.weightKg,
      shippingSource: validated.shippingMeta?.source,
    };

    const totals = {
      subTotal: validated.subTotal,
      tax: validated.tax,
      transportTax: validated.transportTax,
      shippingFee: validated.shippingFee,
      total: validated.total,
    };

    const prefill = {
      name: body.name,
      email: body.email ?? "",
      contact: body.phone,
    };

    if (gateway === "payu") {
      const payu = await getPayuCredentials();
      if (!payu) {
        return reply.code(503).send({
          error: {
            code: "payu_not_configured",
            message:
              "PayU is not configured. Set merchant key + salt in Settings → Payment (PayU) or PAYU_MERCHANT_KEY/SALT env vars.",
          },
        });
      }

      const txnid = generatePayuTxnId();
      const amount = formatPayuAmount(validated.total);
      const productinfo = "Prakruthivanam order";
      const firstname = body.name.split(/\s+/)[0] || body.name;
      const email = body.email?.trim() || `${body.phone.replace(/\D/g, "")}@customers.pvs.local`;

      const intent = await db.paymentIntent.create({
        data: {
          gateway: "payu",
          gatewayOrderId: txnid,
          amount: validated.total,
          email,
          phone: body.phone,
          cartSnapshot: JSON.stringify(snapshot),
        },
      });

      const returnBase = `${config.publicApiBase}/v1/storefront-mock/order/payu/return`;
      const hash = buildPayuRequestHash({
        key: payu.merchantKey,
        salt: payu.salt,
        txnid,
        amount,
        productinfo,
        firstname,
        email,
        udf1: intent.id,
      });

      return {
        gateway: "payu" as const,
        intentId: intent.id,
        checkoutUrl: payuCheckoutUrl(payu.mode),
        fields: {
          key: payu.merchantKey,
          txnid,
          amount,
          productinfo,
          firstname,
          email,
          phone: body.phone,
          surl: returnBase,
          furl: returnBase,
          hash,
          udf1: intent.id,
          service_provider: "payu_paisa",
        },
        totals,
        prefill,
      };
    }

    const rzp = await getRazorpayClient();
    if (!rzp) {
      return reply.code(503).send({
        error: {
          code: "razorpay_not_configured",
          message:
            "Razorpay is not configured. Set keys in Settings â†’ Payment (Razorpay) or RAZORPAY_KEY_ID/SECRET env vars.",
        },
      });
    }

    const receipt = `pv-${Date.now()}`;
    const order = await rzp.client.orders.create({
      amount: inrToPaise(validated.total),
      currency: "INR",
      receipt,
      notes: { phone: body.phone, email: body.email ?? "" },
    });

    const intent = await db.paymentIntent.create({
      data: {
        gateway: "razorpay",
        gatewayOrderId: order.id,
        amount: validated.total,
        email: body.email || null,
        phone: body.phone,
        cartSnapshot: JSON.stringify(snapshot),
      },
    });

    return {
      gateway: "razorpay" as const,
      intentId: intent.id,
      razorpayOrderId: order.id,
      keyId: rzp.creds.keyId,
      amount: inrToPaise(validated.total),
      currency: "INR",
      totals,
      prefill,
    };
  });

  app.post("/storefront-mock/order/confirm", async (req, reply) => {
    const body = confirmSchema.parse(req.body);
    const creds = await getRazorpayClient();
    if (!creds) {
      return reply.code(503).send({
        error: { code: "razorpay_not_configured", message: "Razorpay is not configured." },
      });
    }

    const result = await confirmPaymentIntentById(
      body.intentId,
      body.razorpay_payment_id,
      body.razorpay_order_id,
      body.razorpay_signature,
      creds.creds.keySecret
    );

    if (!result.ok) {
      await logSystemError("storefront", "order_confirm", result.message, {
        intentId: body.intentId,
        code: result.code,
      }, body.intentId);
      return reply.code(result.status).send({
        error: { code: result.code, message: result.message },
      });
    }

    await logSystemInfo("storefront", "order_confirm", "Storefront order confirmed after payment", {
      intentId: body.intentId,
      soNo: result.response.salesOrder.soNo,
    }, result.response.salesOrder.soNo);

    return reply.code(201).send(result.response);
  });
  // Active storefront categories for home page / nav (admin-configurable).
  app.get("/storefront-mock/categories", async () => {
    const rows = await db.productCategory.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        slug: true,
        name: true,
        sortOrder: true,
        imageUrl: true,
        updatedAt: true,
      },
    });
    return rows.map((c) => ({
      ...c,
      slug: canonicalCategorySlug(c.slug),
    }));
  });

  // Active storefront concerns for "Shop by Concern" navigation.
  app.get("/storefront-mock/concerns", async () => {
    return db.productConcern.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        icon: true,
        sortOrder: true,
        imageUrl: true,
      },
    });
  });

  // Public enquiry capture â€” lets the storefront submit a lead (product
  // interest, dealership application, farm-visit request, â€¦) without auth.
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
      where: { state: "active", ecommerceEnabled: true, category: { active: true } },
      orderBy: { sku: "asc" },
      include: {
        category: { select: { id: true, slug: true, name: true } },
        concernLinks: {
          select: { concern: { select: { id: true, slug: true, name: true, active: true } } },
        },
        variants: {
          select: {
            id: true,
            sku: true,
            barcode: true,
            size: true,
            color: true,
            grade: true,
            uom: true,
            packSize: true,
            stockOnHand: true,
            sellingPriceOverride: true,
            active: true,
            ecommerceEnabled: true,
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
        barcode: p.barcode,
        name: p.name,
        categoryId: p.categoryId,
        categorySlug: canonicalCategorySlug(p.category!.slug),
        categoryName: p.category!.name,
        category: p.category!.name,
        uom: p.uom,
        sellingPrice: p.sellingPrice,
        stockOnHand: p.stockOnHand,
        gstRate: p.gstRate,
        description: p.description ?? null,
        imageHint: p.imageHint ?? null,
        imageUrl: p.imageUrl ?? null,
        imageUpdatedAt: p.updatedAt ? p.updatedAt.getTime() : null,
        tags: p.tags ? p.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        concernSlugs: p.concernLinks
          .filter((l) => l.concern.active)
          .map((l) => l.concern.slug),
        concernNames: p.concernLinks
          .filter((l) => l.concern.active)
          .map((l) => l.concern.name),
        variants: p.variants
          .filter((v) => v.active && v.ecommerceEnabled && (v.stockOnHand ?? 0) > 0)
          .map((v) => ({
            id: v.id,
            sku: v.sku,
            barcode: v.barcode,
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
      where: { OR: [{ id }, { sku: id }], state: "active", ecommerceEnabled: true },
      include: {
        category: { select: { id: true, slug: true, name: true } },
        concernLinks: {
          select: { concern: { select: { id: true, slug: true, name: true, active: true } } },
        },
        variants: {
          select: {
            id: true,
            sku: true,
            barcode: true,
            size: true,
            color: true,
            grade: true,
            uom: true,
            packSize: true,
            stockOnHand: true,
            sellingPriceOverride: true,
            active: true,
            ecommerceEnabled: true,
            gstRate: true,
          },
        },
      },
    });
    if (!p) return reply.code(404).send({ error: { code: "not_found" } });
    return {
      id: p.id,
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      categoryId: p.categoryId,
      categorySlug: p.category ? canonicalCategorySlug(p.category.slug) : null,
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
      concernSlugs: p.concernLinks
        .filter((l) => l.concern.active)
        .map((l) => l.concern.slug),
      concernNames: p.concernLinks
        .filter((l) => l.concern.active)
        .map((l) => l.concern.name),
      variants: p.variants
        .filter((v) => v.active && v.ecommerceEnabled)
        .map((v) => ({
          id: v.id,
          sku: v.sku,
          barcode: v.barcode,
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
      const session = await optionalStorefrontAuth(req);
      if (session) {
        return serializeCustomerOrders(session.customerId);
      }

      const email = (req.query.email ?? "").trim().toLowerCase();
      if (!email) {
        return reply.code(400).send({
          error: { code: "unauthorized", message: "Sign in or provide ?email= (legacy)." },
        });
      }
      const account = await db.customerAccount.findFirst({
        where: { email },
        select: { customerId: true },
      });
      if (!account) return [];
      return serializeCustomerOrders(account.customerId);
    }
  );

  app.get<{ Params: { soNo: string } }>(
    "/storefront-mock/orders/:soNo",
    async (req, reply) => {
      const session = await optionalStorefrontAuth(req);
      if (!session) {
        return reply.code(401).send({
          error: { code: "unauthorized", message: "Sign in to view order details." },
        });
      }
      const row = await getCustomerOrderBySoNo(session.customerId, req.params.soNo);
      if (!row) {
        return reply.code(404).send({
          error: { code: "not_found", message: "Order not found." },
        });
      }
      return row;
    }
  );

  app.post("/storefront-mock/orders/lookup", async (req, reply) => {
    const body = lookupSchema.parse(req.body);
    const phone = normalizePhone(body.phone);
    if (!phone) {
      return reply.code(400).send({ error: { code: "invalid_phone", message: "Invalid mobile number." } });
    }

    const otp = await validateOtp(phone, "track", body.code);
    if (!otp.ok) {
      const messages: Record<string, string> = {
        invalid: "Invalid OTP.",
        expired: "OTP expired or already used. Request a new code.",
        locked: "Too many failed attempts. Try again in 15 minutes.",
        max_attempts: "Incorrect OTP.",
      };
      return reply.code(400).send({
        error: { code: otp.reason, message: messages[otp.reason] ?? "OTP verification failed." },
      });
    }

    const account = await db.customerAccount.findUnique({ where: { phone } });
    const customerIds = account
      ? [account.customerId]
      : (
          await db.customer.findMany({
            where: { contact: phone },
            select: { id: true },
          })
        ).map((c) => c.id);

    if (customerIds.length === 0) {
      return reply.code(404).send({ error: { code: "not_found", message: "Order not found." } });
    }

    const order = await db.salesOrder.findFirst({
      where: { soNo: body.soNo.trim(), customerId: { in: customerIds } },
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
        items: {
          select: {
            productId: true,
            variantId: true,
            qtyOrdered: true,
            rate: true,
            amount: true,
            product: { select: { name: true, sku: true, barcode: true } },
            variant: { select: { size: true, sku: true, barcode: true } },
          },
          orderBy: { id: "asc" },
        },
      },
    });

    if (!order) {
      return reply.code(404).send({ error: { code: "not_found", message: "Order not found." } });
    }

    await consumeOtpToken(otp.tokenId);

    return mapCustomerOrderRow(order);
  });
};
