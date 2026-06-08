// Accounts-Receivable payment recording for B2B customers.
//
// Design (industry-standard AR):
//   1. Invoice issued  → customer owes money (debit). Open balance grows.
//   2. Payment recorded → allocated oldest-first (FIFO) against open invoices.
//      Each allocation row stores how much of the payment covers a given invoice.
//   3. Invoice status auto-promoted: issued → partial → paid.
//   4. Credit-limit gate in sales.ts uses customerOpenBalance() which reads
//      net-of-allocation amounts, so recording a payment immediately frees
//      up headroom for the next quote.
//
// Endpoints:
//   POST   /v1/customer-payments            – record a payment
//   GET    /v1/customer-payments            – list payments (filter by customerId)
//   GET    /v1/customers/:id/statement      – AR statement with running balance
//   GET    /v1/customers/:id/open-invoices  – open/partial invoices for a customer

import type { FastifyInstance } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { db } from "../db.js";
import { recordChange } from "../sync/log.js";

type Tx = Prisma.TransactionClient | PrismaClient;

// ----------------------------------------------------------------- helpers ---

export const nextPaymentNo = async (): Promise<string> => {
  const rows = await db.customerPayment.findMany({
    where: { paymentNo: { startsWith: "PAY-2026-" } },
    select: { paymentNo: true },
  });
  const tail = rows
    .map((r) => parseInt(r.paymentNo.split("-").pop() ?? "0", 10))
    .filter((n) => Number.isFinite(n));
  const max = tail.length > 0 ? Math.max(...tail) : 999;
  return `PAY-2026-${String(max + 1).padStart(4, "0")}`;
};

// Net unpaid amount for a single invoice (amount – sum of allocations).
export const invoiceOpenAmount = async (invoiceId: string): Promise<number> => {
  const inv = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: { amount: true, status: true },
  });
  if (!inv || inv.status === "paid" || inv.status === "draft") return 0;
  const alloc = await db.customerPaymentAllocation.aggregate({
    where: { invoiceId },
    _sum: { amount: true },
  });
  return Math.max(0, inv.amount - (alloc._sum.amount ?? 0));
};

// Sum of payment amounts that haven't been allocated to any invoice yet.
// These are advances / prepayments — money the customer has put on
// account that should offset future receivables. Cancelled / reversed
// payments are excluded.
export const customerUnallocatedCredits = async (
  customerId: string
): Promise<number> => {
  const payments = await db.customerPayment.findMany({
    where: { customerId },
    select: {
      amount: true,
      allocations: { select: { amount: true } },
    },
  });
  let credit = 0;
  for (const p of payments) {
    const allocated = p.allocations.reduce((s, a) => s + a.amount, 0);
    credit += Math.max(0, p.amount - allocated);
  }
  return credit;
};

// Sum of un-invoiced commitment value across all OPEN sales orders.
// An "open" SO is one we still owe the customer goods on — i.e. it
// hasn't been cancelled, fully invoiced, or closed. Even though no
// invoice has been issued yet, the customer has committed to take and
// pay for these goods, so the value is part of their credit exposure.
//
// Per-line formula:
//   remainingQty = qtyOrdered − qtyInvoiced − qtyCancelled
//   lineExposure = (remainingQty / qtyOrdered) × line.amount      (subtotal)
// Tax is then re-applied at the SO's effective rate so the number is
// directly comparable to invoice amounts (which include tax).
//
// SOs in 'cancelled', 'invoiced', or 'closed' contribute 0 by
// formula. 'on_hold' SOs are still commitments (we're holding stock
// for them) so they DO count — releasing them is an explicit cancel.
export const customerOpenSOCommitment = async (
  customerId: string
): Promise<number> => {
  const sos = await db.salesOrder.findMany({
    where: {
      customerId,
      status: { in: ["confirmed", "partially_invoiced", "on_hold"] },
    },
    include: { items: true },
  });
  let total = 0;
  for (const so of sos) {
    let lineSubtotal = 0;
    for (const it of so.items) {
      const remQty = Math.max(
        0,
        it.qtyOrdered - it.qtyInvoiced - it.qtyCancelled
      );
      const fraction = it.qtyOrdered > 0 ? remQty / it.qtyOrdered : 0;
      lineSubtotal += it.amount * fraction;
    }
    const taxFraction = so.subTotal > 0 ? so.tax / so.subTotal : 0;
    total += lineSubtotal * (1 + taxFraction);
  }
  return total;
};

