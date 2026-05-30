// Customer Returns / RMA module.
//
// Flow:
//   1. Staff imports an Excel file (SKU | QTY | REASON | NOTES) for a customer.
//      Server resolves each SKU to a source invoice line (using the optional
//      invoiceId anchor or the customer's most-recent eligible invoice per SKU).
//   2. An Approval inbox row is created so a manager can act; the return header
//      stays in status "pending_approval".
//   3. Approvers open the Return drawer and approve/reject each line individually.
//   4. POST /returns/:id/finalize closes all pending lines, issues a CreditNote
//      (+ CustomerPayment allocation) for the approved lines, and transitions
//      the header to "processed".
//
// Endpoints (all under /v1):
//   GET    /returns                        – list (filters: status, customerId, from, to)
//   GET    /returns/:id                    – detail
//   GET    /returns/template.xlsx          – blank import template
//   POST   /returns/import-xlsx?dryRun=1   – preview (no DB writes)
//   POST   /returns/import-xlsx            – commit
//   POST   /returns/:id/lines/:lineId/decide – per-line approve/reject
//   POST   /returns/:id/finalize           – bulk finalize + issue credit note
//   POST   /returns/:id/cancel             – cancel a pending return
//   GET    /credit-notes/:id               – credit note detail (share-link friendly)

import type { FastifyInstance } from "fastify";
import ExcelJS from "exceljs";
import { z } from "zod";
import { db } from "../db.js";
import { mintShareToken } from "../lib/share.js";
import { nextDocNo } from "./sales.js";
import { nextPaymentNo, invoiceOpenAmount } from "./customer-payments.js";
import { recordChange } from "../sync/log.js";
import { computeTax } from "../lib/tax.js";

// ------------------------------------------------------------------ helpers ---

const VALID_REASONS = [
  "damaged",
  "wrong_item",
  "defective",
  "not_as_described",
  "expired",
  "changed_mind",
  "other",
] as const;
type ReturnReason = (typeof VALID_REASONS)[number];

// Sum already-approved return qty for a given (product, variant) combination
// on a specific invoice so we can gate new returns against the invoiced qty.
const priorApprovedReturnQty = async (
  productId: string,
  variantId: string | null,
  invoiceItemId: string
): Promise<number> => {
  const rows = await db.customerReturnItem.findMany({
    where: {
      productId,
      variantId: variantId ?? undefined,
      invoiceItemId,
      decision: "approved",
    },
    select: { qty: true },
  });
  return rows.reduce((s, r) => s + r.qty, 0);
};

