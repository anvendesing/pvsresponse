// Shared storefront order validation + prepaid fulfillment (Razorpay + legacy mock).

import type { FastifyReply } from "fastify";
import { normalizePhone } from "../lib/phone.js";
import {
  isPlaceholderCustomerName,
  mirrorDefaultAddressToCustomer,
} from "../lib/storefront-customer.js";
import { computeAddressDistanceFields } from "../lib/address-distance.js";
import { z } from "zod";
import { db } from "../db.js";
import { mintShareToken } from "../lib/share.js";
import { verifyCheckoutSignature } from "../lib/razorpay.js";
import { verifyPayuResponseHash, type PayuCredentials, type PayuResponseFields } from "../lib/payu.js";
import { recordChange } from "../sync/log.js";
import { createPickListForSalesOrder } from "./pick-list-create.js";
import { resolveGstRate } from "../lib/tax.js";
import { getTaxContextForCustomer } from "../lib/company-tax.js";
import { computeDocumentTax, lineTaxDbFields } from "../lib/document-tax.js";
import {
  quoteStorefrontShipping,
  resolveOrderPincode,
  resolveOrderState,
  shippingFeeForMethod,
  computeCartWeightKg,
  type DeliveryMethod,
} from "../lib/storefront-shipping.js";
import { logSystemError, logSystemInfo, logSystemWarn } from "../lib/system-log.js";
import { nextPaymentNo } from "../routes/customer-payments.js";
import { pincodeSchema } from "../lib/customer-address.js";

export const storefrontOrderItemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().nullable().optional(),
  qty: z.number().positive(),
});

export const storefrontOrderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  phone: z.string().trim().min(6).max(20),
  addressLine: z.string().trim().min(1).max(200).optional(),
  city: z.string().trim().min(1).max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: pincodeSchema.optional(),
  addressId: z.string().trim().min(1).optional(),
  notes: z.string().trim().max(500).optional(),
  deliveryMethod: z.enum(["standard", "express"]).default("standard"),
  shippingFee: z.number().min(0).default(0),
  items: z.array(storefrontOrderItemSchema).min(1).max(40),
});

export type StorefrontOrderInput = z.infer<typeof storefrontOrderSchema>;

export type CartSnapshot = StorefrontOrderInput & {
  subTotal: number;
  tax: number;
  transportTax: number;
  total: number;
  weightKg?: number;
  shippingSource?: string;
};

export type LineCalc = {
  productId: string;
  variantId: string | null;
  qty: number;
  rate: number;
  amount: number;
  gstRate: number;
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  taxAmount: number;
};

export type ValidatedOrder = {
  lines: LineCalc[];
  subTotal: number;
  tax: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  taxKind: "intra" | "inter";
  placeOfSupplyState: string | null;
  sellerState: string | null;
  pricingInclusive: boolean;
  transportTax: number;
  shippingFee: number;
  total: number;
  weightKg: number;
  shippingMeta?: {
    pickupPincode: string;
    deliveryPincode: string;
    courierName: string | null;
    source: string;
  };
};

type OversellIssue = { sku: string; requested: number; available: number };

