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
import { recordChange } from "../sync/log.js";
import { resolveGstRate, computeTax } from "../lib/tax.js";

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
  items: z.array(quoteItemSchema).min(1),
});

const quoteUpdate = z.object({
  customerId: z.string().optional(),
  validUntil: z.string().datetime().optional(),
  paymentTerms: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
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

const computeTotals = (
  items: { qty: number; rate: number; discount?: number; gstRate?: number }[]
): { subTotal: number; tax: number; total: number; lines: number[] } => {
  const amounts = items.map((it) => it.qty * it.rate * (1 - (it.discount ?? 0) / 100));
  const subTotal = amounts.reduce((s, n) => s + n, 0);
  const taxLines = items.map((it, i) => ({
    amount: amounts[i],
    gstRate: it.gstRate ?? 18,
  }));
  const tax = computeTax(taxLines);
  return { subTotal, tax, total: subTotal + tax, lines: amounts };
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

const customerOpenBalance = async (customerId: string): Promise<number> => {
  // Outstanding = net unpaid (invoice amount minus any payment allocations).
  // This matches customerNetOpenBalance in customer-payments.ts but is
  // inlined here to avoid a circular import.
  const openInvoices = await db.invoice.findMany({
    where: {
      customerId,
      status: { in: ["issued", "partial", "overdue"] },
    },
    select: { id: true, amount: true },
  });
  let total = 0;
  for (const inv of openInvoices) {
    const alloc = await db.customerPaymentAllocation.aggregate({
      where: { invoiceId: inv.id },
      _sum: { amount: true },
    });
    total += Math.max(0, inv.amount - (alloc._sum.amount ?? 0));
  }
  return total;
};

const variantLineSelect = {
  id: true,
  sku: true,
  size: true,
  color: true,
  grade: true,
  uom: true,
  packSize: true,
  stockOnHand: true,
} as const;

const fullQuoteInclude = {
  customer: { select: { id: true, code: true, name: true, gst: true, city: true, creditLimit: true } },
  items: {
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true, stockOnHand: true } },
      variant: { select: variantLineSelect },
    },
  },
  revisions: { orderBy: { revision: "asc" as const } },
} as const;