// Signed net credit exposure for a customer:
//   positive  = they owe us (or are committed to pay us) more than
//               they've paid in advance,
//   zero      = exactly flat,
//   negative  = they have advance/prepayment headroom available.
//
// Formula:
//   signed = (open invoice remainder)
//          + (open SO commitment, un-invoiced)
//          − (unallocated customer payments)
//
// Why each term:
//   • open invoice remainder — money already billed and unpaid.
//   • open SO commitment    — sales orders we've accepted but not yet
//                             invoiced; the customer is on the hook
//                             for these even before the invoice is
//                             cut. This catches the case where a
//                             cash-only customer has multiple open
//                             SOs that haven't reached pack/invoice
//                             yet but together exceed any prepayment
//                             they've made.
//   • unallocated payments  — advances / prepayments. Customer has
//                             put money on account that hasn't been
//                             absorbed by an invoice yet, so it
//                             offsets future receivables.
//
// Callers that only want "amount owed" for UI display should clamp
// to ≥ 0 — see customerNetOpenBalance below.
export const customerSignedAR = async (
  customerId: string
): Promise<number> => {
  const openInvoices = await db.invoice.findMany({
    where: {
      customerId,
      status: { in: ["issued", "partial", "overdue"] },
    },
    select: { id: true, amount: true },
  });
  let invoiceRemainder = 0;
  for (const inv of openInvoices) {
    const alloc = await db.customerPaymentAllocation.aggregate({
      where: { invoiceId: inv.id },
      _sum: { amount: true },
    });
    invoiceRemainder += Math.max(0, inv.amount - (alloc._sum.amount ?? 0));
  }
  const soCommitment = await customerOpenSOCommitment(customerId);
  const credits = await customerUnallocatedCredits(customerId);
  return invoiceRemainder + soCommitment - credits;
};

// Detailed credit-exposure breakdown for diagnostics, approval-reason
// strings, and the customer statement endpoint. Returns the same
// `signed` number customerSignedAR returns so callers can reuse it
// without a second DB roundtrip.
export type CreditExposure = {
  invoiceRemainder: number;
  openSOCommitment: number;
  unallocatedAdvance: number;
  signed: number;
};

// Auto-allocate any standing customer advances against a freshly
// created invoice. Industry-standard AR behaviour: when a payment
// arrives BEFORE its invoice (a prepayment), the unallocated balance
// sits on account; the moment the invoice IS issued, the system
// should sweep advances against it FIFO until either the invoice is
// covered or the advances are exhausted.
//
// Without this helper, an invoice can sit at status='issued' for
// ever even though the customer has clearly paid for it — the
// allocation simply never happened because the FIFO loop in
// POST /customer-payments only ran at payment time.
//
// Called from every invoice-creation channel:
//   • POST /invoices (POS walk-in, paymentMode='credit')
//   • POST /sales-orders/:id/invoice (B2B SO draw-down)
//   • ensureInvoiceForSalesOrder (auto pack-complete invoice)
//
// Idempotent and safe to call multiple times. If the invoice is
// already 'paid' or 'draft', it's a no-op.
//
// Pass the transaction client when calling from inside $transaction
// so the allocation lives atomically with the invoice insert.
export interface ApplyAdvancesResult {
  invoiceId: string;
  allocatedNow: number;
  newStatus: string;
  remainder: number;
}

