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
import { z } from "zod";
import { db } from "../db.js";
import { recordChange } from "../sync/log.js";

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

// Total open AR for a customer = sum of open amounts across outstanding invoices.
export const customerNetOpenBalance = async (customerId: string): Promise<number> => {
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

      const openBalance = await customerNetOpenBalance(id);
      const availableCredit =
        customer.creditLimit > 0
          ? Math.max(0, customer.creditLimit - openBalance)
          : null;

      return {
        customer: {
          ...customer,
          openBalance,
          availableCredit,
        },
        entries,
      };
    }
  );
};