const fullSoInclude = {
  customer: { select: { id: true, code: true, name: true, gst: true, city: true } },
  items: {
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true, stockOnHand: true } },
      variant: { select: variantLineSelect },
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
  // On-hand: variant if specified, otherwise parent product
  let onHand = 0;
  if (variantId) {
    const v = await db.productVariant.findUnique({ where: { id: variantId }, select: { stockOnHand: true } });
    onHand = v?.stockOnHand ?? 0;
  } else {
    const p = await db.product.findUnique({ where: { id: productId }, select: { stockOnHand: true } });
    onHand = p?.stockOnHand ?? 0;
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
  // double-count it in the ATP calculation.
  const binAgg = await db.bin.aggregate({
    _sum: { reservedQty: true },
    where: { productId },
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
        customer: { select: { id: true, code: true, name: true, city: true } },
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
        customer: { select: { name: true, gst: true, city: true, contact: true } },
        items: {
          include: {
            product: { select: { name: true, sku: true, uom: true, hsn: true } },
            variant: { select: { sku: true, size: true, color: true, grade: true } },
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
      total: quote.total,
      createdAt: quote.createdAt,
      customer: quote.customer,
      items: quote.items.map((it) => ({
        productName: it.product.name,
        productSku: it.product.sku,
        hsn: it.product.hsn,
        uom: it.product.uom,
        variantSku: it.variant?.sku ?? null,
        variantAttrs: [it.variant?.size, it.variant?.color, it.variant?.grade]
          .filter((x) => x && String(x).trim())
          .join(" · "),
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
    const lineRates = await resolveLineGstRates(body.items);
    const totals = computeTotals(body.items.map((it, i) => ({ ...it, gstRate: lineRates[i] })));
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
        subTotal: totals.subTotal,
        tax: totals.tax,
        total: totals.total,
        createdById: req.user.sub,
        items: {
          create: body.items.map((it, i) => ({
            productId: it.productId,
            variantId: it.variantId ?? null,
            qty: it.qty,
            rate: it.rate,
            discount: it.discount ?? 0,
            amount: totals.lines[i],
            requiredBy: it.requiredBy ? new Date(it.requiredBy) : null,
          })),
        },
      },
      include: fullQuoteInclude,
    });
    await recordChange("Quote", created.id, "insert", created, req.user.sub);
    return created;
  });

  app.patch("/quotes/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = quoteUpdate.parse(req.body);
    const before = await db.quote.findUnique({ where: { id } });
    if (!before) return reply.code(404).send({ error: { code: "not_found" } });

    if (["accepted", "converted", "rejected"].includes(before.status)) {
      return reply.code(409).send({
        error: {
          code: "locked",
          message: `Quote in status '${before.status}' cannot be edited. Create a new quote instead.`,
        },
      });
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

    if (items !== undefined) {
      const lineRates = await resolveLineGstRates(items);
      const totals = computeTotals(items.map((it, i) => ({ ...it, gstRate: lineRates[i] })));
      headerData.subTotal = totals.subTotal;
      headerData.tax = totals.tax;
      headerData.total = totals.total;
      // Replace items wholesale - simpler than diffing; old items go via cascade.
      await db.quoteItem.deleteMany({ where: { quoteId: id } });
      await db.quoteItem.createMany({
        data: items.map((it, i) => ({
          quoteId: id,
          productId: it.productId,
          variantId: it.variantId ?? null,
          qty: it.qty,
          rate: it.rate,
          discount: it.discount ?? 0,
          amount: totals.lines[i],
          requiredBy: it.requiredBy ? new Date(it.requiredBy) : null,
        })),
      });
    }

    const updated = await db.quote.update({
      where: { id },
      data: headerData,
      include: fullQuoteInclude,
    });
    await recordChange("Quote", id, "update", updated, req.user.sub);
    return updated;
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
    if (!["submitted", "draft"].includes(quote.status)) {
      return reply.code(409).send({
        error: { code: "bad_state", message: `Cannot accept a quote in '${quote.status}'.` },
      });
    }

    // -------- Credit-limit gate --------
    // A breach is anything that would leave the customer's projected open
    // balance above their credit limit. Customers with a 0 limit are
    // cash-only -> any non-zero balance is a breach and requires approval.
    const limit = quote.customer.creditLimit ?? 0;
    const open = await customerOpenBalance(quote.customerId);
    if (open + quote.total > limit) {
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
            reason: `Customer ${quote.customer.name} would exceed credit limit (₹${limit.toLocaleString(
              "en-IN"
            )}). Open balance ₹${open.toLocaleString("en-IN")} + this quote ₹${quote.total.toLocaleString(
              "en-IN"
            )}.`,
          },
        }));
      const updated = await db.quote.update({
        where: { id },
        data: { status: "accepted", acceptedAt: new Date() },
        include: fullQuoteInclude,
      });
      await recordChange("Quote", id, "update", updated, req.user.sub);
      return reply.code(202).send({
        creditHold: true,
        approvalId: approval.id,
        quote: updated,
        message:
          "Quote accepted but converting to a Sales Order requires credit-limit approval.",
      });
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
        customer: { select: { id: true, code: true, name: true, city: true } },
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

  app.post("/sales-orders", { preHandler: [app.authenticate] }, async (req) => {
    const body = soDirectCreate.parse(req.body);
    const lineRates = await resolveLineGstRates(body.items);
    const totals = computeTotals(body.items.map((it, i) => ({ ...it, gstRate: lineRates[i] })));
    const soNo = await nextDocNo("SO", 2026, 2001);
    const so = await db.salesOrder.create({
      data: {
        soNo,
        shareToken: mintShareToken(),
        customerId: body.customerId,
        notes: body.notes ?? null,
        subTotal: totals.subTotal,
        tax: totals.tax,
        total: totals.total,
        items: {
          create: body.items.map((it, i) => ({
            productId: it.productId,
            variantId: it.variantId ?? null,
            qtyOrdered: it.qty,
            rate: it.rate,
            amount: totals.lines[i],
          })),
        },
      },
      include: fullSoInclude,
    });
    await recordChange("SalesOrder", so.id, "insert", so, req.user.sub);

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
    await recordChange("SalesOrder", id, "update", updated, req.user.sub);
    return updated;
  });

  app.post(
    "/sales-orders/:id/close",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const before = await db.salesOrder.findUnique({ where: { id } });
      if (!before) return reply.code(404).send({ error: { code: "not_found" } });
      const updated = await db.salesOrder.update({
        where: { id },
        data: { status: "closed" },
        include: fullSoInclude,
      });
      await recordChange("SalesOrder", id, "update", updated, req.user.sub);
      return updated;
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
      const sub = planned.reduce((s, p) => s + p.qty * p.item.rate, 0);
      const tax = computeTax(
        planned.map((p) => ({
          amount: p.qty * p.item.rate,
          gstRate: resolveGstRate(p.item.product, p.item.variant),
        }))
      );
      const invoiceNo = await nextDocNo("INV", 2026, 5500);
      const wh = await db.warehouse.findFirst();

      const inv = await db.invoice.create({
        data: {
          invoiceNo,
          shareToken: mintShareToken(),
          customerId: so.customerId,
          salesOrderId: so.id,
          amount: sub + tax,
          tax,
          paymentMode: body.paymentMode,
          status: "issued",
          items: {
            create: planned.map((p) => {
              const lineAmount = p.qty * p.item.rate;
              const lineGstRate = resolveGstRate(p.item.product, p.item.variant);
              return {
                productId: p.item.productId,
                variantId: p.item.variantId,
                salesOrderItemId: p.item.id,
                qty: p.qty,
                rate: p.item.rate,
                amount: lineAmount,
                gstRate: lineGstRate,
                taxAmount: Math.round(lineAmount * (lineGstRate / 100) * 100) / 100,
              };
            }),
          },
        },
        include: {
          items: { include: { product: true, variant: true } },
          customer: true,
        },
      });

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
      subTotal: quote.subTotal,
      tax: quote.tax,
      total: quote.total,
      items: {
        create: quote.items.map((it) => ({
          productId: it.productId,
          variantId: it.variantId,
          qtyOrdered: it.qty,
          rate: it.rate,
          amount: it.amount,
        })),
      },
    },
    include: fullSoInclude,
  });
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

  await recordChange("SalesOrder", so.id, "insert", so, actor);
  await recordChange("Quote", quote.id, "update", { ...quote, status: "converted" }, actor);
  return so;
};