export const applyAdvancesToInvoice = async (
  client: Tx,
  invoiceId: string
): Promise<ApplyAdvancesResult> => {
  const inv = await client.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, customerId: true, amount: true, status: true },
  });
  if (!inv) {
    throw new Error(`applyAdvancesToInvoice: invoice ${invoiceId} not found`);
  }
  if (inv.status === "paid" || inv.status === "draft") {
    return {
      invoiceId,
      allocatedNow: 0,
      newStatus: inv.status,
      remainder: 0,
    };
  }

  const existingAlloc = await client.customerPaymentAllocation.aggregate({
    where: { invoiceId },
    _sum: { amount: true },
  });
  let outstanding = Math.max(
    0,
    inv.amount - (existingAlloc._sum.amount ?? 0)
  );
  if (outstanding < 0.005) {
    // Already fully allocated — promote to 'paid' if the status is
    // lagging and bail.
    await client.invoice.update({
      where: { id: invoiceId },
      data: { status: "paid" },
    });
    return { invoiceId, allocatedNow: 0, newStatus: "paid", remainder: 0 };
  }

  // Find the customer's payments oldest-first and sweep their
  // unallocated portion against this invoice.
  const payments = await client.customerPayment.findMany({
    where: { customerId: inv.customerId },
    orderBy: { paymentDate: "asc" },
    include: { allocations: { select: { amount: true } } },
  });

  let allocatedNow = 0;
  for (const p of payments) {
    if (outstanding < 0.005) break;
    const used = p.allocations.reduce((s, a) => s + a.amount, 0);
    const free = Math.max(0, p.amount - used);
    if (free < 0.005) continue;
    const apply = Math.min(free, outstanding);
    await client.customerPaymentAllocation.create({
      data: {
        paymentId: p.id,
        invoiceId,
        amount: apply,
      },
    });
    outstanding -= apply;
    allocatedNow += apply;
  }

  // Compute final status. If the invoice is now fully paid → 'paid'.
  // If anything was applied → 'partial' (or stays 'overdue' if it
  // was already overdue and remainder>0). Otherwise unchanged.
  let newStatus = inv.status;
  if (outstanding < 0.005) {
    newStatus = "paid";
  } else if (allocatedNow > 0) {
    // Preserve 'overdue' if the bill was already past due — the
    // partial payment doesn't reset the dunning clock.
    newStatus = inv.status === "overdue" ? "overdue" : "partial";
  }
  if (newStatus !== inv.status) {
    await client.invoice.update({
      where: { id: invoiceId },
      data: { status: newStatus },
    });
  }

  return {
    invoiceId,
    allocatedNow,
    newStatus,
    remainder: Math.max(0, outstanding),
  };
};

export const customerCreditExposure = async (
  customerId: string
): Promise<CreditExposure> => {
  const [openInvoices, soCommitment, unallocatedAdvance] = await Promise.all([
    db.invoice.findMany({
      where: {
        customerId,
        status: { in: ["issued", "partial", "overdue"] },
      },
      select: { id: true, amount: true },
    }),
    customerOpenSOCommitment(customerId),
    customerUnallocatedCredits(customerId),
  ]);
  let invoiceRemainder = 0;
  for (const inv of openInvoices) {
    const alloc = await db.customerPaymentAllocation.aggregate({
      where: { invoiceId: inv.id },
      _sum: { amount: true },
    });
    invoiceRemainder += Math.max(0, inv.amount - (alloc._sum.amount ?? 0));
  }
  return {
    invoiceRemainder,
    openSOCommitment: soCommitment,
    unallocatedAdvance,
    signed: invoiceRemainder + soCommitment - unallocatedAdvance,
  };
};

