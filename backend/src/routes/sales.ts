// Quote-to-Cash: Quote -> SalesOrder -> Invoice
//
// - Quotes can be edited freely while in `draft`.
// - Once `submitted`, every edit snapshots the prior state to QuoteRevision
//   and bumps the revision number, preserving an immutable audit trail.
// - Acceptance (POST /quotes/:id/accept) creates a SalesOrder mirroring the
//   quote's lines. If the customer's outstanding balance + this quote total
//   would exceed creditLimit, an Approval row is created instead (status
//   "pending_credit"); the SO is materialised when the approval is granted.
// - SalesOrders track ordered/invoiced/cancelled qty per line and can be
//   drawn down by multiple invoices over time. Stock check happens at
//   invoice time via POST /sales-orders/:id/invoice and 409s if oversold.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { mintShareToken } from "../lib/share.js";
import { lineItemCode, lineItemUom, variantAttrsLine } from "../lib/line-item.js";
import {
  recomputeInvoiceWeight,
  recomputeQuoteWeight,
  recomputeSalesOrderWeight,
} from "../lib/document-weight.js";
import { recordChange } from "../sync/log.js";
import { resolveGstRate, computeTransportTax, type TaxKind } from "../lib/tax.js";
import { getCompanyTaxContext, getTaxContextForCustomer } from "../lib/company-tax.js";
import { computeDocumentTax, documentTaxHeaderFields, lineTaxDbFields } from "../lib/document-tax.js";
import {
  releaseSalesOrderReservations,
  reserveSalesOrderStock,
} from "../lib/so-reservations.js";
import {
  customerCreditExposure,
  applyAdvancesToInvoice,
} from "./customer-payments.js";

// ---------------------------------------------------------------- helpers ----

/**
 * Fetches the effective GST rate for each line item.
 * Returns an array parallel to `items` with the resolved rate.
 */
const resolveLineGstRates = async (
  items: Array<{ productId: string; variantId?: string | null }>
): Promise<number[]> => {
  const productIds = [...new Set(items.map((i) => i.productId))];
  const variantIds = [...new Set(items.map((i) => i.variantId).filter(Boolean) as string[])];

  const [products, variants] = await Promise.all([
    db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, gstRate: true } }),
    variantIds.length
      ? db.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: { id: true, gstRate: true },
        })
      : Promise.resolve([]),
  ]);

  const pMap = new Map(products.map((p) => [p.id, p.gstRate]));
  const vMap = new Map(variants.map((v) => [v.id, v.gstRate]));

  return items.map((it) => {
    const productRate = pMap.get(it.productId) ?? 18;
    const variantRate = it.variantId ? (vMap.get(it.variantId) ?? null) : null;
    return variantRate ?? productRate;
  });
};

// ---------------------------------------------------------------- schemas ----

const quoteItemSchema = z.object({
  id: z.string().optional(),
  productId: z.string(),
  variantId: z.string().nullable().optional(),
  qty: z.number().positive(),
  rate: z.number().nonnegative(),
  discount: z.number().min(0).max(100).default(0),
  requiredBy: z.string().datetime().nullable().optional(),
});

const quoteCreate = z.object({
  customerId: z.string(),
  validUntil: z.string().datetime().optional(), // default = +30 days
  paymentTerms: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  dispatchOptionId: z.string().nullable().optional(),
  transportCharge: z.number().nonnegative().default(0),
  items: z.array(quoteItemSchema).min(1),
});

const quoteUpdate = z.object({
  customerId: z.string().optional(),
  validUntil: z.string().datetime().optional(),
  paymentTerms: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  dispatchOptionId: z.string().nullable().optional(),
  transportCharge: z.number().nonnegative().optional(),
  items: z.array(quoteItemSchema).optional(),
  reason: z.string().optional(), // captured into QuoteRevision
});

const soInvoiceSchema = z.object({
  paymentMode: z.enum(["cash", "card", "upi", "credit", "split"]).default("credit"),
  items: z
    .array(
      z.object({
        salesOrderItemId: z.string(),
        qty: z.number().positive(),
      })
    )
    .min(1),
});

const soDirectCreate = z.object({
  customerId: z.string(),
  notes: z.string().nullable().optional(),
  dispatchOptionId: z.string().nullable().optional(),
  transportCharge: z.number().nonnegative().default(0),
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

// ---------------------------------------------------------- helper utilities --

const computeTotals = async (
  items: { qty: number; rate: number; discount?: number; gstRate?: number }[],
  transportCharge = 0,
  customerState?: string | null
) => {
  const taxCtx = await getTaxContextForCustomer(customerState);
  const doc = computeDocumentTax({
    items: items.map((it) => ({
      qty: it.qty,
      rate: it.rate,
      discount: it.discount,
      gstRate: it.gstRate ?? taxCtx.defaultGstRate ?? 18,
    })),
    transportCharge,
    taxCtx,
  });
  return {
    ...documentTaxHeaderFields(doc),
    lines: doc.lineResults.map((l) => lineTaxDbFields(l)),
  };
};

// Compute the next sequence number for Q-{year}-{####} / SO-{year}-{####}.
// Uses MAX(suffix) so we never collide with seed-allocated numbers.
export const nextDocNo = async (
  prefix: "Q" | "SO" | "INV" | "CRN" | "CN",
  year: number,
  base: number
): Promise<string> => {
  const where = { startsWith: `${prefix}-${year}-` };
  let rows: { num: string }[] = [];
  if (prefix === "Q") {
    rows = (
      await db.quote.findMany({
        where: { quoteNo: where },
        select: { quoteNo: true },
      })
    ).map((r) => ({ num: r.quoteNo }));
  } else if (prefix === "SO") {
    rows = (
      await db.salesOrder.findMany({
        where: { soNo: where },
        select: { soNo: true },
      })
    ).map((r) => ({ num: r.soNo }));
  } else if (prefix === "CRN") {
    rows = (
      await db.customerReturn.findMany({
        where: { returnNo: where },
        select: { returnNo: true },
      })
    ).map((r) => ({ num: r.returnNo }));
  } else if (prefix === "CN") {
    rows = (
      await db.creditNote.findMany({
        where: { creditNoteNo: where },
        select: { creditNoteNo: true },
      })
    ).map((r) => ({ num: r.creditNoteNo }));
  } else {
    rows = (
      await db.invoice.findMany({
        where: { invoiceNo: where },
        select: { invoiceNo: true },
      })
    ).map((r) => ({ num: r.invoiceNo }));
  }
  const tail = rows
    .map((r) => parseInt(r.num.split("-").pop() ?? "0", 10))
    .filter((n) => Number.isFinite(n));
  const max = tail.length > 0 ? Math.max(...tail) : base - 1;
  return `${prefix}-${year}-${String(max + 1).padStart(4, "0")}`;
};

// Used to be a local copy of customerNetOpenBalance; consolidated to
// customer-payments.ts so the AR statement view, the customer list,
// and the credit-limit gate all read the same number — including
// unallocated advance payments that should offset a new quote.

// =====================================================================
// Credit-limit gate — single source of truth.
//
// A new commitment of `addedAmount` against `customerId` is allowed
// when projected exposure ≤ creditLimit. Projected exposure is:
//
//   signed = invoiceRemainder + openSOCommitment − unallocatedAdvance
//
// so a customer who has prepaid an advance and has no open SOs gets
// negative exposure (= headroom) and can place a new order without an
// approval — but the same customer with TWO open SOs that already
// sum to more than the advance is correctly blocked.
//
// Returns:
//   { allowed: true,  projected, exposure } when the gate passes.
//   { allowed: false, projected, exposure, reason } when it blocks.
//
// `reason` is a human-readable breakdown suitable for the Approval
// row's `reason` column and the user-facing toast.
// =====================================================================
export type CreditGateResult =
  | {
      allowed: true;
      projected: number;
      exposure: import("./customer-payments.js").CreditExposure;
      limit: number;
    }
  | {
      allowed: false;
      projected: number;
      exposure: import("./customer-payments.js").CreditExposure;
      limit: number;
      reason: string;
    };

export const evaluateCreditGate = async (
  customerId: string,
  addedAmount: number,
  customerName: string,
  creditLimit: number
): Promise<CreditGateResult> => {
  const exposure = await customerCreditExposure(customerId);
  const projected = exposure.signed + addedAmount;
  const inr = (n: number) =>
    `₹${Math.round(n).toLocaleString("en-IN")}`;
  if (projected <= creditLimit) {
    return { allowed: true, projected, exposure, limit: creditLimit };
  }
  const parts = [
    `Customer ${customerName} would exceed credit limit (${inr(creditLimit)}).`,
    `Open AR ${inr(exposure.invoiceRemainder)}`,
    exposure.openSOCommitment > 0
      ? `+ open SO commitment ${inr(exposure.openSOCommitment)}`
      : null,
    exposure.unallocatedAdvance > 0
      ? `− advance ${inr(exposure.unallocatedAdvance)}`
      : null,
    `+ this order ${inr(addedAmount)}`,
    `= projected ${inr(projected)}.`,
  ].filter(Boolean);
  return {
    allowed: false,
    projected,
    exposure,
    limit: creditLimit,
    reason: parts.join(" "),
  };
};

const variantLineSelect = {
  id: true,
  sku: true,
  barcode: true,
  size: true,
  color: true,
  grade: true,
  uom: true,
  packSize: true,
  stockOnHand: true,
} as const;

const dispatchOptionSelect = {
  id: true,
  code: true,
  name: true,
  category: true,
  description: true,
  defaultCharge: true,
  active: true,
  sortOrder: true,
} as const;

const fullQuoteInclude = {
  customer: { select: { id: true, code: true, name: true, gst: true, addressLine: true, city: true, state: true, pincode: true, creditLimit: true } },
  dispatchOption: { select: dispatchOptionSelect },
  items: {
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true, stockOnHand: true, barcode: true } },
      variant: { select: variantLineSelect },
    },
  },
  revisions: { orderBy: { revision: "asc" as const } },
} as const;