export async function validateStorefrontOrder(
  body: StorefrontOrderInput,
  reply: FastifyReply,
  opts?: { customerId?: string; fixedShippingFee?: number }
): Promise<ValidatedOrder | null> {
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
          ecommerceEnabled: true,
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
      ecommerceEnabled: true,
    },
  });
  const vMap = new Map(variants.map((v) => [v.id, v]));
  const pMap = new Map(products.map((p) => [p.id, p]));

  const oversell: OversellIssue[] = [];
  for (const it of body.items) {
    const p = pMap.get(it.productId);
    if (!p) {
      void reply.code(400).send({
        error: {
          code: "product_not_found",
          message: `Unknown productId ${it.productId}.`,
        },
      });
      return null;
    }
    if (p.state !== "active") {
      void reply.code(409).send({
        error: {
          code: "product_inactive",
          message: `${p.sku} is not on sale (state=${p.state}).`,
        },
      });
      return null;
    }
    if (!p.ecommerceEnabled) {
      void reply.code(409).send({
        error: {
          code: "product_not_in_ecommerce",
          message: `${p.sku} is not listed for e-commerce.`,
        },
      });
      return null;
    }
    if (it.variantId) {
      const v = vMap.get(it.variantId);
      if (!v || v.productId !== it.productId) {
        void reply.code(400).send({
          error: {
            code: "variant_mismatch",
            message: `Variant ${it.variantId} does not belong to product ${p.sku}.`,
          },
        });
        return null;
      }
      if (!v.active) {
        void reply.code(409).send({
          error: {
            code: "variant_inactive",
            message: `Variant ${v.sku} is no longer on sale.`,
          },
        });
        return null;
      }
      if (!v.ecommerceEnabled) {
        void reply.code(409).send({
          error: {
            code: "variant_not_in_ecommerce",
            message: `Variant ${v.sku} is not listed for e-commerce.`,
          },
        });
        return null;
      }
      if (it.qty > (v.stockOnHand ?? 0)) {
        oversell.push({
          sku: v.sku,
          requested: it.qty,
          available: v.stockOnHand ?? 0,
        });
      }
    } else if (it.qty > (p.stockOnHand ?? 0)) {
      oversell.push({
        sku: p.sku,
        requested: it.qty,
        available: p.stockOnHand ?? 0,
      });
    }
  }

  if (oversell.length > 0) {
    void reply.code(409).send({
      error: {
        code: "insufficient_stock",
        message: `One or more lines exceed available stock: ${oversell
          .map((o) => `${o.sku} (need ${o.requested}, have ${o.available})`)
          .join("; ")}`,
        details: oversell,
      },
    });
    return null;
  }

  const deliveryState = await resolveOrderState({
    state: body.state,
    addressId: body.addressId,
    customerId: opts?.customerId,
  });
  const taxCtx = await getTaxContextForCustomer(deliveryState);
  // If no ship-to state, treat as inter-state (safer for tax compliance).
  if (!deliveryState) taxCtx.taxKind = "inter";

  const lineInputs = body.items.map((it) => {
    const p = pMap.get(it.productId)!;
    const v = it.variantId ? vMap.get(it.variantId) : null;
    const rate = v?.sellingPriceOverride ?? p.sellingPrice ?? 0;
    return {
      productId: it.productId,
      variantId: it.variantId ?? null,
      qty: it.qty,
      rate,
      gstRate: resolveGstRate(
        { gstRate: p.gstRate },
        v ? { gstRate: v.gstRate } : null,
        taxCtx.defaultGstRate ?? 18
      ),
    };
  });

  let shippingFee: number;
  let transportTax: number;
  let total: number;
  let subTotal: number;
  let tax: number;
  let cgstTotal: number;
  let sgstTotal: number;
  let igstTotal: number;
  let weightKg = await computeCartWeightKg(body.items);
  let shippingMeta: ValidatedOrder["shippingMeta"];

  if (opts?.fixedShippingFee !== undefined) {
    const doc = computeDocumentTax({
      items: lineInputs,
      transportCharge: opts.fixedShippingFee,
      taxCtx,
    });
    subTotal = doc.subTotal;
    tax = doc.tax;
    cgstTotal = doc.cgstTotal;
    sgstTotal = doc.sgstTotal;
    igstTotal = doc.igstTotal;
    shippingFee = opts.fixedShippingFee;
    transportTax = doc.transportTax;
    total = doc.total;
  } else {
    const deliveryPincode = await resolveOrderPincode({
      pincode: body.pincode,
      addressId: body.addressId,
      customerId: opts?.customerId,
    });
    if (!deliveryPincode) {
      void reply.code(400).send({
        error: {
          code: "pincode_required",
          message: "Delivery pincode is required to calculate shipping.",
        },
      });
      return null;
    }

    const quoteResult = await quoteStorefrontShipping({
      deliveryPincode,
      subTotal: 0,
      items: body.items,
      deliveryState,
    });
    if (!quoteResult.ok) {
      await logSystemWarn("storefront", "shipping_quote", quoteResult.message, {
        pincode: deliveryPincode,
        itemCount: body.items.length,
      });
      void reply.code(400).send({
        error: { code: quoteResult.code, message: quoteResult.message },
      });
      return null;
    }

    const deliveryMethod = (body.deliveryMethod ?? "standard") as DeliveryMethod;
    const selected = quoteResult.quote.options.find((o) => o.id === deliveryMethod);
    shippingFee = shippingFeeForMethod(quoteResult.quote, deliveryMethod);
    subTotal = quoteResult.quote.subTotal;
    tax = quoteResult.quote.goodsTax;
    cgstTotal = quoteResult.quote.cgstTotal;
    sgstTotal = quoteResult.quote.sgstTotal;
    igstTotal = quoteResult.quote.igstTotal;
    transportTax = selected?.transportTax ?? 0;
    total = selected?.payableTotal ?? subTotal + tax + shippingFee + transportTax;
    weightKg = quoteResult.quote.weightKg;
    shippingMeta = {
      pickupPincode: quoteResult.quote.pickupPincode,
      deliveryPincode: quoteResult.quote.deliveryPincode,
      courierName: selected?.courierName ?? null,
      source: quoteResult.quote.source,
    };
  }

  const doc = computeDocumentTax({
    items: lineInputs,
    transportCharge: shippingFee,
    taxCtx,
  });
  const lines: LineCalc[] = doc.lineResults.map((line, idx) => {
    const src = lineInputs[idx];
    const fields = lineTaxDbFields(line);
    return {
      productId: src.productId,
      variantId: src.variantId,
      qty: src.qty,
      rate: fields.rate,
      amount: fields.amount,
      gstRate: fields.gstRate ?? line.gstRate,
      taxableValue: fields.taxableValue ?? fields.amount,
      cgstAmount: fields.cgstAmount ?? 0,
      sgstAmount: fields.sgstAmount ?? 0,
      igstAmount: fields.igstAmount ?? 0,
      taxAmount: fields.taxAmount ?? 0,
    };
  });

  return {
    lines,
    subTotal: doc.subTotal,
    tax: doc.tax,
    cgstTotal: doc.cgstTotal,
    sgstTotal: doc.sgstTotal,
    igstTotal: doc.igstTotal,
    taxKind: doc.taxKind,
    placeOfSupplyState: doc.placeOfSupplyState,
    sellerState: doc.sellerState,
    pricingInclusive: doc.pricingInclusive,
    transportTax: doc.transportTax,
    shippingFee,
    total: doc.total,
    weightKg,
    shippingMeta,
  };
}

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