// Total open AR for a customer (≥ 0 only) — what the customer "owes
// us". Subtracts unallocated payments (advances) so a prepayment
// reduces the displayed balance, mirroring the AR-statement
// running-balance view.
export const customerNetOpenBalance = async (
  customerId: string
): Promise<number> => {
  const signed = await customerSignedAR(customerId);
  return Math.max(0, signed);
};

// ------------------------------------------------------------------ route ---

const createSchema = z.object({
  customerId: z.string(),
  amount: z.number().positive("Amount must be positive"),
  mode: z.enum(["cash", "upi", "bank_transfer", "cheque", "credit_note"]),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  paymentDate: z.string().optional(), // ISO date string; defaults to now
  // Optional manual allocation: [{invoiceId, amount}]. If omitted, FIFO auto-alloc.
  allocations: z
    .array(
      z.object({
        invoiceId: z.string(),
        amount: z.number().positive(),
      })
    )
    .optional(),
});

export const customerPaymentRoutes = async (app: FastifyInstance) => {
  // ── POST /customer-payments ──────────────────────────────────────────────
  app.post(
    "/customer-payments",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const body = createSchema.parse(req.body);

      const customer = await db.customer.findUnique({
        where: { id: body.customerId },
      });
      if (!customer) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "Customer not found" } });
      }

      const paymentDate = body.paymentDate
        ? new Date(body.paymentDate)
        : new Date();

      // Resolve allocations: manual or FIFO auto-allocation.
      let allocLines: { invoiceId: string; amount: number }[];

      if (body.allocations && body.allocations.length > 0) {
        const allocTotal = body.allocations.reduce((s, a) => s + a.amount, 0);
        if (Math.abs(allocTotal - body.amount) > 0.005) {
          return reply.code(400).send({
            error: {
              code: "alloc_mismatch",
              message: `Allocation total ${allocTotal.toFixed(2)} must equal payment amount ${body.amount.toFixed(2)}`,
            },
          });
        }
        allocLines = body.allocations;
      } else {
        // FIFO: fetch open invoices oldest first and fill them.
        const openInvoices = await db.invoice.findMany({
          where: {
            customerId: body.customerId,
            status: { in: ["issued", "partial", "overdue"] },
          },
          orderBy: { date: "asc" },
          select: { id: true, amount: true },
        });

        let remaining = body.amount;
        allocLines = [];
        for (const inv of openInvoices) {
          if (remaining <= 0) break;
          const open = await invoiceOpenAmount(inv.id);
          if (open <= 0) continue;
          const apply = Math.min(remaining, open);
          allocLines.push({ invoiceId: inv.id, amount: apply });
          remaining -= apply;
        }
        // Any unallocated remainder stays as an unmatched credit on the payment
        // (allocations simply don't cover the full amount — visible in statement).
      }

      // Write payment + allocations in a transaction.
      const paymentNo = await nextPaymentNo();
      const payment = await db.$transaction(async (tx) => {
        const pmt = await tx.customerPayment.create({
          data: {
            paymentNo,
            customerId: body.customerId,
            amount: body.amount,
            mode: body.mode,
            reference: body.reference ?? null,
            notes: body.notes ?? null,
            paymentDate,
            allocations: {
              create: allocLines,
            },
          },
          include: {
            allocations: {
              include: { invoice: { select: { invoiceNo: true, amount: true } } },
            },
          },
        });

        // Update invoice statuses based on total allocations.
        for (const alloc of pmt.allocations) {
          const totalPaid = await tx.customerPaymentAllocation.aggregate({
            where: { invoiceId: alloc.invoiceId },
            _sum: { amount: true },
          });
          const inv = await tx.invoice.findUnique({
            where: { id: alloc.invoiceId },
            select: { amount: true },
          });
          if (!inv) continue;
          const paidSoFar = totalPaid._sum.amount ?? 0;
          let newStatus: string;
          if (paidSoFar >= inv.amount - 0.005) {
            newStatus = "paid";
          } else if (paidSoFar > 0) {
            newStatus = "partial";
          } else {
            continue;
          }
          await tx.invoice.update({
            where: { id: alloc.invoiceId },
            data: { status: newStatus },
          });
        }

        return pmt;
      });

      await recordChange(
        "CustomerPayment",
        payment.id,
        "insert",
        payment,
        req.user.sub
      );

      return reply.code(201).send(payment);
    }
  );

  // ── GET /customer-payments ───────────────────────────────────────────────
  app.get(
    "/customer-payments",
    { preHandler: [app.authenticate] },
    async (req) => {
      const q = (req.query as Record<string, string>) ?? {};
      const where = q.customerId ? { customerId: q.customerId } : {};
      const payments = await db.customerPayment.findMany({
        where,
        orderBy: { paymentDate: "desc" },
        include: {
          customer: { select: { id: true, code: true, name: true } },
          allocations: {
            include: {
              invoice: { select: { id: true, invoiceNo: true, amount: true } },
            },
          },
        },
        take: 200,
      });
      return payments;
    }
  );

  // ── GET /customers/:id/open-invoices ─────────────────────────────────────
  app.get(
    "/customers/:id/open-invoices",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const customer = await db.customer.findUnique({ where: { id } });
      if (!customer)
        return reply.code(404).send({ error: { code: "not_found" } });

      const invoices = await db.invoice.findMany({
        where: {
          customerId: id,
          status: { in: ["issued", "partial", "overdue"] },
        },
        orderBy: { date: "asc" },
        select: {
          id: true,
          invoiceNo: true,
          date: true,
          amount: true,
          status: true,
          salesOrder: { select: { soNo: true } },
          paymentAllocations: { select: { amount: true } },
        },
      });

      return invoices.map((inv) => {
        const paid = inv.paymentAllocations.reduce(
          (s, a) => s + a.amount,
          0
        );
        return {
          id: inv.id,
          invoiceNo: inv.invoiceNo,
          date: inv.date,
          amount: inv.amount,
          paidAmount: paid,
          openAmount: Math.max(0, inv.amount - paid),
          status: inv.status,
          soNo: inv.salesOrder?.soNo ?? null,
        };
      });
    }
  );

  // ── GET /customers/:id/statement ─────────────────────────────────────────
  // AR statement: interleaved invoices (debits) and payments (credits),
  // sorted by date, with a running balance column.
  app.get(
    "/customers/:id/statement",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const q = (req.query as Record<string, string>) ?? {};

      const customer = await db.customer.findUnique({
        where: { id },
        select: {
          id: true,
          code: true,
          name: true,
          creditLimit: true,
        },
      });
      if (!customer)
        return reply.code(404).send({ error: { code: "not_found" } });

      // Date range (optional)
      const from = q.from ? new Date(q.from) : undefined;
      const to = q.to ? new Date(q.to) : undefined;
      const dateFilter = from || to
        ? {
            gte: from,
            lte: to,
          }
        : undefined;

      const [invoices, payments] = await Promise.all([
        db.invoice.findMany({
          where: {
            customerId: id,
            status: { notIn: ["draft"] },
            ...(dateFilter ? { date: dateFilter } : {}),
          },
          orderBy: { date: "asc" },
          select: {
            id: true,
            invoiceNo: true,
            date: true,
            amount: true,
            status: true,
            salesOrder: { select: { soNo: true } },
            paymentAllocations: { select: { amount: true } },
          },
        }),
        db.customerPayment.findMany({
          where: {
            customerId: id,
            ...(dateFilter ? { paymentDate: dateFilter } : {}),
          },
          orderBy: { paymentDate: "asc" },
          select: {
            id: true,
            paymentNo: true,
            paymentDate: true,
            amount: true,
            mode: true,
            reference: true,
            notes: true,
          },
        }),
      ]);

      // Build unified ledger entries and sort by date.
      type LedgerEntry = {
        date: Date;
        type: "invoice" | "payment";
        ref: string;
        description: string;
        debit: number;
        credit: number;
        balance: number; // computed below
        status?: string;
      };

      const entries: LedgerEntry[] = [
        ...invoices.map((inv) => ({
          date: inv.date,
          type: "invoice" as const,
          ref: inv.invoiceNo,
          description: inv.salesOrder
            ? `Invoice for ${inv.salesOrder.soNo}`
            : "Walk-in invoice",
          debit: inv.amount,
          credit: 0,
          balance: 0,
          status: inv.status,
        })),
        ...payments.map((p) => ({
          date: p.paymentDate,
          type: "payment" as const,
          ref: p.paymentNo,
          description: [
            `Payment (${p.mode.replace("_", " ")})`,
            p.reference ? `Ref: ${p.reference}` : null,
            p.notes,
          ]
            .filter(Boolean)
            .join(" · "),
          debit: 0,
          credit: p.amount,
          balance: 0,
        })),
      ].sort((a, b) => a.date.getTime() - b.date.getTime());

      // Running balance (positive = customer owes us).
      let running = 0;
      for (const e of entries) {
        running += e.debit - e.credit;
        e.balance = running;
      }

      // Open balance is the public, clamped-to-zero figure used in the
      // KPI strip. The breakdown lets the UI explain *why* the open
      // balance is higher than the AR ledger's running total — it's
      // the un-invoiced SO commitment from partially_invoiced SOs
      // (warehouse shortfalls, back-orders, etc) that pad the
      // customer's credit exposure.
      const exposure = await customerCreditExposure(id);
      const openBalance = Math.max(0, exposure.signed);
      const availableCredit =
        customer.creditLimit > 0
          ? Math.max(0, customer.creditLimit - openBalance)
          : null;

      // Surface every SO that's contributing to openSOCommitment so
      // the UI can offer one-tap actions. We match the same status
      // filter as customerOpenSOCommitment (confirmed, partially_invoiced,
      // on_hold) — historical bug where pack-complete didn't always
      // roll the SO from 'confirmed' → 'partially_invoiced' meant
      // shortfall-padded SOs were invisible to the original
      // status-equals-partially_invoiced query.
      const candidateSos = await db.salesOrder.findMany({
        where: {
          customerId: id,
          status: { in: ["confirmed", "partially_invoiced", "on_hold"] },
        },
        include: { items: true, invoices: { select: { id: true } } },
        orderBy: { orderDate: "desc" },
      });
      const partialSoSummaries = candidateSos
        .map((so) => {
          const totalOrd = so.items.reduce(
            (s, it) => s + it.qtyOrdered - it.qtyCancelled,
            0
          );
          const totalInv = so.items.reduce((s, it) => s + it.qtyInvoiced, 0);
          const remainingQty = Math.max(0, totalOrd - totalInv);
          const fraction = totalOrd > 0 ? totalInv / totalOrd : 0;
          return {
            id: so.id,
            soNo: so.soNo,
            status: so.status,
            total: so.total,
            invoicedFraction: fraction,
            remainingCommitment: Math.max(0, so.total * (1 - fraction)),
            remainingQty,
            hasIssuedInvoice: so.invoices.length > 0,
          };
        })
        // Banner is for SOs where we've already issued an invoice and
        // a remainder is still hanging. Untouched 'confirmed' SOs (no
        // invoice yet, full commitment) are not the user's problem to
        // solve here — they're normal AR exposure.
        .filter((s) => s.hasIssuedInvoice && s.remainingQty > 0);

      return {
        customer: {
          ...customer,
          openBalance,
          availableCredit,
        },
        breakdown: {
          invoiceRemainder: exposure.invoiceRemainder,
          openSOCommitment: exposure.openSOCommitment,
          unallocatedAdvance: exposure.unallocatedAdvance,
        },
        partiallyInvoicedSOs: partialSoSummaries,
        entries,
      };
    }
  );
};