const fullSoInclude = {
  customer: { select: { id: true, code: true, name: true, gst: true, addressLine: true, city: true, state: true, pincode: true } },
  dispatchOption: { select: dispatchOptionSelect },
  items: {
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true, stockOnHand: true, barcode: true } },
      variant: { select: variantLineSelect },
      // Hard-reservation rows for the SO line. The desktop SO detail
      // panel sums these up to render "Reserved X / Y" per line.
      reservations: {
        select: {
          id: true,
          binId: true,
          qty: true,
          createdAt: true,
          bin: {
            select: {
              id: true,
              zone: true,
              shelf: true,
              bin: true,
              warehouse: { select: { id: true, code: true, name: true } },
            },
          },
        },
      },
    },
  },
  invoices: {
    // packingSlipId surfaces the "this invoice has actually been
    // dispatched" signal to the desktop SO detail screen, which uses
    // it together with status to decide whether the SO is still
    // cancellable (a plain pre-gen 'issued' invoice with a null
    // packingSlipId is paperwork-only and does not block cancel).
    select: {
      id: true,
      invoiceNo: true,
      date: true,
      amount: true,
      status: true,
      paymentMode: true,
      packingSlipId: true,
    },
    orderBy: { date: "desc" as const },
  },
  quote: { select: { id: true, quoteNo: true, revision: true } },
} as const;

// Snapshot the current quote (header + items) into a QuoteRevision row.
// Called BEFORE applying an edit on a submitted quote.
export const snapshotQuote = async (quoteId: string, reason: string, changedBy: string) => {
  const q = await db.quote.findUnique({
    where: { id: quoteId },
    include: { items: true },
  });
  if (!q) return;
  await db.quoteRevision.create({
    data: {
      quoteId,
      revision: q.revision,
      snapshot: JSON.stringify(q),
      reason,
      changedBy,
    },
  });
};

type QuoteItemComparable = {
  productId: string;
  variantId: string | null;
  qty: number;
  rate: number;
  discount: number;
};

const comparableQuoteItems = (
  items: {
    productId: string;
    variantId: string | null;
    qty: number;
    rate: number;
    discount: number;
  }[]
): QuoteItemComparable[] =>
  items
    .map((it) => ({
      productId: it.productId,
      variantId: it.variantId ?? null,
      qty: it.qty,
      rate: it.rate,
      discount: it.discount,
    }))
    .sort((a, b) =>
      `${a.productId}:${a.variantId ?? ""}`.localeCompare(`${b.productId}:${b.variantId ?? ""}`)
    );

const quoteItemsEqual = (a: QuoteItemComparable[], b: QuoteItemComparable[]) =>
  JSON.stringify(a) === JSON.stringify(b);

const quoteDateKey = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

/** True when a PATCH body would not change quote header or line content. */
export const quotePatchIsNoOp = (
  before: {
    customerId: string;
    validUntil: Date;
    paymentTerms: string | null;
    notes: string | null;
    dispatchOptionId: string | null;
    transportCharge: number;
    items: {
      productId: string;
      variantId: string | null;
      qty: number;
      rate: number;
      discount: number;
    }[];
  },
  body: z.infer<typeof quoteUpdate>
): boolean => {
  const customerId = body.customerId ?? before.customerId;
  const validUntil = body.validUntil ? new Date(body.validUntil) : before.validUntil;
  const paymentTerms = body.paymentTerms !== undefined ? body.paymentTerms : before.paymentTerms;
  const notes = body.notes !== undefined ? body.notes : before.notes;
  const dispatchOptionId =
    body.dispatchOptionId !== undefined ? body.dispatchOptionId : before.dispatchOptionId;
  const transportCharge =
    body.transportCharge !== undefined ? body.transportCharge : before.transportCharge;

  if (customerId !== before.customerId) return false;
  if (quoteDateKey(validUntil) !== quoteDateKey(before.validUntil)) return false;
  if ((paymentTerms ?? null) !== (before.paymentTerms ?? null)) return false;
  if ((notes ?? null) !== (before.notes ?? null)) return false;
  if ((dispatchOptionId ?? null) !== (before.dispatchOptionId ?? null)) return false;
  if (transportCharge !== before.transportCharge) return false;

  const nextItems = body.items
    ? body.items.map((it) => ({
        productId: it.productId,
        variantId: it.variantId ?? null,
        qty: it.qty,
        rate: it.rate,
        discount: it.discount ?? 0,
      }))
    : before.items;

  return quoteItemsEqual(comparableQuoteItems(before.items), comparableQuoteItems(nextItems));
};

// ---------------------------------------------------------- ATP calculator ---

const computeAtp = async (
  productId: string,
  variantId: string | null
): Promise<{
  onHand: number;
  reservedForSO: number;
  binReserved: number;
  openProcurement: number;
  openProduction: number;
  atp: number;
}> => {
  // On-hand: prefer summing variant-tagged bins (the physical truth
  // post-Bin.variantId migration) and fall back to the legacy
  // stockOnHand counter when no bins are tagged. Bin sums let two
  // bins under the same parent each hold a different variant without
  // their stock blending into one ATP figure.
  let onHand = 0;
  if (variantId) {
    const taggedBins = await db.bin.aggregate({
      _sum: { qty: true },
      where: { productId, variantId },
    });
    if ((taggedBins._sum.qty ?? 0) > 0) {
      onHand = taggedBins._sum.qty ?? 0;
    } else {
      // No bin tagged for this variant — fall through to the variant
      // counter so legacy data without variantId tagging still
      // produces a non-zero ATP.
      const v = await db.productVariant.findUnique({
        where: { id: variantId },
        select: { stockOnHand: true },
      });
      onHand = v?.stockOnHand ?? 0;
    }
  } else {
    // Bulk / no-variant flow: count bins NOT tagged to any variant
    // (those bins genuinely belong to the parent product) and add
    // the parent counter as a fallback when nothing is tagged. Once
    // every bin in a multi-variant product is tagged, the sum here
    // collapses to 0 — which is correct, since selling the bulk
    // parent doesn't draw from variant-specific bins.
    const parentBins = await db.bin.aggregate({
      _sum: { qty: true },
      where: { productId, variantId: null },
    });
    if ((parentBins._sum.qty ?? 0) > 0) {
      onHand = parentBins._sum.qty ?? 0;
    } else {
      const p = await db.product.findUnique({
        where: { id: productId },
        select: { stockOnHand: true },
      });
      onHand = p?.stockOnHand ?? 0;
    }
  }

  // Reserved-for-SO = SUM(qtyOrdered - qtyInvoiced - qtyCancelled) on items
  // belonging to non-terminal SOs.
  const open = await db.salesOrderItem.findMany({
    where: {
      productId,
      ...(variantId ? { variantId } : { variantId: null }),
      salesOrder: { status: { in: ["confirmed", "partially_invoiced", "on_hold"] } },
    },
    select: { qtyOrdered: true, qtyInvoiced: true, qtyCancelled: true },
  });
  const reservedForSO = open.reduce(
    (s, r) => s + Math.max(0, r.qtyOrdered - r.qtyInvoiced - r.qtyCancelled),
    0
  );

  // Physical reservation on bins (already-picked-but-not-yet-invoiced).
  // Informational only; this is a SUBSET of reservedForSO so we don't
  // double-count it in the ATP calculation. Narrow to variant-tagged
  // bins when a variantId is supplied so a 1KG SO doesn't pick up the
  // 500g variant's reservedQty.
  const binAgg = await db.bin.aggregate({
    _sum: { reservedQty: true },
    where: variantId ? { productId, variantId } : { productId },
  });
  const binReserved = binAgg._sum.reservedQty ?? 0;

  // Open procurement (PO items not yet fully received) - parent product only.
  const poItems = await db.purchaseOrderItem.findMany({
    where: {
      productId,
      po: { status: { in: ["draft", "approved", "partial"] } },
    },
    select: { qty: true, received: true },
  });
  const openProcurement = poItems.reduce((s, r) => s + Math.max(0, r.qty - r.received), 0);

  // Open production (orders not yet completed) - approximated via planned-actual.
  const moAgg = await db.productionOrder.aggregate({
    _sum: { plannedQty: true, actualQty: true },
    where: {
      bom: { productId },
      status: { in: ["planned", "in-progress", "qc"] },
    },
  });
  const openProduction = Math.max(
    0,
    (moAgg._sum.plannedQty ?? 0) - (moAgg._sum.actualQty ?? 0)
  );

  return {
    onHand,
    reservedForSO,
    binReserved,
    openProcurement,
    openProduction,
    atp: onHand - reservedForSO + openProcurement + openProduction,
  };
};