let systemUserIdCache: string | null | undefined;
export const getSystemUserId = async (): Promise<string | null> => {
  if (systemUserIdCache !== undefined) return systemUserIdCache;
  const u = await db.user.findFirst({
    where: { username: "admin" },
    select: { id: true },
  });
  systemUserIdCache = u?.id ?? null;
  return systemUserIdCache;
};

export type PaymentMeta = {
  mode: "razorpay" | "payu" | "upi";
  reference: string;
  gateway?: string;
  gatewayPaymentId?: string;
  gatewayOrderId?: string;
  notesSuffix?: string;
};

export type FulfillResult = {
  customer: { id: string; code: string; name: string };
  account: { id: string; email: string | null; phone: string | null };
  so: { id: string; soNo: string; status: string; total: number; shareToken: string | null };
  invoice: {
    id: string;
    invoiceNo: string;
    amount: number;
    status: string;
    shareToken: string | null;
  };
  payment: { id: string; paymentNo: string };
};

export async function fulfillPrepaidStorefrontOrder(
  body: StorefrontOrderInput,
  validated: ValidatedOrder,
  paymentMeta: PaymentMeta,
  options?: { trustedCustomerId?: string; trustedPhone?: string }
): Promise<{ ok: true; result: FulfillResult; pickList: unknown } | { ok: false; code: string; message: string }> {
  const sysUserId = await getSystemUserId();
  if (!sysUserId) {
    return {
      ok: false,
      code: "no_system_user",
      message: "Seeded admin user not found - storefront cannot create pick lists.",
    };
  }

  const {
    lines,
    subTotal,
    tax,
    cgstTotal,
    sgstTotal,
    igstTotal,
    taxKind,
    placeOfSupplyState,
    sellerState,
    pricingInclusive,
    transportTax,
    shippingFee,
    total,
    weightKg,
    shippingMeta,
  } = validated;
  const phone = options?.trustedPhone ?? normalizePhone(body.phone) ?? body.phone.trim();
  const email = body.email && body.email.length > 0 ? body.email : null;

  let resolvedAddress: {
    id?: string;
    addressLine: string;
    city: string;
    state: string | null;
    pincode: string;
    name: string;
    phone: string;
    isDefault: boolean;
    distanceKm?: number | null;
    dispatchPincode?: string | null;
  } | null = null;

  if (body.addressId && options?.trustedCustomerId) {
    const owned = await db.customerAddress.findFirst({
      where: { id: body.addressId, customerId: options.trustedCustomerId },
    });
    if (!owned) {
      return {
        ok: false,
        code: "invalid_address",
        message: "Selected delivery address was not found on your account.",
      };
    }
    resolvedAddress = {
      id: owned.id,
      addressLine: owned.addressLine,
      city: owned.city,
      state: owned.state,
      pincode: owned.pincode,
      name: owned.name,
      phone: owned.phone,
      isDefault: owned.isDefault,
      distanceKm: owned.distanceKm,
      dispatchPincode: owned.dispatchPincode,
    };
  }

  const shipLine = resolvedAddress?.addressLine ?? body.addressLine ?? null;
  const shipCity = resolvedAddress?.city ?? body.city ?? null;
  const shipState = resolvedAddress?.state ?? body.state ?? null;
  const shipPincode = resolvedAddress?.pincode ?? body.pincode ?? null;
  const shipName = resolvedAddress?.name ?? body.name;
  const shipPhone = resolvedAddress?.phone ?? phone;

  const addressNotes = [shipLine, shipCity, shipState, shipPincode].filter(Boolean).join(", ");
  const orderNotes = [
    body.notes,
    shipName !== body.name ? `Recipient: ${shipName}` : null,
    addressNotes ? `Ship to: ${addressNotes}` : null,
    shippingMeta
      ? `Shipping: ${body.deliveryMethod ?? "standard"} · ${shippingMeta.courierName ?? "courier"} · ${weightKg} kg · ${shippingMeta.pickupPincode}→${shippingMeta.deliveryPincode}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const txResult = await db.$transaction(async (tx) => {
    let account = options?.trustedCustomerId
      ? await tx.customerAccount.findFirst({
          where: { customerId: options.trustedCustomerId },
          include: { customer: true },
        })
      : await tx.customerAccount.findUnique({
          where: { phone },
          include: { customer: true },
        });

    let customer;
    if (account) {
      const profileName = body.name.trim();
      const customerPatch: {
        contact: string;
        name?: string;
        addressLine?: string | null;
        city?: string | null;
        state?: string | null;
        pincode?: string | null;
      } = { contact: phone };

      if (
        profileName &&
        isPlaceholderCustomerName(account.customer.name, phone)
      ) {
        customerPatch.name = profileName;
      }

      customer = await tx.customer.update({
        where: { id: account.customer.id },
        data: customerPatch,
      });

      if (email && email !== account.email) {
        account = await tx.customerAccount.update({
          where: { id: account.id },
          data: { email },
          include: { customer: true },
        });
      }

      if (resolvedAddress?.isDefault) {
        await mirrorDefaultAddressToCustomer(account.customerId, resolvedAddress, tx);
        customer = await tx.customer.findUniqueOrThrow({ where: { id: account.customerId } });
      }
    } else {
      const code = await nextCustomerCode();
      const distance = await computeAddressDistanceFields(shipPincode);
      customer = await tx.customer.create({
        data: {
          code,
          name: body.name.trim(),
          contact: shipPhone,
          addressLine: shipLine,
          city: shipCity,
          state: shipState,
          pincode: shipPincode,
          distanceKm: distance.distanceKm,
          dispatchPincode: distance.dispatchPincode,
        },
      });
      account = await tx.customerAccount.create({
        data: {
          customerId: customer.id,
          phone,
          email,
          phoneVerifiedAt: options?.trustedCustomerId ? new Date() : null,
        },
        include: { customer: true },
      });
    }

    const soNo = await nextSoNo();
    const so = await tx.salesOrder.create({
      data: {
        soNo,
        shareToken: mintShareToken(),
        customerId: customer.id,
        status: "confirmed",
        source: "ecommerce",
        notes: orderNotes || null,
        subTotal,
        tax,
        cgstTotal,
        sgstTotal,
        igstTotal,
        taxKind,
        placeOfSupplyState,
        sellerState,
        pricingInclusive,
        transportCharge: shippingFee,
        transportTax,
        totalWeightKg: weightKg,
        total,
        items: {
          create: lines.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            qtyOrdered: l.qty,
            rate: l.rate,
            amount: l.amount,
            taxableValue: l.taxableValue,
            gstRate: l.gstRate,
            cgstAmount: l.cgstAmount,
            sgstAmount: l.sgstAmount,
            igstAmount: l.igstAmount,
          })),
        },
      },
    });

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

    const invoiceNo = await nextInvoiceNo();
    const invoice = await tx.invoice.create({
      data: {
        invoiceNo,
        shareToken: mintShareToken(),
        customerId: customer.id,
        salesOrderId: so.id,
        amount: total,
        tax,
        cgstTotal,
        sgstTotal,
        igstTotal,
        taxKind,
        placeOfSupplyState,
        sellerState,
        pricingInclusive,
        transportCharge: shippingFee,
        transportTax,
        totalWeightKg: weightKg,
        status: "paid",
        paymentMode: paymentMeta.mode,
        items: {
          create: lines.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            qty: l.qty,
            rate: l.rate,
            amount: l.amount,
            taxableValue: l.taxableValue,
            gstRate: l.gstRate,
            taxAmount: l.taxAmount,
            cgstAmount: l.cgstAmount,
            sgstAmount: l.sgstAmount,
            igstAmount: l.igstAmount,
          })),
        },
      },
    });

    const paymentNo = await nextPaymentNo();
    const payment = await tx.customerPayment.create({
      data: {
        paymentNo,
        customerId: customer.id,
        amount: total,
        mode: paymentMeta.mode,
        reference: paymentMeta.reference,
        gateway: paymentMeta.gateway ?? null,
        gatewayPaymentId: paymentMeta.gatewayPaymentId ?? null,
        gatewayOrderId: paymentMeta.gatewayOrderId ?? null,
        notes: paymentMeta.notesSuffix
          ? `Storefront prepaid · ${soNo} · ${paymentMeta.notesSuffix}`
          : `Storefront prepaid · ${soNo}`,
        allocations: {
          create: [{ invoiceId: invoice.id, amount: total }],
        },
      },
    });

    return { customer, account, so, invoice, payment };
  });

  const pickResult = await createPickListForSalesOrder(txResult.so.id, sysUserId);

  await recordChange("SalesOrder", txResult.so.id, "insert", txResult.so, sysUserId);
  await recordChange("Invoice", txResult.invoice.id, "insert", txResult.invoice, sysUserId);
  await recordChange(
    "CustomerPayment",
    txResult.payment.id,
    "insert",
    txResult.payment,
    sysUserId
  );
  await recordChange("Customer", txResult.customer.id, "update", txResult.customer, sysUserId);
  if (pickResult.ok) {
    await recordChange(
      "PickList",
      pickResult.pickList.id,
      "insert",
      pickResult.pickList,
      sysUserId
    );
  }

  return {
    ok: true,
    result: {
      customer: {
        id: txResult.customer.id,
        code: txResult.customer.code,
        name: txResult.customer.name,
      },
      account: {
        id: txResult.account.id,
        email: txResult.account.email,
        phone: txResult.account.phone,
      },
      so: {
        id: txResult.so.id,
        soNo: txResult.so.soNo,
        status: txResult.so.status,
        total: txResult.so.total,
        shareToken: txResult.so.shareToken,
      },
      invoice: {
        id: txResult.invoice.id,
        invoiceNo: txResult.invoice.invoiceNo,
        amount: txResult.invoice.amount,
        status: txResult.invoice.status,
        shareToken: txResult.invoice.shareToken,
      },
      payment: {
        id: txResult.payment.id,
        paymentNo: txResult.payment.paymentNo,
      },
    },
    pickList: pickResult.ok ? pickResult.pickList : { error: pickResult.error },
  };
}

export function buildOrderResponse(result: FulfillResult, pickList: unknown) {
  return {
    customer: result.customer,
    customerAccount: result.account,
    salesOrder: result.so,
    invoice: result.invoice,
    pickList,
  };
}

export function parseCartSnapshot(raw: string): CartSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as CartSnapshot;
    if (!parsed?.phone || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function confirmPaymentIntentById(
  intentId: string,
  razorpayPaymentId: string,
  razorpayOrderId: string,
  razorpaySignature: string,
  keySecret: string,
  options?: { trustedWebhook?: boolean }
): Promise<
  | { ok: true; response: ReturnType<typeof buildOrderResponse>; salesOrderId: string }
  | { ok: false; status: number; code: string; message: string }
> {
  const intent = await db.paymentIntent.findUnique({ where: { id: intentId } });
  if (!intent) {
    return { ok: false, status: 404, code: "not_found", message: "Payment intent not found." };
  }

  if (intent.salesOrderId) {
    const so = await db.salesOrder.findUnique({
      where: { id: intent.salesOrderId },
      include: {
        customer: true,
        invoices: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    const account = so
      ? await db.customerAccount.findFirst({ where: { customerId: so.customerId } })
      : null;
    if (so && account) {
      const inv = so.invoices[0];
      return {
        ok: true,
        salesOrderId: so.id,
        response: buildOrderResponse(
          {
            customer: { id: so.customer.id, code: so.customer.code, name: so.customer.name },
            account: { id: account.id, email: account.email, phone: account.phone },
            so: {
              id: so.id,
              soNo: so.soNo,
              status: so.status,
              total: so.total,
              shareToken: so.shareToken,
            },
            invoice: inv
              ? {
                  id: inv.id,
                  invoiceNo: inv.invoiceNo,
                  amount: inv.amount,
                  status: inv.status,
                  shareToken: inv.shareToken,
                }
              : {
                  id: "",
                  invoiceNo: "",
                  amount: 0,
                  status: "paid",
                  shareToken: null,
                },
            payment: { id: "", paymentNo: "" },
          },
          null
        ),
      };
    }
  }

  if (intent.status !== "created") {
    return {
      ok: false,
      status: 409,
      code: "intent_not_payable",
      message: `Payment intent is ${intent.status}.`,
    };
  }

  if (intent.gatewayOrderId !== razorpayOrderId) {
    return {
      ok: false,
      status: 400,
      code: "order_mismatch",
      message: "Razorpay order id does not match this payment intent.",
    };
  }

  if (!options?.trustedWebhook) {
    if (!verifyCheckoutSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature, keySecret)) {
      return {
        ok: false,
        status: 400,
        code: "invalid_signature",
        message: "Payment signature verification failed.",
      };
    }
  }

  const snapshot = parseCartSnapshot(intent.cartSnapshot);
  if (!snapshot) {
    return {
      ok: false,
      status: 500,
      code: "bad_snapshot",
      message: "Stored cart snapshot is invalid.",
    };
  }

  const body: StorefrontOrderInput = {
    name: snapshot.name,
    email: snapshot.email,
    phone: snapshot.phone,
    addressLine: snapshot.addressLine,
    city: snapshot.city,
    state: snapshot.state,
    pincode: snapshot.pincode,
    addressId: snapshot.addressId,
    notes: snapshot.notes,
    deliveryMethod: snapshot.deliveryMethod ?? "standard",
    shippingFee: snapshot.shippingFee ?? 0,
    items: snapshot.items,
  };

  const fakeReply = {
    code: (_: number) => ({
      send: (_payload: unknown) => fakeReply,
    }),
  } as unknown as FastifyReply;

  const validated = await validateStorefrontOrder(body, fakeReply, {
    fixedShippingFee: snapshot.shippingFee ?? 0,
  });
  if (!validated) {
    await db.paymentIntent.update({
      where: { id: intent.id },
      data: { status: "failed" },
    });
    return {
      ok: false,
      status: 409,
      code: "fulfillment_blocked",
      message: "Order could not be fulfilled after payment (stock or catalog changed).",
    };
  }

  if (Math.abs(validated.total - intent.amount) > 0.01) {
    return {
      ok: false,
      status: 400,
      code: "amount_mismatch",
      message: "Paid amount does not match order total.",
    };
  }

  const fulfilled = await fulfillPrepaidStorefrontOrder(body, validated, {
    mode: "razorpay",
    reference: razorpayPaymentId,
    gateway: "razorpay",
    gatewayPaymentId: razorpayPaymentId,
    gatewayOrderId: razorpayOrderId,
    notesSuffix: razorpayPaymentId,
  });

  if (!fulfilled.ok) {
    await db.paymentIntent.update({
      where: { id: intent.id },
      data: { status: "failed", gatewayPaymentId: razorpayPaymentId },
    });
    return {
      ok: false,
      status: 500,
      code: fulfilled.code,
      message: fulfilled.message,
    };
  }

  await db.paymentIntent.update({
    where: { id: intent.id },
    data: {
      status: "paid",
      salesOrderId: fulfilled.result.so.id,
      gatewayPaymentId: razorpayPaymentId,
    },
  });

  return {
    ok: true,
    salesOrderId: fulfilled.result.so.id,
    response: buildOrderResponse(fulfilled.result, fulfilled.pickList),
  };
}

export async function confirmPayuPaymentIntentById(
  intentId: string,
  fields: PayuResponseFields,
  creds: PayuCredentials,
  options?: { trustedWebhook?: boolean }
): Promise<
  | { ok: true; response: ReturnType<typeof buildOrderResponse>; salesOrderId: string }
  | { ok: false; status: number; code: string; message: string }
> {
  const intent = await db.paymentIntent.findUnique({ where: { id: intentId } });
  if (!intent) {
    return { ok: false, status: 404, code: "not_found", message: "Payment intent not found." };
  }

  if (intent.salesOrderId) {
    const so = await db.salesOrder.findUnique({
      where: { id: intent.salesOrderId },
      include: {
        customer: true,
        invoices: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    const account = so
      ? await db.customerAccount.findFirst({ where: { customerId: so.customerId } })
      : null;
    if (so && account) {
      const inv = so.invoices[0];
      return {
        ok: true,
        salesOrderId: so.id,
        response: buildOrderResponse(
          {
            customer: { id: so.customer.id, code: so.customer.code, name: so.customer.name },
            account: { id: account.id, email: account.email, phone: account.phone },
            so: {
              id: so.id,
              soNo: so.soNo,
              status: so.status,
              total: so.total,
              shareToken: so.shareToken,
            },
            invoice: inv
              ? {
                  id: inv.id,
                  invoiceNo: inv.invoiceNo,
                  amount: inv.amount,
                  status: inv.status,
                  shareToken: inv.shareToken,
                }
              : {
                  id: "",
                  invoiceNo: "",
                  amount: 0,
                  status: "paid",
                  shareToken: null,
                },
            payment: { id: "", paymentNo: "" },
          },
          null
        ),
      };
    }
  }

  if (intent.status !== "created") {
    return {
      ok: false,
      status: 409,
      code: "intent_not_payable",
      message: `Payment intent is ${intent.status}.`,
    };
  }

  if (intent.gateway !== "payu") {
    return {
      ok: false,
      status: 400,
      code: "gateway_mismatch",
      message: "Payment intent is not a PayU checkout.",
    };
  }

  if (intent.gatewayOrderId !== fields.txnid) {
    return {
      ok: false,
      status: 400,
      code: "order_mismatch",
      message: "PayU transaction id does not match this payment intent.",
    };
  }

  if (fields.status.toLowerCase() !== "success") {
    await db.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: "failed",
        gatewayPaymentId: fields.mihpayid ?? null,
      },
    });
    return {
      ok: false,
      status: 402,
      code: "payment_failed",
      message: `PayU payment status: ${fields.status}.`,
    };
  }

  if (!options?.trustedWebhook && !verifyPayuResponseHash(creds, fields)) {
    return {
      ok: false,
      status: 400,
      code: "invalid_signature",
      message: "PayU hash verification failed.",
    };
  }

  const snapshot = parseCartSnapshot(intent.cartSnapshot);
  if (!snapshot) {
    return {
      ok: false,
      status: 500,
      code: "bad_snapshot",
      message: "Stored cart snapshot is invalid.",
    };
  }

  const body: StorefrontOrderInput = {
    name: snapshot.name,
    email: snapshot.email,
    phone: snapshot.phone,
    addressLine: snapshot.addressLine,
    city: snapshot.city,
    state: snapshot.state,
    pincode: snapshot.pincode,
    addressId: snapshot.addressId,
    notes: snapshot.notes,
    deliveryMethod: snapshot.deliveryMethod ?? "standard",
    shippingFee: snapshot.shippingFee ?? 0,
    items: snapshot.items,
  };

  const fakeReply = {
    code: (_: number) => ({
      send: (_payload: unknown) => fakeReply,
    }),
  } as unknown as FastifyReply;

  const validated = await validateStorefrontOrder(body, fakeReply, {
    fixedShippingFee: snapshot.shippingFee ?? 0,
  });
  if (!validated) {
    await db.paymentIntent.update({
      where: { id: intent.id },
      data: { status: "failed" },
    });
    return {
      ok: false,
      status: 409,
      code: "fulfillment_blocked",
      message: "Order could not be fulfilled after payment (stock or catalog changed).",
    };
  }

  const paidAmount = parseFloat(fields.amount);
  if (!Number.isFinite(paidAmount) || Math.abs(validated.total - paidAmount) > 0.01) {
    return {
      ok: false,
      status: 400,
      code: "amount_mismatch",
      message: "Paid amount does not match order total.",
    };
  }

  if (Math.abs(validated.total - intent.amount) > 0.01) {
    return {
      ok: false,
      status: 400,
      code: "amount_mismatch",
      message: "Paid amount does not match payment intent.",
    };
  }

  const paymentId = fields.mihpayid ?? fields.txnid;
  const fulfilled = await fulfillPrepaidStorefrontOrder(body, validated, {
    mode: "payu",
    reference: paymentId,
    gateway: "payu",
    gatewayPaymentId: paymentId,
    gatewayOrderId: fields.txnid,
    notesSuffix: paymentId,
  });

  if (!fulfilled.ok) {
    await db.paymentIntent.update({
      where: { id: intent.id },
      data: { status: "failed", gatewayPaymentId: paymentId },
    });
    return {
      ok: false,
      status: 500,
      code: fulfilled.code,
      message: fulfilled.message,
    };
  }

  await db.paymentIntent.update({
    where: { id: intent.id },
    data: {
      status: "paid",
      salesOrderId: fulfilled.result.so.id,
      gatewayPaymentId: paymentId,
    },
  });

  return {
    ok: true,
    salesOrderId: fulfilled.result.so.id,
    response: buildOrderResponse(fulfilled.result, fulfilled.pickList),
  };
}