// Build the full include shape used by detail / list responses.
const returnInclude = {
  customer: { select: { id: true, code: true, name: true } },
  invoice: { select: { id: true, invoiceNo: true, amount: true } },
  items: {
    include: {
      product: { select: { id: true, sku: true, name: true } },
      variant: { select: { id: true, sku: true, size: true } },
    },
    orderBy: { id: "asc" as const },
  },
  creditNote: {
    select: {
      id: true,
      creditNoteNo: true,
      total: true,
      status: true,
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
export const returnsRoutes = async (app: FastifyInstance) => {
  // ── GET /returns ────────────────────────────────────────────────────────────
  app.get("/returns", { preHandler: [app.authenticate] }, async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const where: Record<string, unknown> = {};
    if (q.status) where.status = q.status;
    if (q.customerId) where.customerId = q.customerId;
    if (q.from || q.to) {
      where.createdAt = {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lte: new Date(q.to) } : {}),
      };
    }
    return db.customerReturn.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        customer: { select: { id: true, code: true, name: true } },
        creditNote: { select: { id: true, creditNoteNo: true, total: true } },
      },
    });
  });

  // ── GET /returns/template.xlsx ──────────────────────────────────────────────
  // Must be registered BEFORE /returns/:id so "template.xlsx" is not treated
  // as an id param.
  app.get(
    "/returns/template.xlsx",
    { preHandler: [app.authenticate] },
    async (_req, reply) => {
      const wb = new ExcelJS.Workbook();
      wb.creator = "PvsCommerce ERP";

      // Hidden lookup sheet for in-Excel data validation.
      const lookup = wb.addWorksheet("_reasons");
      lookup.state = "hidden";
      VALID_REASONS.forEach((r, i) => {
        lookup.getCell(i + 1, 1).value = r;
      });

      const ws = wb.addWorksheet("Returns");
      ws.views = [{ state: "frozen", ySplit: 1 }];

      // Header row
      const headers = ["SKU", "QTY", "REASON", "NOTES (optional)"];
      headers.forEach((h, i) => {
        const cell = ws.getCell(1, i + 1);
        cell.value = h;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF385F1C" },
        };
      });

      // Sample row
      ws.getCell(2, 1).value = "EXAMPLE-SKU-001";
      ws.getCell(2, 2).value = 1;
      ws.getCell(2, 3).value = "damaged";
      ws.getCell(2, 4).value = "Arrived broken";

      // Data validation on REASON column (C), rows 2-200
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ws as any).dataValidations?.add?.("C2:C200", {
        type: "list",
        allowBlank: false,
        formulae: [`'_reasons'!$A$1:$A$${VALID_REASONS.length}`],
        showErrorMessage: true,
        errorTitle: "Invalid reason",
        error: `Must be one of: ${VALID_REASONS.join(", ")}`,
      });

      // Column widths
      ws.getColumn(1).width = 24;
      ws.getColumn(2).width = 10;
      ws.getColumn(3).width = 22;
      ws.getColumn(4).width = 40;

      const buf = await wb.xlsx.writeBuffer();
      reply.header(
        "Content-Disposition",
        'attachment; filename="returns-template.xlsx"'
      );
      reply.header(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      return reply.send(buf);
    }
  );

  // ── GET /returns/:id ────────────────────────────────────────────────────────
  app.get(
    "/returns/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const doc = await db.customerReturn.findUnique({
        where: { id },
        include: returnInclude,
      });
      if (!doc)
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "Return not found" } });
      return doc;
    }
  );

  // ── POST /returns/import-xlsx ───────────────────────────────────────────────
  app.post(
    "/returns/import-xlsx",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const dryRun = (req.query as Record<string, string>).dryRun === "1";

      // ── Collect multipart fields (fields must come before the file part) ──
      let customerId = "";
      let invoiceId: string | undefined;
      let notes: string | undefined;
      let fileBuffer: Buffer | undefined;

      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === "field") {
          if (part.fieldname === "customerId")
            customerId = String(part.value);
          else if (part.fieldname === "invoiceId")
            invoiceId = String(part.value) || undefined;
          else if (part.fieldname === "notes")
            notes = String(part.value) || undefined;
        } else {
          fileBuffer = await part.toBuffer();
        }
      }

      if (!fileBuffer) {
        return reply
          .code(400)
          .send({ error: { code: "missing_file", message: "No file uploaded" } });
      }
      if (!customerId) {
        return reply.code(400).send({
          error: { code: "missing_customer", message: "customerId is required" },
        });
      }

      // Validate customer
      const customer = await db.customer.findUnique({
        where: { id: customerId },
        select: { id: true, code: true, name: true, active: true },
      });
      if (!customer) {
        return reply.code(404).send({
          error: { code: "customer_not_found", message: "Customer not found" },
        });
      }
      if (!customer.active) {
        return reply.code(409).send({
          error: {
            code: "customer_inactive",
            message: "Customer is inactive",
          },
        });
      }

      // Validate optional invoice anchor
      let anchorInvoice: {
        id: string;
        invoiceNo: string;
        items: {
          id: string;
          productId: string;
          variantId: string | null;
          qty: number;
          rate: number;
        }[];
      } | null = null;

      if (invoiceId) {
        anchorInvoice = await db.invoice.findUnique({
          where: { id: invoiceId },
          select: {
            id: true,
            invoiceNo: true,
            items: {
              select: {
                id: true,
                productId: true,
                variantId: true,
                qty: true,
                rate: true,
              },
            },
          },
        });
        if (!anchorInvoice) {
          return reply.code(404).send({
            error: {
              code: "invoice_not_found",
              message: "Invoice not found",
            },
          });
        }
      }

      // ── Parse Excel ──────────────────────────────────────────────────────────
      const wb = new ExcelJS.Workbook();
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await wb.xlsx.load(fileBuffer as any);
      } catch {
        return reply.code(400).send({
          error: { code: "invalid_xlsx", message: "Could not parse xlsx file" },
        });
      }

      const ws = wb.getWorksheet("Returns") ?? wb.getWorksheet(1);
      if (!ws) {
        return reply.code(400).send({
          error: {
            code: "missing_sheet",
            message: 'Workbook has no "Returns" sheet',
          },
        });
      }

      // Merge duplicate SKUs (sum qty)
      const skuMap = new Map<
        string,
        { qty: number; reason: string; reasonNotes: string | undefined; row: number }
      >();
      ws.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // header
        const sku = String(row.getCell(1).value ?? "").trim();
        const rawQty = row.getCell(2).value;
        const reason = String(row.getCell(3).value ?? "").trim().toLowerCase();
        const reasonNotes =
          String(row.getCell(4).value ?? "").trim() || undefined;
        if (!sku) return;
        const qty = typeof rawQty === "number" ? rawQty : parseFloat(String(rawQty));
        if (!isFinite(qty) || qty <= 0) return;
        const existing = skuMap.get(sku);
        if (existing) {
          existing.qty += qty;
        } else {
          skuMap.set(sku, { qty, reason, reasonNotes, row: rowNumber });
        }
      });

      if (skuMap.size === 0) {
        return reply.code(422).send({
          error: {
            code: "nothing_to_return",
            message: "No rows with qty > 0 found",
            rejected: [],
          },
        });
      }

      // ── Per-SKU resolution ───────────────────────────────────────────────────
      type AcceptedLine = {
        productId: string;
        variantId: string | null;
        invoiceItemId: string;
        sku: string;
        productName: string;
        qty: number;
        rate: number;
        amount: number;
        gstRate: number;
        reason: ReturnReason;
        reasonNotes: string | undefined;
      };
      type RejectedLine = {
        sku: string;
        row: number;
        qty: number;
        reason: string;
      };

      const accepted: AcceptedLine[] = [];
      const rejected: RejectedLine[] = [];

      for (const [sku, entry] of skuMap) {
        // Validate reason
        if (!VALID_REASONS.includes(entry.reason as ReturnReason)) {
          rejected.push({
            sku,
            row: entry.row,
            qty: entry.qty,
            reason: `invalid_reason: "${entry.reason}" — must be one of ${VALID_REASONS.join(", ")}`,
          });
          continue;
        }
        const reason = entry.reason as ReturnReason;

        // Resolve product / variant
        const variant = await db.productVariant.findFirst({
          where: { sku },
          select: { id: true, productId: true, sku: true },
        });
        let productId: string;
        let variantId: string | null = null;

        if (variant) {
          productId = variant.productId;
          variantId = variant.id;
        } else {
          const product = await db.product.findFirst({
            where: { sku },
            select: { id: true },
          });
          if (!product) {
            rejected.push({ sku, row: entry.row, qty: entry.qty, reason: "sku_not_found" });
            continue;
          }
          productId = product.id;
        }

        // Resolve source invoice item
        let invoiceItem: {
          id: string;
          qty: number;
          rate: number;
          invoiceId: string;
          gstRate: number | null;
        } | null = null;

        if (anchorInvoice) {
          const hit = anchorInvoice.items.find(
            (it) =>
              it.productId === productId &&
              (variantId ? it.variantId === variantId : true)
          );
          if (!hit) {
            rejected.push({
              sku,
              row: entry.row,
              qty: entry.qty,
              reason: "sku_not_on_anchor_invoice",
            });
            continue;
          }
          invoiceItem = {
            id: hit.id,
            qty: hit.qty,
            rate: hit.rate,
            invoiceId: anchorInvoice.id,
            gstRate: (hit as { gstRate?: number | null }).gstRate ?? null,
          };
        } else {
          // Find most-recent eligible invoice for this customer + product
          const invItem = await db.invoiceItem.findFirst({
            where: {
              productId,
              variantId: variantId ?? undefined,
              invoice: {
                customerId,
                status: { in: ["issued", "partial", "overdue", "paid"] },
              },
            },
            orderBy: { invoice: { date: "desc" } },
            select: {
              id: true,
              qty: true,
              rate: true,
              invoiceId: true,
              gstRate: true,
            },
          });
          if (!invItem) {
            rejected.push({
              sku,
              row: entry.row,
              qty: entry.qty,
              reason: "no_source_invoice",
            });
            continue;
          }
          invoiceItem = invItem;
        }

        // Check prior approved returns on this invoice item
        const alreadyReturned = await priorApprovedReturnQty(
          productId,
          variantId,
          invoiceItem.id
        );
        const maxReturnableQty = invoiceItem.qty - alreadyReturned;
        if (entry.qty > maxReturnableQty) {
          rejected.push({
            sku,
            row: entry.row,
            qty: entry.qty,
            reason: `qty_exceeds_returnable: max ${maxReturnableQty} (invoiced ${invoiceItem.qty}, already returned ${alreadyReturned})`,
          });
          continue;
        }

        const productRow = await db.product.findUnique({
          where: { id: productId },
          select: { name: true },
        });

        accepted.push({
          productId,
          variantId,
          invoiceItemId: invoiceItem.id,
          sku,
          productName: productRow?.name ?? sku,
          qty: entry.qty,
          rate: invoiceItem.rate,
          amount: Math.round(entry.qty * invoiceItem.rate * 100) / 100,
          gstRate: invoiceItem.gstRate ?? 18,
          reason,
          reasonNotes: entry.reasonNotes,
        });
      }

      // Compute totals using per-line GST from invoice snapshot
      const subTotal = accepted.reduce((s, l) => s + l.amount, 0);
      const tax = computeTax(accepted.map((l) => ({ amount: l.amount, gstRate: l.gstRate })));
      const total = Math.round((subTotal + tax) * 100) / 100;

      if (accepted.length === 0) {
        return reply.code(422).send({
          error: {
            code: "nothing_to_return",
            message: "All rows were rejected",
            rejected,
          },
        });
      }

      if (dryRun) {
        return {
          dryRun: true,
          accepted,
          rejected,
          subTotal,
          tax,
          total,
          customer: { id: customer.id, name: customer.name, code: customer.code },
          invoice: anchorInvoice
            ? { id: anchorInvoice.id, invoiceNo: anchorInvoice.invoiceNo }
            : null,
        };
      }

      // ── Commit ───────────────────────────────────────────────────────────────
      const returnNo = await nextDocNo("CRN", 2026, 3001);
      const doc = await db.customerReturn.create({
        data: {
          returnNo,
          shareToken: mintShareToken(),
          customerId,
          invoiceId: invoiceId ?? null,
          notes: notes ?? null,
          subTotal,
          tax,
          total,
          importedById: req.user.sub,
          items: {
            create: accepted.map((l) => ({
              productId: l.productId,
              variantId: l.variantId,
              invoiceItemId: l.invoiceItemId,
              qty: l.qty,
              rate: l.rate,
              amount: l.amount,
              reason: l.reason,
              reasonNotes: l.reasonNotes ?? null,
            })),
          },
        },
        include: returnInclude,
      });

      // Create an Approval inbox row so managers see it without polling
      await db.approval.create({
        data: {
          ref: doc.returnNo,
          type: "Customer Return",
          requestedBy: req.user.name,
          amount: doc.total,
          priority: "med",
          reason: `Customer return ${doc.returnNo} for ${customer.name} — ${accepted.length} line(s), ₹${total.toFixed(2)} total`,
        },
      });

      await recordChange("CustomerReturn", doc.id, "insert", doc, req.user.sub);

      return reply.code(201).send({
        dryRun: false,
        returnId: doc.id,
        returnNo: doc.returnNo,
        accepted: accepted.length,
        rejected,
        subTotal,
        tax,
        total,
        customer: { id: customer.id, name: customer.name, code: customer.code },
      });
    }
  );

  // ── POST /returns/:id/lines/:lineId/decide ───────────────────────────────────
  app.post(
    "/returns/:id/lines/:lineId/decide",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id, lineId } = req.params as { id: string; lineId: string };
      const body = z
        .object({
          decision: z.enum(["approved", "rejected"]),
          notes: z.string().max(500).optional(),
        })
        .parse(req.body);

      const doc = await db.customerReturn.findUnique({ where: { id } });
      if (!doc)
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "Return not found" } });
      if (doc.status !== "pending_approval") {
        return reply.code(409).send({
          error: {
            code: "already_processed",
            message: `Return is ${doc.status}, not pending_approval`,
          },
        });
      }

      const line = await db.customerReturnItem.findUnique({
        where: { id: lineId },
      });
      if (!line || line.customerReturnId !== id) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "Line not found" } });
      }

      const updated = await db.customerReturnItem.update({
        where: { id: lineId },
        data: {
          decision: body.decision,
          decisionNotes: body.notes ?? null,
          decidedById: req.user.sub,
          decidedAt: new Date(),
        },
      });
      return updated;
    }
  );

  // ── POST /returns/:id/finalize ───────────────────────────────────────────────
  app.post(
    "/returns/:id/finalize",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z
        .object({
          decisions: z
            .array(
              z.object({
                lineId: z.string(),
                decision: z.enum(["approved", "rejected"]),
                notes: z.string().max(500).optional(),
              })
            )
            .optional()
            .default([]),
        })
        .parse(req.body);

      const doc = await db.customerReturn.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!doc)
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "Return not found" } });
      if (doc.status !== "pending_approval") {
        return reply.code(409).send({
          error: {
            code: "already_processed",
            message: `Return is already ${doc.status}`,
          },
        });
      }

      // Apply late-bound decisions from the request body
      const now = new Date();
      for (const d of body.decisions) {
        await db.customerReturnItem.update({
          where: { id: d.lineId },
          data: {
            decision: d.decision,
            decisionNotes: d.notes ?? null,
            decidedById: req.user.sub,
            decidedAt: now,
          },
        });
      }

      // Re-fetch items after applying decisions
      const items = await db.customerReturnItem.findMany({
        where: { customerReturnId: id },
      });

      const stillPending = items.filter((i) => i.decision === "pending");
      if (stillPending.length > 0) {
        return reply.code(409).send({
          error: {
            code: "lines_pending",
            message: `${stillPending.length} line(s) still pending a decision`,
            pendingLineIds: stillPending.map((i) => i.id),
          },
        });
      }

      const approvedItems = items.filter((i) => i.decision === "approved");

      // Resolve per-line GST rate from the original InvoiceItem snapshots.
      const invoiceItemIds = approvedItems
        .map((i) => i.invoiceItemId)
        .filter(Boolean) as string[];
      const invItemsGst = invoiceItemIds.length
        ? await db.invoiceItem.findMany({
            where: { id: { in: invoiceItemIds } },
            select: { id: true, gstRate: true },
          })
        : [];
      const invItemGstMap = new Map(invItemsGst.map((ii) => [ii.id, ii.gstRate ?? 18]));

      const cnSubTotal =
        Math.round(approvedItems.reduce((s, i) => s + i.amount, 0) * 100) / 100;
      const cnTax = computeTax(
        approvedItems.map((i) => ({
          amount: i.amount,
          gstRate: i.invoiceItemId ? (invItemGstMap.get(i.invoiceItemId) ?? 18) : 18,
        }))
      );
      const cnTotal = Math.round((cnSubTotal + cnTax) * 100) / 100;

      // ── Run everything in a single transaction ───────────────────────────────
      const result = await db.$transaction(async (tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let creditNote: any = null;

        if (approvedItems.length > 0) {
          // Create CreditNote document
          const creditNoteNo = await nextDocNo("CN", 2026, 4001);
          creditNote = await tx.creditNote.create({
            data: {
              creditNoteNo,
              shareToken: mintShareToken(),
              customerId: doc.customerId,
              customerReturnId: id,
              invoiceId: doc.invoiceId ?? null,
              subTotal: cnSubTotal,
              tax: cnTax,
              total: cnTotal,
              createdById: req.user.sub,
              notes: `Credit note for return ${doc.returnNo}`,
              items: {
                create: approvedItems.map((li) => {
                  const lineGst = li.invoiceItemId ? (invItemGstMap.get(li.invoiceItemId) ?? 18) : 18;
                  return {
                    productId: li.productId,
                    variantId: li.variantId,
                    qty: li.qty,
                    rate: li.rate,
                    amount: li.amount,
                    gstRate: lineGst,
                    taxAmount: Math.round(li.amount * (lineGst / 100) * 100) / 100,
                    reason: li.reason,
                    returnItemId: li.id,
                  };
                }),
              },
            },
          });

          // Create CustomerPayment (credit_note mode) and FIFO allocations
          const paymentNo = await nextPaymentNo();
          const payment = await tx.customerPayment.create({
            data: {
              paymentNo,
              customerId: doc.customerId,
              amount: cnTotal,
              mode: "credit_note",
              reference: creditNoteNo,
              notes: `Auto-generated for ${creditNoteNo}`,
            },
          });

          // FIFO allocation: prefer the anchor invoice first, then oldest open
          const openInvoices = await tx.invoice.findMany({
            where: {
              customerId: doc.customerId,
              status: { in: ["issued", "partial", "overdue"] },
            },
            orderBy: [
              // Anchor invoice first (if any)
              { id: doc.invoiceId ? "asc" : "asc" },
              { date: "asc" },
            ],
            select: { id: true, amount: true },
          });

          // Move anchor to front if set
          const sorted = doc.invoiceId
            ? [
                ...openInvoices.filter((i) => i.id === doc.invoiceId),
                ...openInvoices.filter((i) => i.id !== doc.invoiceId),
              ]
            : openInvoices;

          let remaining = cnTotal;
          for (const inv of sorted) {
            if (remaining <= 0.005) break;
            const open = await invoiceOpenAmount(inv.id);
            if (open <= 0.005) continue;
            const apply = Math.min(remaining, open);
            await tx.customerPaymentAllocation.create({
              data: {
                paymentId: payment.id,
                invoiceId: inv.id,
                amount: apply,
              },
            });
            remaining -= apply;

            // Update invoice status
            const totalAllocated = await tx.customerPaymentAllocation.aggregate({
              where: { invoiceId: inv.id },
              _sum: { amount: true },
            });
            const totalPaid = totalAllocated._sum.amount ?? 0;
            const invRecord = await tx.invoice.findUnique({
              where: { id: inv.id },
              select: { amount: true },
            });
            if (invRecord) {
              const newStatus =
                totalPaid >= invRecord.amount - 0.005
                  ? "paid"
                  : totalPaid > 0
                    ? "partial"
                    : undefined;
              if (newStatus) {
                await tx.invoice.update({
                  where: { id: inv.id },
                  data: { status: newStatus },
                });
              }
            }
          }

          // Link payment back to the CreditNote
          await tx.creditNote.update({
            where: { id: creditNote.id },
            data: {
              customerPaymentId: payment.id,
              invoiceId: sorted[0]?.id ?? doc.invoiceId ?? null,
            },
          });
        }

        // Transition return header
        const updatedDoc = await tx.customerReturn.update({
          where: { id },
          data: {
            status: "processed",
            finalizedById: req.user.sub,
            finalizedAt: now,
          },
          include: returnInclude,
        });

        // Close the Approval inbox row
        await tx.approval.updateMany({
          where: { ref: doc.returnNo, type: "Customer Return", status: "pending" },
          data: {
            status: approvedItems.length > 0 ? "approved" : "rejected",
            decidedBy: req.user.name,
            decidedAt: now,
          },
        });

        return { doc: updatedDoc, creditNote };
      });

      await recordChange(
        "CustomerReturn",
        id,
        "update",
        result.doc,
        req.user.sub
      );
      if (result.creditNote) {
        await recordChange(
          "CreditNote",
          result.creditNote.id,
          "insert",
          result.creditNote,
          req.user.sub
        );
      }

      return result;
    }
  );

  // ── POST /returns/:id/cancel ─────────────────────────────────────────────────
  app.post(
    "/returns/:id/cancel",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const doc = await db.customerReturn.findUnique({ where: { id } });
      if (!doc)
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "Return not found" } });
      if (doc.status !== "pending_approval") {
        return reply.code(409).send({
          error: {
            code: "cannot_cancel",
            message: `Return is ${doc.status}, only pending_approval returns can be cancelled`,
          },
        });
      }

      const updated = await db.$transaction(async (tx) => {
        const upd = await tx.customerReturn.update({
          where: { id },
          data: { status: "cancelled" },
          include: returnInclude,
        });
        await tx.approval.updateMany({
          where: { ref: doc.returnNo, type: "Customer Return", status: "pending" },
          data: {
            status: "rejected",
            decidedBy: req.user.name,
            decidedAt: new Date(),
            reason: "Return cancelled by staff",
          },
        });
        return upd;
      });

      await recordChange("CustomerReturn", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  // ── GET /credit-notes/:id ────────────────────────────────────────────────────
  app.get(
    "/credit-notes/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const cn = await db.creditNote.findUnique({
        where: { id },
        include: {
          customer: { select: { id: true, code: true, name: true, gst: true } },
          invoice: {
            select: { id: true, invoiceNo: true, amount: true, date: true },
          },
          customerReturn: {
            select: {
              id: true,
              returnNo: true,
              createdAt: true,
            },
          },
          items: {
            include: {
              product: { select: { id: true, sku: true, name: true } },
              variant: { select: { id: true, sku: true, size: true } },
            },
          },
        },
      });
      if (!cn)
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "Credit note not found" } });
      return cn;
    }
  );
};