// =========================================================== route module ===

export const salesRoutes = async (app: FastifyInstance) => {
  // ============================================================== Quotes ====

  // Active dispatch modes for quote / SO forms (lazy-seeds defaults).
  app.get("/dispatch-options", { preHandler: [app.authenticate] }, async () => {
    const { ensureDefaultDispatchOptions } = await import(
      "../lib/dispatch-options-seed.js"
    );
    await ensureDefaultDispatchOptions(db);
    return db.dispatchOption.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        category: true,
        description: true,
        defaultCharge: true,
        sortOrder: true,
      },
    });
  });

  app.get("/quotes", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    return db.quote.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.customerId ? { customerId: q.customerId } : {}),
        ...(q.q
          ? {
              OR: [
                { quoteNo: { contains: q.q } },
                { customer: { name: { contains: q.q } } },
              ],
            }
          : {}),
      },
      include: {
        customer: { select: { id: true, code: true, name: true, addressLine: true, city: true, state: true, pincode: true } },
        _count: { select: { items: true, revisions: true } },
      },
      orderBy: { createdAt: "desc" },
      take: q.limit ? parseInt(q.limit, 10) : 200,
    });
  });

  app.get("/quotes/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const quote = await db.quote.findUnique({ where: { id }, include: fullQuoteInclude });
    if (!quote) return reply.code(404).send({ error: { code: "not_found" } });

    // If the quote is parked behind a credit-limit approval (status='accepted'
    // but no Sales Order yet), surface the pending approval so the UI can
    // explain WHY the SO didn't materialise and offer a deep-link to the
    // approver. We look it up by quoteNo + type, since that's how /accept
    // creates the Approval row.
    let pendingApproval = null;
    if (quote.status === "accepted" && !quote.convertedSalesOrderId) {
      pendingApproval = await db.approval.findFirst({
        where: { ref: quote.quoteNo, type: "Credit Limit", status: "pending" },
        select: {
          id: true,
          status: true,
          amount: true,
          reason: true,
          requestedBy: true,
          createdAt: true,
        },
      });
    }
    return { ...quote, pendingApproval };
  });

  app.get("/quotes/:id/revisions", async (req) => {
    const id = (req.params as { id: string }).id;
    const revs = await db.quoteRevision.findMany({
      where: { quoteId: id },
      orderBy: { revision: "asc" },
    });
    // Join the User table once so the UI can render a friendly name
    // instead of a raw cuid. We don't have a Prisma relation defined on
    // QuoteRevision.changedBy, so resolve manually.
    const userIds = Array.from(new Set(revs.map((r) => r.changedBy).filter(Boolean)));
    const users = userIds.length
      ? await db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, username: true, name: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return revs.map((r) => ({
      ...r,
      changedByUser: byId.get(r.changedBy) ?? null,
    }));
  });

  app.get("/quotes/:id/revisions/:rev", async (req, reply) => {
    const { id, rev } = req.params as { id: string; rev: string };
    const r = await db.quoteRevision.findUnique({
      where: { quoteId_revision: { quoteId: id, revision: parseInt(rev, 10) } },
    });
    if (!r) return reply.code(404).send({ error: { code: "not_found" } });
    return { ...r, snapshot: JSON.parse(r.snapshot) as unknown };
  });

  // ============================================================ Public viewer
  // The /public/* namespace deliberately bypasses the auth wrapper - it
  // serves the read-only quote view that customers open via their share
  // link. The link itself acts as the auth (96 bits of entropy), and
  // anyone with the link sees only the quote payload (no internal IDs,
  // no totals beyond what's already on the printable doc).
  app.get("/public/quotes/:token", async (req, reply) => {
    const token = (req.params as { token: string }).token;
    if (!token || token.length < 8) {
      return reply.code(404).send({ error: { code: "not_found" } });
    }
    const quote = await db.quote.findUnique({
      where: { shareToken: token },
      include: {
        customer: { select: { name: true, gst: true, addressLine: true, city: true, state: true, pincode: true, contact: true } },
        dispatchOption: { select: { code: true, name: true, category: true } },
        items: {
          include: {
            product: { select: { name: true, sku: true, uom: true, hsn: true, barcode: true } },
            variant: { select: { sku: true, barcode: true, size: true, color: true, grade: true, uom: true } },
          },
        },
      },
    });
    if (!quote) return reply.code(404).send({ error: { code: "not_found" } });
    // Sanitize: drop internal fields the customer doesn't need.
    return {
      quoteNo: quote.quoteNo,
      revision: quote.revision,
      status: quote.status,
      validUntil: quote.validUntil,
      paymentTerms: quote.paymentTerms,
      notes: quote.notes,
      subTotal: quote.subTotal,
      tax: quote.tax,
      transportCharge: quote.transportCharge,
      transportTax: quote.transportTax,
      total: quote.total,
      dispatchOption: quote.dispatchOption
        ? {
            code: quote.dispatchOption.code,
            name: quote.dispatchOption.name,
            category: quote.dispatchOption.category,
          }
        : null,
      createdAt: quote.createdAt,
      customer: quote.customer,
      items: quote.items.map((it) => ({
        productName: it.product.name,
        productSku: it.product.sku,
        lineCode: lineItemCode(it.product, it.variant),
        hsn: it.product.hsn,
        uom: lineItemUom(it.product, it.variant),
        variantSku: it.variant?.sku ?? null,
        variantAttrs: variantAttrsLine(it.variant),
        qty: it.qty,
        rate: it.rate,
        discount: it.discount,
        amount: it.amount,
        requiredBy: it.requiredBy,
      })),
    };
  });

  // Rotate (or mint, if absent) the share token for a quote. Used to revoke
  // a previously shared link.
  app.post(
    "/quotes/:id/rotate-share-token",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const q = await db.quote.findUnique({ where: { id } });
      if (!q) return reply.code(404).send({ error: { code: "not_found" } });
      const updated = await db.quote.update({
        where: { id },
        data: { shareToken: mintShareToken() },
      });
      return { shareToken: updated.shareToken };
    }
  );

  app.post("/quotes", { preHandler: [app.authenticate] }, async (req) => {
    const body = quoteCreate.parse(req.body);
    const customer = await db.customer.findUnique({
      where: { id: body.customerId },
      select: { state: true },
    });
    const lineRates = await resolveLineGstRates(body.items);
    const totals = await computeTotals(
      body.items.map((it, i) => ({ ...it, gstRate: lineRates[i] })),
      body.transportCharge ?? 0,
      customer?.state
    );
    const quoteNo = await nextDocNo("Q", 2026, 1001);
    const validUntil = body.validUntil
      ? new Date(body.validUntil)
      : new Date(Date.now() + 30 * 86400000);

    const created = await db.quote.create({
      data: {
        quoteNo,
        shareToken: mintShareToken(),
        customerId: body.customerId,
        validUntil,
        paymentTerms: body.paymentTerms ?? null,
        notes: body.notes ?? null,
        dispatchOptionId: body.dispatchOptionId ?? null,
        transportCharge: totals.transportCharge,
        transportTax: totals.transportTax,
        subTotal: totals.subTotal,
        tax: totals.tax,
        cgstTotal: totals.cgstTotal,
        sgstTotal: totals.sgstTotal,
        igstTotal: totals.igstTotal,
        taxKind: totals.taxKind,
        placeOfSupplyState: totals.placeOfSupplyState,
        sellerState: totals.sellerState,
        pricingInclusive: totals.pricingInclusive,
        total: totals.total,
        createdById: req.user.sub,
        items: {
          create: body.items.map((it, i) => {
            const line = totals.lines[i];
            return {
              productId: it.productId,
              variantId: it.variantId ?? null,
              qty: it.qty,
              rate: line.rate,
              discount: it.discount ?? 0,
              amount: line.amount,
              taxableValue: line.taxableValue,
              gstRate: line.gstRate,
              cgstAmount: line.cgstAmount,
              sgstAmount: line.sgstAmount,
              igstAmount: line.igstAmount,
              requiredBy: it.requiredBy ? new Date(it.requiredBy) : null,
            };
          }),
        },
      },
      include: fullQuoteInclude,
    });
    // Stamp totalWeightKg derived from the catalogue. Refetch so the
    // response carries the rolled-up value alongside the rest of the
    // newly-created quote.
    await recomputeQuoteWeight(db, created.id);
    const withWeight = await db.quote.findUnique({
      where: { id: created.id },
      include: fullQuoteInclude,
    });
    await recordChange("Quote", created.id, "insert", withWeight ?? created, req.user.sub);
    return withWeight ?? created;
  });

  app.patch("/quotes/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = quoteUpdate.parse(req.body);
    const before = await db.quote.findUnique({ where: { id }, include: { items: true } });
    if (!before) return reply.code(404).send({ error: { code: "not_found" } });

    if (["accepted", "converted", "rejected"].includes(before.status)) {
      return reply.code(409).send({
        error: {
          code: "locked",
          message: `Quote in status '${before.status}' cannot be edited. Create a new quote instead.`,
        },
      });
    }

    if (quotePatchIsNoOp(before, body)) {
      return db.quote.findUnique({ where: { id }, include: fullQuoteInclude });
    }

    // Snapshot + bump revision when editing a submitted quote
    let nextRevision = before.revision;
    if (before.status === "submitted") {
      await snapshotQuote(id, body.reason ?? "edit", req.user.sub);
      nextRevision = before.revision + 1;
    }

    const items = body.items;
    const headerData: Record<string, unknown> = {
      revision: nextRevision,
    };
    if (body.customerId !== undefined) headerData.customerId = body.customerId;
    if (body.validUntil !== undefined) headerData.validUntil = new Date(body.validUntil);
    if (body.paymentTerms !== undefined) headerData.paymentTerms = body.paymentTerms;
    if (body.notes !== undefined) headerData.notes = body.notes;
    if (body.dispatchOptionId !== undefined) {
      headerData.dispatchOptionId = body.dispatchOptionId;
    }

    const transportCharge =
      body.transportCharge !== undefined
        ? body.transportCharge
        : before.transportCharge;

    if (items !== undefined) {
      const customerId = body.customerId ?? before.customerId;
      const customer = await db.customer.findUnique({
        where: { id: customerId },
        select: { state: true },
      });
      const lineRates = await resolveLineGstRates(items);
      const totals = await computeTotals(
        items.map((it, i) => ({ ...it, gstRate: lineRates[i] })),
        transportCharge,
        customer?.state
      );
      headerData.subTotal = totals.subTotal;
      headerData.tax = totals.tax;
      headerData.cgstTotal = totals.cgstTotal;
      headerData.sgstTotal = totals.sgstTotal;
      headerData.igstTotal = totals.igstTotal;
      headerData.taxKind = totals.taxKind;
      headerData.placeOfSupplyState = totals.placeOfSupplyState;
      headerData.sellerState = totals.sellerState;
      headerData.pricingInclusive = totals.pricingInclusive;
      headerData.transportCharge = totals.transportCharge;
      headerData.transportTax = totals.transportTax;
      headerData.total = totals.total;
      // Replace items wholesale - simpler than diffing; old items go via cascade.
      await db.quoteItem.deleteMany({ where: { quoteId: id } });
      await db.quoteItem.createMany({
        data: items.map((it, i) => {
          const line = totals.lines[i];
          return {
            quoteId: id,
            productId: it.productId,
            variantId: it.variantId ?? null,
            qty: it.qty,
            rate: line.rate,
            discount: it.discount ?? 0,
            amount: line.amount,
            taxableValue: line.taxableValue,
            gstRate: line.gstRate,
            cgstAmount: line.cgstAmount,
            sgstAmount: line.sgstAmount,
            igstAmount: line.igstAmount,
            requiredBy: it.requiredBy ? new Date(it.requiredBy) : null,
          };
        }),
      });
    } else if (
      body.transportCharge !== undefined ||
      body.dispatchOptionId !== undefined
    ) {
      const taxKind = (before.taxKind ?? "intra") as TaxKind;
      const { transportGstEnabled } = await getCompanyTaxContext();
      const freight = computeTransportTax(transportCharge, taxKind, transportGstEnabled ?? true);
      headerData.transportCharge = transportCharge;
      headerData.transportTax = freight.totalTax;
      headerData.total = before.subTotal + before.tax + transportCharge + freight.totalTax;
    }

    const updated = await db.quote.update({
      where: { id },
      data: headerData,
      include: fullQuoteInclude,
    });
    // Items may have been replaced wholesale above; re-derive weight.
    // No-op when only the header changed but cheap enough to skip the
    // branching.
    if (items !== undefined) {
      await recomputeQuoteWeight(db, id);
    }
    const final = await db.quote.findUnique({
      where: { id },
      include: fullQuoteInclude,
    });
    await recordChange("Quote", id, "update", final ?? updated, req.user.sub);
    return final ?? updated;
  });

  app.post("/quotes/:id/submit", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const before = await db.quote.findUnique({ where: { id } });
    if (!before) return reply.code(404).send({ error: { code: "not_found" } });
    if (before.status !== "draft") {
      return reply.code(409).send({
        error: { code: "bad_state", message: `Cannot submit a quote in '${before.status}'.` },
      });
    }
    const updated = await db.quote.update({
      where: { id },
      data: { status: "submitted" },
      include: fullQuoteInclude,
    });
    await recordChange("Quote", id, "update", updated, req.user.sub);
    return updated;
  });

  app.post("/quotes/:id/reject", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const before = await db.quote.findUnique({ where: { id } });
    if (!before) return reply.code(404).send({ error: { code: "not_found" } });
    const updated = await db.quote.update({
      where: { id },
      data: { status: "rejected", rejectedAt: new Date() },
      include: fullQuoteInclude,
    });
    await recordChange("Quote", id, "update", updated, req.user.sub);
    return updated;
  });

  // Hard-delete a draft quote. Only drafts can be deleted - once a quote is
  // submitted it has audit history (revisions, an SO link, an approval, ...)
  // and must instead be rejected to preserve the trail.
  app.delete("/quotes/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const before = await db.quote.findUnique({
      where: { id },
      include: { _count: { select: { revisions: true } } },
    });
    if (!before) return reply.code(404).send({ error: { code: "not_found" } });
    if (before.status !== "draft") {
      return reply.code(409).send({
        error: {
          code: "bad_state",
          message: `Only draft quotes can be deleted (this one is '${before.status}'). Use Reject instead to preserve audit history.`,
        },
      });
    }
    if (before.convertedSalesOrderId) {
      return reply.code(409).send({
        error: { code: "linked_so", message: "Quote is linked to a Sales Order; cannot delete." },
      });
    }
    // Items cascade via the Quote->QuoteItem onDelete:Cascade in schema.
    // Revisions don't cascade, so wipe them defensively (drafts shouldn't
    // have any but if seeded data does, we don't want orphans).
    await db.quoteRevision.deleteMany({ where: { quoteId: id } });
    await db.quoteItem.deleteMany({ where: { quoteId: id } });
    await db.quote.delete({ where: { id } });
    await recordChange("Quote", id, "delete", before, req.user.sub);
    return reply.code(200).send({ ok: true });
  });

  app.post(
    "/quotes/:id/extend-validity",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const body = z.object({ validUntil: z.string().datetime() }).parse(req.body);
      const before = await db.quote.findUnique({ where: { id } });
      if (!before) return reply.code(404).send({ error: { code: "not_found" } });
      if (before.status === "submitted" || before.status === "expired") {
        await snapshotQuote(id, "validity_extension", req.user.sub);
      }
      const updated = await db.quote.update({
        where: { id },
        data: {
          validUntil: new Date(body.validUntil),
          revision: before.revision + 1,
          status: "submitted", // re-arm an expired one
        },
        include: fullQuoteInclude,
      });
      await recordChange("Quote", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  app.post("/quotes/:id/accept", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const quote = await db.quote.findUnique({
      where: { id },
      include: { items: true, customer: true },
    });
    if (!quote) return reply.code(404).send({ error: { code: "not_found" } });
    if (quote.status === "converted" && quote.convertedSalesOrderId) {
      const so = await db.salesOrder.findUnique({
        where: { id: quote.convertedSalesOrderId },
        include: fullSoInclude,
      });
      return reply.code(200).send({ alreadyConverted: true, salesOrder: so });
    }
    // 'accepted' is also valid here: it means a previous /accept call
    // parked the quote behind a credit-limit approval, but the
    // customer may since have paid an advance that clears the gate.
    // Re-running the check here lets the salesperson "retry" without
    // a manager touching the approval row.
    if (!["submitted", "draft", "accepted"].includes(quote.status)) {
      return reply.code(409).send({
        error: { code: "bad_state", message: `Cannot accept a quote in '${quote.status}'.` },
      });
    }
    if (quote.status === "accepted" && quote.convertedSalesOrderId) {
      // Already materialised — handled above, but guard for type safety.
      return reply.code(409).send({
        error: { code: "already_converted", message: "Quote is already converted." },
      });
    }

    // -------- Credit-limit gate --------
    // Single source of truth — see evaluateCreditGate above. Includes
    // open invoice remainder + open SO commitment − unallocated
    // advance, so a customer with multiple un-invoiced SOs can't slip
    // a new quote through just because their AR happens to be zero.
    const limit = quote.customer.creditLimit ?? 0;
    const gate = await evaluateCreditGate(
      quote.customerId,
      quote.total,
      quote.customer.name,
      limit
    );
    if (!gate.allowed) {
      // Park the acceptance: create an Approval and freeze the quote in
      // 'accepted' state; the SO is materialised when the approval is
      // granted via /approvals/:id/decide.
      const existing = await db.approval.findFirst({
        where: { ref: quote.quoteNo, type: "Credit Limit", status: "pending" },
      });
      const approval =
        existing ??
        (await db.approval.create({
          data: {
            ref: quote.quoteNo,
            type: "Credit Limit",
            requestedBy: req.user.name,
            amount: quote.total,
            priority: "high",
            reason: gate.reason,
          },
        }));
      const updated =
        quote.status === "accepted"
          ? quote
          : await db.quote.update({
              where: { id },
              data: { status: "accepted", acceptedAt: new Date() },
              include: fullQuoteInclude,
            });
      if (quote.status !== "accepted") {
        await recordChange("Quote", id, "update", updated, req.user.sub);
      }
      return reply.code(202).send({
        creditHold: true,
        approvalId: approval.id,
        quote: updated,
        message:
          "Quote accepted but converting to a Sales Order requires credit-limit approval.",
      });
    }

    // -------- Gate passes — auto-resolve any standing approval --------
    // If this quote was previously parked behind a Credit Limit
    // approval and the customer has since paid an advance that clears
    // the gate, mark the approval as approved (audit-trail) before
    // materialising the SO so the approvals queue stays clean.
    if (quote.status === "accepted") {
      const standing = await db.approval.findFirst({
        where: { ref: quote.quoteNo, type: "Credit Limit", status: "pending" },
      });
      if (standing) {
        const note = `Auto-resolved by ${req.user.name}: projected exposure ₹${gate.projected.toLocaleString(
          "en-IN"
        )} ≤ limit ₹${limit.toLocaleString("en-IN")} (open AR ₹${gate.exposure.invoiceRemainder.toLocaleString(
          "en-IN"
        )} + open SO ₹${gate.exposure.openSOCommitment.toLocaleString(
          "en-IN"
        )} − advance ₹${gate.exposure.unallocatedAdvance.toLocaleString(
          "en-IN"
        )} + this quote ₹${quote.total.toLocaleString("en-IN")}).`;
        await db.approval.update({
          where: { id: standing.id },
          data: {
            status: "approved",
            decidedAt: new Date(),
            decidedBy: req.user.name,
            reason: `${standing.reason}\n\n[approved by ${req.user.name}] ${note}`,
          },
        });
      }
    }

    // -------- Materialise the Sales Order --------
    const so = await materialiseSO(quote.id, req.user.sub);
    return so;
  });

  // Admin override: skip the credit-limit gate and force the SO. Marks the
  // pending Credit Limit approval as 'approved' (audited), then materialises
  // the SO. Use when the user has authority to accept the credit risk.
  app.post(
    "/quotes/:id/force-convert",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const reason = (req.body as { reason?: string } | null)?.reason ?? "Manual override";
      const quote = await db.quote.findUnique({
        where: { id },
        include: { items: true, customer: true },
      });
      if (!quote) return reply.code(404).send({ error: { code: "not_found" } });
      if (quote.status === "converted" && quote.convertedSalesOrderId) {
        const so = await db.salesOrder.findUnique({
          where: { id: quote.convertedSalesOrderId },
          include: fullSoInclude,
        });
        return reply.code(200).send({ alreadyConverted: true, salesOrder: so });
      }
      if (!["accepted", "submitted", "draft"].includes(quote.status)) {
        return reply.code(409).send({
          error: {
            code: "bad_state",
            message: `Cannot force-convert a quote in '${quote.status}'.`,
          },
        });
      }

      // Auto-resolve any pending Credit Limit approval for audit completeness.
      const pending = await db.approval.findFirst({
        where: { ref: quote.quoteNo, type: "Credit Limit", status: "pending" },
      });
      if (pending) {
        await db.approval.update({
          where: { id: pending.id },
          data: {
            status: "approved",
            decidedAt: new Date(),
            decidedBy: req.user.name,
            reason: `${pending.reason}\n\nOverride: ${reason}`,
          },
        });
      }
      const so = await materialiseSO(quote.id, req.user.sub);
      return reply.code(200).send({ forced: true, approvalId: pending?.id, salesOrder: so });
    }
  );

  // ========================================================= Sales Orders ===

  app.get("/sales-orders", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    return db.salesOrder.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.customerId ? { customerId: q.customerId } : {}),
        ...(q.q
          ? {
              OR: [
                { soNo: { contains: q.q } },
                { customer: { name: { contains: q.q } } },
              ],
            }
          : {}),
      },
      include: {
        customer: { select: { id: true, code: true, name: true, addressLine: true, city: true, state: true, pincode: true } },
        _count: { select: { items: true, invoices: true } },
        items: { select: { qtyOrdered: true, qtyInvoiced: true, qtyCancelled: true } },
      },
      orderBy: { orderDate: "desc" },
      take: q.limit ? parseInt(q.limit, 10) : 200,
    });
  });

  app.get("/sales-orders/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const so = await db.salesOrder.findUnique({ where: { id }, include: fullSoInclude });
    if (!so) return reply.code(404).send({ error: { code: "not_found" } });
    return so;
  });

  app.post("/sales-orders", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = soDirectCreate.parse(req.body);
    const customer = await db.customer.findUnique({
      where: { id: body.customerId },
      select: { id: true, name: true, creditLimit: true, state: true },
    });
    if (!customer) {
      return reply.code(404).send({
        error: { code: "customer_not_found", message: "Customer not found" },
      });
    }
    const lineRates = await resolveLineGstRates(body.items);
    const totals = await computeTotals(
      body.items.map((it, i) => ({ ...it, gstRate: lineRates[i] })),
      body.transportCharge ?? 0,
      customer.state
    );

    // Credit-limit gate. Direct SO creation is a back-office flow that
    // bypasses the quote → /accept path, so without this check a
    // salesperson could create an SO that the quote-accept gate would
    // have blocked. The body has no quoteNo, so the Approval row
    // references the to-be-issued SO number; if the gate trips we
    // bail out 409 BEFORE allocating an SO number / persisting any
    // row, and let the caller take it through the quote flow (or
    // /sales-orders with `force:true` once we add admin override).
    const limit = customer.creditLimit ?? 0;
    const gate = await evaluateCreditGate(
      customer.id,
      totals.total,
      customer.name,
      limit
    );
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
            attemptedAmount: totals.total,
          },
        },
      });
    }

    const soNo = await nextDocNo("SO", 2026, 2001);
    const so = await db.salesOrder.create({
      data: {
        soNo,
        shareToken: mintShareToken(),
        customerId: body.customerId,
        notes: body.notes ?? null,
        dispatchOptionId: body.dispatchOptionId ?? null,
        transportCharge: totals.transportCharge,
        transportTax: totals.transportTax,
        subTotal: totals.subTotal,
        tax: totals.tax,
        cgstTotal: totals.cgstTotal,
        sgstTotal: totals.sgstTotal,
        igstTotal: totals.igstTotal,
        taxKind: totals.taxKind,
        placeOfSupplyState: totals.placeOfSupplyState,
        sellerState: totals.sellerState,
        pricingInclusive: totals.pricingInclusive,
        total: totals.total,
        items: {
          create: body.items.map((it, i) => {
            const line = totals.lines[i];
            return {
              productId: it.productId,
              variantId: it.variantId ?? null,
              qtyOrdered: it.qty,
              rate: line.rate,
              amount: line.amount,
              taxableValue: line.taxableValue,
              gstRate: line.gstRate,
              cgstAmount: line.cgstAmount,
              sgstAmount: line.sgstAmount,
              igstAmount: line.igstAmount,
            };
          }),
        },
      },
      include: fullSoInclude,
    });
    // Stamp totalWeightKg from the catalogue so trip planners can see
    // load weight before a packing slip exists.
    await recomputeSalesOrderWeight(db, so.id);
    await recordChange("SalesOrder", so.id, "insert", so, req.user.sub);

    // SO is born "confirmed" → hard-reserve stock against bins so the
    // Reserved column reflects committed sales orders. Best-effort:
    // shortages don't block creation, the UI surfaces them on the
    // SO detail panel.
    try {
      await reserveSalesOrderStock(so.id);
    } catch (e) {
      req.log?.warn({ err: e, soId: so.id }, "reserveSalesOrderStock failed");
    }

    // Back-office (source='internal') SOs do NOT pre-generate an invoice.
    // The packing flow mints the invoice on the fly at pack-complete via
    // the defensive ensureInvoiceForSalesOrder() guard in fulfilment.ts.
    // Ecommerce orders are unaffected: they create their own paid invoice
    // inline inside the storefront-mock checkout transaction.
    return so;
  });

  app.post("/sales-orders/:id/cancel", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const before = await db.salesOrder.findUnique({ where: { id }, include: { invoices: true } });
    if (!before) return reply.code(404).send({ error: { code: "not_found" } });

    // Pre-generated 'issued' invoices (no payment, no packing slip
    // yet) DO NOT block cancellation - they are paperwork that
    // hasn't been actioned. Cancel them along with the SO.
    // 'paid', 'invoiced' (i.e. attached to a packed slip) and any
    // status other than plain 'issued' still blocks cancel because
    // money or stock has actually moved.
    const blocking = before.invoices.filter(
      (inv) => inv.status !== "issued" || inv.packingSlipId !== null
    );
    if (blocking.length > 0) {
      return reply.code(409).send({
        error: {
          code: "has_invoices",
          message:
            "Cannot cancel a Sales Order whose invoice has already been packed or paid. Cancel remaining lines instead.",
        },
      });
    }

    const cancellableInvoiceIds = before.invoices
      .filter((inv) => inv.status === "issued" && inv.packingSlipId === null)
      .map((inv) => inv.id);

    const updated = await db.$transaction(async (tx) => {
      if (cancellableInvoiceIds.length > 0) {
        await tx.invoice.updateMany({
          where: { id: { in: cancellableInvoiceIds } },
          data: { status: "cancelled" },
        });
      }
      return tx.salesOrder.update({
        where: { id },
        data: { status: "cancelled" },
        include: fullSoInclude,
      });
    });

    for (const invId of cancellableInvoiceIds) {
      await recordChange(
        "Invoice",
        invId,
        "update",
        { id: invId, status: "cancelled" },
        req.user.sub
      );
    }
    // Cancellation releases all reserved bin qty so other SOs / pick
    // lists can claim it again.
    try {
      await releaseSalesOrderReservations(id);
    } catch (e) {
      req.log?.warn({ err: e, soId: id }, "releaseSalesOrderReservations failed (cancel)");
    }
    await recordChange("SalesOrder", id, "update", updated, req.user.sub);
    return updated;
  });

  app.post("/sales-orders/:id/hold", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const before = await db.salesOrder.findUnique({ where: { id } });
    if (!before) return reply.code(404).send({ error: { code: "not_found" } });
    const updated = await db.salesOrder.update({
      where: { id },
      data: { status: "on_hold" },
      include: fullSoInclude,
    });
    // Hold = "park this order" → release reservations so the stock
    // is visible to other commitments. /resume re-reserves whatever's
    // still available.
    try {
      await releaseSalesOrderReservations(id);
    } catch (e) {
      req.log?.warn({ err: e, soId: id }, "releaseSalesOrderReservations failed (hold)");
    }
    await recordChange("SalesOrder", id, "update", updated, req.user.sub);
    return updated;
  });

  app.post("/sales-orders/:id/resume", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const before = await db.salesOrder.findUnique({ where: { id }, include: { items: true } });
    if (!before) return reply.code(404).send({ error: { code: "not_found" } });
    const totalInvoiced = before.items.reduce((s, it) => s + it.qtyInvoiced, 0);
    const totalOrdered = before.items.reduce((s, it) => s + it.qtyOrdered, 0);
    const newStatus =
      totalInvoiced === 0
        ? "confirmed"
        : totalInvoiced >= totalOrdered
          ? "invoiced"
          : "partially_invoiced";
    const updated = await db.salesOrder.update({
      where: { id },
      data: { status: newStatus },
      include: fullSoInclude,
    });
    // Resume → re-reserve. reserveSalesOrderStock is idempotent and
    // skips fully-invoiced lines.
    try {
      await reserveSalesOrderStock(id);
    } catch (e) {
      req.log?.warn({ err: e, soId: id }, "reserveSalesOrderStock failed (resume)");
    }
    await recordChange("SalesOrder", id, "update", updated, req.user.sub);
    return updated;
  });

  // POST /sales-orders/:id/reserve — manual (re)reservation. Useful
  // for backfilling SOs created before the hard-reserve feature
  // existed, or after a bin recount when the operator needs to
  // re-anchor reservations to the current stock picture.
  app.post(
    "/sales-orders/:id/reserve",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const so = await db.salesOrder.findUnique({
        where: { id },
        select: { id: true, status: true, soNo: true },
      });
      if (!so) return reply.code(404).send({ error: { code: "not_found" } });
      if (so.status !== "confirmed" && so.status !== "partially_invoiced") {
        return reply.code(409).send({
          error: {
            code: "wrong_status",
            message: `SO ${so.soNo} is ${so.status}; only confirmed / partially-invoiced orders can hold reservations.`,
          },
        });
      }
      const result = await reserveSalesOrderStock(id);
      await recordChange(
        "SalesOrder",
        id,
        "update",
        { id, _reservation: result },
        req.user.sub
      );
      return result;
    }
  );

  // Close a sales order. Accepts the SO's invoiced state as final and
  // declares any un-invoiced remainder as cancelled (e.g. accepted
  // shortfall after a partial pick). Without bumping qtyCancelled the
  // customer's open AR keeps the un-invoiced remainder as a future
  // commitment - the credit-exposure math
  // (customerOpenSOCommitment) treats partially_invoiced SOs as
  // "more invoices coming" and pads the AR balance even though no
  // further invoice is going to be cut.
  //
  // Net effect for a partially_invoiced SO with a shortfall:
  //   • un-invoiced remainder per line → qtyCancelled
  //   • status → 'closed'
  //   • soCommitment for this SO → 0 in customerSignedAR
  //   • customer Open Balance now reflects only the actual issued
  //     invoice (matches the AR statement's running total).
  // Idempotent: re-running on an already-closed SO is a no-op.
  app.post(
    "/sales-orders/:id/close",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const before = await db.salesOrder.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!before) return reply.code(404).send({ error: { code: "not_found" } });
      if (before.status === "closed" || before.status === "cancelled") {
        return reply.send(
          await db.salesOrder.findUnique({
            where: { id },
            include: fullSoInclude,
          })
        );
      }
      const lineUpdates = before.items
        .map((it) => {
          const remaining = Math.max(
            0,
            it.qtyOrdered - it.qtyInvoiced - it.qtyCancelled
          );
          return remaining > 0
            ? db.salesOrderItem.update({
                where: { id: it.id },
                data: { qtyCancelled: { increment: remaining } },
              })
            : null;
        })
        .filter((u): u is Exclude<typeof u, null> => u !== null);
      if (lineUpdates.length > 0) {
        await db.$transaction(lineUpdates);
      }
      const updated = await db.salesOrder.update({
        where: { id },
        data: { status: "closed" },
        include: fullSoInclude,
      });
      // Cancelled qty drops out of the weight rollup (see
      // recomputeSalesOrderWeight: it uses qtyOrdered - qtyCancelled).
      await recomputeSalesOrderWeight(db, id);
      // Release any remaining bin reservations - the SO is no longer
      // claiming stock for un-invoiced lines.
      try {
        await releaseSalesOrderReservations(id);
      } catch (e) {
        req.log?.warn({ err: e, soId: id }, "releaseSalesOrderReservations failed (close)");
      }
      await recordChange("SalesOrder", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  // Spin off the un-invoiced remainder of a partially-fulfilled SO
  // into a brand-new SO and close the parent. This is the
  // "back-order" path for warehouse shortfalls: the customer still
  // wants the missing units, but we've shipped/invoiced what we
  // could from the original SO and want a clean slate (with its own
  // pick-list, invoice, and AR commitment) for the rest.
  //
  // Effect:
  //   • parent SO: qtyCancelled bumped to absorb the remainder,
  //     status → 'closed'  (so it stops padding open AR)
  //   • new SO: same lines/rates as parent but qty = remaining,
  //     status = 'confirmed', linked to original via `notes`
  //   • bin reservations released on parent, re-applied on the new SO
  //
  // 409 if there's nothing to back-order, or if the SO is in a
  // state where we shouldn't fork it (cancelled / closed already).
  app.post(
    "/sales-orders/:id/back-order",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const parent = await db.salesOrder.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              product: { select: { gstRate: true } },
              variant: { select: { gstRate: true } },
            },
          },
          customer: true,
        },
      });
      if (!parent) {
        return reply.code(404).send({ error: { code: "not_found" } });
      }
      if (["cancelled", "closed"].includes(parent.status)) {
        return reply.code(409).send({
          error: {
            code: "bad_state",
            message: `SO is in '${parent.status}'; cannot create a back-order.`,
          },
        });
      }

      const remainingLines = parent.items
        .map((it) => ({
          item: it,
          qty: Math.max(0, it.qtyOrdered - it.qtyInvoiced - it.qtyCancelled),
        }))
        .filter((l) => l.qty > 0);
      if (remainingLines.length === 0) {
        return reply.code(409).send({
          error: {
            code: "nothing_to_back_order",
            message: "No un-invoiced remainder on this Sales Order.",
          },
        });
      }

      // Build the new SO totals using the parent's per-line rate.
      const sub = remainingLines.reduce(
        (s, l) => s + l.qty * l.item.rate,
        0
      );
      const tax = remainingLines.reduce((s, l) => {
        const gst = resolveGstRate(l.item.product, l.item.variant);
        return s + l.qty * l.item.rate * (gst / 100);
      }, 0);
      const total = sub + tax;

      const newSoNo = await nextDocNo("SO", 2026, 2001);
      const newSo = await db.salesOrder.create({
        data: {
          soNo: newSoNo,
          shareToken: mintShareToken(),
          customerId: parent.customerId,
          notes: `Back-order from ${parent.soNo}`,
          subTotal: sub,
          tax,
          total,
          status: "confirmed",
          items: {
            create: remainingLines.map((l) => ({
              productId: l.item.productId,
              variantId: l.item.variantId,
              qtyOrdered: l.qty,
              rate: l.item.rate,
              amount: l.qty * l.item.rate,
            })),
          },
        },
        include: fullSoInclude,
      });
      await recordChange("SalesOrder", newSo.id, "insert", newSo, req.user.sub);

      // Close the parent: bumps qtyCancelled on every remaining line
      // so soCommitment goes to 0 (the commitment now lives on the
      // back-order SO instead).
      const cancelUpdates = remainingLines.map((l) =>
        db.salesOrderItem.update({
          where: { id: l.item.id },
          data: { qtyCancelled: { increment: l.qty } },
        })
      );
      if (cancelUpdates.length > 0) {
        await db.$transaction(cancelUpdates);
      }
      const closedParent = await db.salesOrder.update({
        where: { id: parent.id },
        data: { status: "closed" },
        include: fullSoInclude,
      });
      // Both ends of the split need their weight recomputed: the
      // parent loses the cancelled remainder and the back-order
      // child carries it onward.
      await recomputeSalesOrderWeight(db, parent.id);
      await recomputeSalesOrderWeight(db, newSo.id);
      try {
        await releaseSalesOrderReservations(parent.id);
      } catch (e) {
        req.log?.warn(
          { err: e, soId: parent.id },
          "releaseSalesOrderReservations failed (back-order parent)"
        );
      }
      try {
        await reserveSalesOrderStock(newSo.id);
      } catch (e) {
        req.log?.warn(
          { err: e, soId: newSo.id },
          "reserveSalesOrderStock failed (back-order child)"
        );
      }
      await recordChange(
        "SalesOrder",
        parent.id,
        "update",
        closedParent,
        req.user.sub
      );

      return { backOrder: newSo, parent: closedParent };
    }
  );

  // Multi-invoice draw-down: each call invoices a chosen qty of one or more
  // SO lines. Stock is decremented at this point. 409 if any line would be
  // over-invoiced or oversold.
  app.post(
    "/sales-orders/:id/invoice",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const body = soInvoiceSchema.parse(req.body);
      const so = await db.salesOrder.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              product: { select: { id: true, sku: true, name: true, uom: true, stockOnHand: true, gstRate: true } },
              variant: {
                select: {
                  id: true,
                  sku: true,
                  uom: true,
                  packSize: true,
                  stockOnHand: true,
                  gstRate: true,
                },
              },
            },
          },
          customer: true,
        },
      });
      if (!so) return reply.code(404).send({ error: { code: "not_found" } });
      if (["cancelled", "closed", "on_hold"].includes(so.status)) {
        return reply.code(409).send({
          error: { code: "bad_state", message: `SO is in '${so.status}'; cannot invoice.` },
        });
      }

      // Pre-generated invoice guard. New SOs (post pre-gen rollout)
      // are minted with an "issued" invoice for the full ordered qty
      // up-front, so calling this legacy "draw-down" endpoint would
      // create a duplicate. Refuse with a 409 that points the
      // operator at the standard pick/pack flow. Legacy SOs from
      // before the rollout still work because they have no
      // pre-generated invoice yet.
      const preGen = await db.invoice.findFirst({
        where: { salesOrderId: id, status: { not: "cancelled" } },
        select: { id: true, invoiceNo: true, status: true, packingSlipId: true },
      });
      if (preGen) {
        return reply.code(409).send({
          error: {
            code: "invoice_already_exists",
            message: `Sales Order ${so.soNo} already has invoice ${preGen.invoiceNo} (${preGen.status}). Use the pack/dispatch flow to finalise it instead of creating a draw-down invoice.`,
            details: { invoiceId: preGen.id, invoiceNo: preGen.invoiceNo },
          },
        });
      }

      // Validate every requested line in one pass and collect issues.
      const issues: { salesOrderItemId: string; reason: string }[] = [];
      const planned: { item: (typeof so.items)[number]; qty: number }[] = [];
      for (const req of body.items) {
        const item = so.items.find((it) => it.id === req.salesOrderItemId);
        if (!item) {
          issues.push({ salesOrderItemId: req.salesOrderItemId, reason: "not_in_so" });
          continue;
        }
        const remaining = item.qtyOrdered - item.qtyInvoiced - item.qtyCancelled;
        if (req.qty > remaining + 1e-6) {
          issues.push({
            salesOrderItemId: req.salesOrderItemId,
            reason: `qty ${req.qty} exceeds remaining ${remaining}`,
          });
          continue;
        }
        const stock = item.variant?.stockOnHand ?? item.product.stockOnHand;
        if (req.qty > stock + 1e-6) {
          issues.push({
            salesOrderItemId: req.salesOrderItemId,
            reason: `oversold: requested ${req.qty}, available ${stock} (${item.product.sku})`,
          });
          continue;
        }
        planned.push({ item, qty: req.qty });
      }
      if (issues.length > 0) {
        return reply.code(409).send({
          error: {
            code: "invoice_blocked",
            message: "One or more lines cannot be invoiced.",
            details: issues,
          },
        });
      }

      // -------- Create invoice + lines + decrement stock + draw down SO --------
      const taxCtx = await getTaxContextForCustomer(so.customer.state, so.placeOfSupplyState);
      if (so.taxKind) taxCtx.taxKind = so.taxKind as TaxKind;
      if (so.pricingInclusive) taxCtx.pricingInclusive = so.pricingInclusive;
      if (so.sellerState) taxCtx.sellerState = so.sellerState;
      if (so.placeOfSupplyState) taxCtx.placeOfSupplyState = so.placeOfSupplyState;

      const doc = computeDocumentTax({
        items: planned.map((p) => ({
          qty: p.qty,
          rate: p.item.rate,
          gstRate: resolveGstRate(p.item.product, p.item.variant, taxCtx.defaultGstRate ?? 18),
        })),
        transportCharge: so.transportCharge ?? 0,
        taxCtx,
      });
      const invoiceNo = await nextDocNo("INV", 2026, 5500);
      const wh = await db.warehouse.findFirst();

      const inv = await db.invoice.create({
        data: {
          invoiceNo,
          shareToken: mintShareToken(),
          customerId: so.customerId,
          salesOrderId: so.id,
          dispatchOptionId: so.dispatchOptionId,
          transportCharge: doc.transportCharge,
          transportTax: doc.transportTax,
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
              const p = planned[idx];
              const fields = lineTaxDbFields(line);
              return {
                productId: p.item.productId,
                variantId: p.item.variantId,
                salesOrderItemId: p.item.id,
                qty: p.qty,
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

      // Stamp Invoice.totalWeightKg from its line items so trip
      // planning / freight rules can use it before a packing slip
      // exists (this is the multi-invoice draw-down path).
      await recomputeInvoiceWeight(db, inv.id);

      // Sweep any standing customer advances against the new invoice
      // FIFO so a prepayment recorded BEFORE this invoice was issued
      // is absorbed immediately (invoice flips to 'paid' or 'partial'
      // instead of staying 'issued' with cash sitting on account).
      await applyAdvancesToInvoice(db, inv.id);

      // Decrement stock + ledger + SO line draw-down (sequential by line so
      // SQLite gets predictable transactions; each loop is small).
      for (const p of planned) {
        if (p.item.variantId) {
          await db.productVariant.update({
            where: { id: p.item.variantId },
            data: { stockOnHand: { decrement: Math.round(p.qty) } },
          });
        } else {
          await db.product.update({
            where: { id: p.item.productId },
            data: { stockOnHand: { decrement: Math.round(p.qty) } },
          });
        }
        await db.salesOrderItem.update({
          where: { id: p.item.id },
          data: { qtyInvoiced: { increment: p.qty } },
        });
        if (wh) {
          await db.stockLedger.create({
            data: {
              productId: p.item.productId,
              variantId: p.item.variantId ?? null,
              warehouseId: wh.id,
              txnType: "Sale",
              qty: -p.qty,
              balance: 0,
              ref: inv.invoiceNo,
            },
          });
        }
      }

      // Roll up SO status
      const refreshed = await db.salesOrder.findUnique({
        where: { id: so.id },
        include: { items: true },
      });
      if (refreshed) {
        const totalOrd = refreshed.items.reduce(
          (s, it) => s + it.qtyOrdered - it.qtyCancelled,
          0
        );
        const totalInv = refreshed.items.reduce((s, it) => s + it.qtyInvoiced, 0);
        const newStatus =
          totalInv >= totalOrd - 1e-6
            ? "invoiced"
            : totalInv > 0
              ? "partially_invoiced"
              : "confirmed";
        if (newStatus !== refreshed.status) {
          const u = await db.salesOrder.update({
            where: { id: so.id },
            data: { status: newStatus },
          });
          await recordChange("SalesOrder", u.id, "update", u, req.user.sub);
        }
      }
      // Invoice draw-down shrinks each line's outstanding qty. Re-run
      // reservation so SO reservations match the new remaining (and
      // free up bin reservedQty for the invoiced portion). For fully
      // invoiced SOs this reduces to release.
      try {
        if (refreshed?.status === "invoiced") {
          await releaseSalesOrderReservations(so.id);
        } else {
          await reserveSalesOrderStock(so.id);
        }
      } catch (e) {
        req.log?.warn({ err: e, soId: so.id }, "reserveSalesOrderStock failed (invoice)");
      }
      await recordChange("Invoice", inv.id, "insert", inv, req.user.sub);
      return inv;
    }
  );

  // =================================================================== ATP ===

  app.get("/stock/atp", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    if (!q.productId) return { error: "productId is required" };
    return computeAtp(q.productId, q.variantId ?? null);
  });
};

// =====================================================================
// Internal: Sales Order materialisation (used both inline and from the
// Approvals decide handler when a credit-hold approval is granted).
// =====================================================================

export const materialiseSO = async (quoteId: string, actor: string) => {
  const quote = await db.quote.findUnique({
    where: { id: quoteId },
    include: { items: true },
  });
  if (!quote) throw new Error("Quote not found");
  if (quote.convertedSalesOrderId) {
    return db.salesOrder.findUnique({
      where: { id: quote.convertedSalesOrderId },
      include: fullSoInclude,
    });
  }
  const soNo = await nextDocNo("SO", 2026, 2001);
  const so = await db.salesOrder.create({
    data: {
      soNo,
      shareToken: mintShareToken(),
      quoteId: quote.id,
      customerId: quote.customerId,
      dispatchOptionId: quote.dispatchOptionId,
      transportCharge: quote.transportCharge,
      transportTax: quote.transportTax,
      subTotal: quote.subTotal,
      tax: quote.tax,
      cgstTotal: quote.cgstTotal,
      sgstTotal: quote.sgstTotal,
      igstTotal: quote.igstTotal,
      taxKind: quote.taxKind,
      placeOfSupplyState: quote.placeOfSupplyState,
      sellerState: quote.sellerState,
      pricingInclusive: quote.pricingInclusive,
      total: quote.total,
      // Inherit weight from the quote (already rolled up at quote
      // create/update). The post-create recompute below makes this
      // resilient to any divergence — e.g. a catalogue weight tweak
      // between quote.accept and quote.convert.
      totalWeightKg: quote.totalWeightKg,
      items: {
        create: quote.items.map((it) => ({
          productId: it.productId,
          variantId: it.variantId,
          qtyOrdered: it.qty,
          rate: it.rate,
          amount: it.amount,
          taxableValue: it.taxableValue,
          gstRate: it.gstRate,
          cgstAmount: it.cgstAmount,
          sgstAmount: it.sgstAmount,
          igstAmount: it.igstAmount,
        })),
      },
    },
    include: fullSoInclude,
  });
  await recomputeSalesOrderWeight(db, so.id);
  await db.quote.update({
    where: { id: quote.id },
    data: { status: "converted", convertedSalesOrderId: so.id },
  });

  // Quote->SO conversion is a back-office (source='internal') path. We
  // intentionally do NOT pre-generate an invoice here: the warehouse
  // packing flow mints it on the fly at pack-complete via the
  // defensive ensureInvoiceForSalesOrder() guard in fulfilment.ts. This
  // matches the user's expectation that back-office SOs only carry an
  // invoice once the goods have actually been packed.

  // Hard-reserve at confirm so the Reserved column on the warehouse
  // bin views immediately reflects committed sales orders.
  try {
    await reserveSalesOrderStock(so.id);
  } catch {
    // Best-effort — shortages don't block conversion.
  }

  await recordChange("SalesOrder", so.id, "insert", so, actor);
  await recordChange("Quote", quote.id, "update", { ...quote, status: "converted" }, actor);
  return so;
};
