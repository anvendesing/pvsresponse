// Pre-generates an Invoice the moment a SalesOrder is confirmed.
//
// Why pre-generate
// ----------------
//   * Customer (and shipping docs) need a stable invoice number from
//     the moment the order is committed. Waiting until pack-complete
//     means warehouse paperwork carries no invoice ref until the very
//     end of the pipeline.
//   * Avoids the "Generate Invoice" button on the desktop packing
//     screen - the slip just has to be linked to the existing
//     invoice when packing finalises. Same UX as ecommerce orders,
//     which already pre-generate the invoice atomically with the SO.
//   * Removes a class of duplicate-invoice race conditions (operator
//     double-clicks, mobile retries, etc.) - the helper is idempotent
//     and always returns the existing invoice if one is already
//     attached to the SO.
//
// What this does NOT do
// ---------------------
//   * It does NOT decrement stock. Stock-on-hand only moves when the
//     packing slip is finalised (or, for ecommerce, at order time -
//     handled by the existing storefront-mock flow). This keeps "what
//     was actually shipped" accurate even if a confirmed order is
//     cancelled before pack.
//   * It does NOT mark the invoice paid. B2B invoices start at
//     status='issued' and move to 'paid' via the regular /pay
//     endpoint. Ecommerce keeps writing 'paid' directly because the
//     payment was already collected at checkout.

import type { Prisma, PrismaClient } from "@prisma/client";
import { mintShareToken } from "../lib/share.js";
import { nextFulfilmentDocNo } from "../lib/pick-list-helpers.js";
import { computeTax, computeGrandTotal } from "../lib/tax.js";
import { applyAdvancesToInvoice } from "../routes/customer-payments.js";
import { recomputeInvoiceWeight } from "../lib/document-weight.js";

type Tx = Prisma.TransactionClient | PrismaClient;

export interface EnsureInvoiceResult {
  invoice: Awaited<ReturnType<Tx["invoice"]["findUnique"]>>;
  created: boolean;
}

// Idempotent: if any invoice already exists for the SO, returns it
// unchanged with `created=false`. Otherwise mints a new one (full
// qtyOrdered amount, status='issued') and returns `created=true`.
//
// Pass an explicit `tx` when calling from inside a $transaction so the
// invoice and SO live in the same atomic write.
export const ensureInvoiceForSalesOrder = async (
  client: Tx,
  salesOrderId: string,
  opts: { paymentMode?: string; status?: string } = {}
): Promise<EnsureInvoiceResult> => {
  const existing = await client.invoice.findFirst({
    where: { salesOrderId },
    orderBy: { createdAt: "asc" },
    include: {
      items: { include: { product: true, variant: true } },
      customer: true,
    },
  });
  if (existing) return { invoice: existing, created: false };

  const so = await client.salesOrder.findUnique({
    where: { id: salesOrderId },
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
  if (!so) {
    throw new Error(`ensureInvoiceForSalesOrder: SO ${salesOrderId} not found`);
  }
  if (so.items.length === 0) {
    throw new Error(
      `ensureInvoiceForSalesOrder: SO ${so.soNo} has no items - cannot mint an invoice.`
    );
  }

  const invoiceNo = await nextFulfilmentDocNo("INV", 2026, 5500);
  const invoice = await client.invoice.create({
    data: {
      invoiceNo,
      shareToken: mintShareToken(),
      customerId: so.customerId,
      salesOrderId: so.id,
      dispatchOptionId: so.dispatchOptionId,
      transportCharge: so.transportCharge,
      transportTax: so.transportTax,
      amount: so.total,
      tax: so.tax,
      status: opts.status ?? "issued",
      paymentMode: opts.paymentMode ?? "credit",
      items: {
        create: so.items.map((it) => {
          const lineGstRate = (it.variant?.gstRate ?? null) ?? it.product.gstRate;
          return {
            productId: it.productId,
            variantId: it.variantId,
            salesOrderItemId: it.id,
            qty: it.qtyOrdered,
            rate: it.rate,
            amount: it.amount,
            gstRate: lineGstRate,
            taxAmount: Math.round(it.amount * (lineGstRate / 100) * 100) / 100,
          };
        }),
      },
    },
    include: {
      items: { include: { product: true, variant: true } },
      customer: true,
    },
  });

  // Stamp totalWeightKg from invoice items (no packing slip yet at
  // this point — pack reconciliation refreshes it later).
  await recomputeInvoiceWeight(client, invoice.id);

  // Sweep the customer's unallocated advance payments against the
  // freshly-created invoice so a prepayment recorded BEFORE the
  // invoice was minted is correctly absorbed (status flips to 'paid'
  // or 'partial' instantly, instead of leaving the invoice in
  // 'issued' with cash sitting on account).
  await applyAdvancesToInvoice(client, invoice.id);
  // Re-read so the caller gets the post-allocation status.
  const final = await client.invoice.findUnique({
    where: { id: invoice.id },
    include: {
      items: { include: { product: true, variant: true } },
      customer: true,
    },
  });

  return { invoice: final, created: true };
};

// Helper used by the packing-slip pack-complete path to bring the
// pre-generated invoice's quantities/amounts in line with what was
// actually packed. If the operator packed less than was ordered, the
// matching invoice line gets shrunk; lines whose qtyPacked is zero
// get removed entirely. Tax / amount on the invoice header are
// recomputed.
//
// Returns the updated invoice. No-op if nothing changed.
export const reconcileInvoiceWithPack = async (
  client: Tx,
  invoiceId: string,
  packed: { salesOrderItemId: string; qtyPacked: number; rate: number }[]
): Promise<Awaited<ReturnType<Tx["invoice"]["findUnique"]>>> => {
  const invoice = await client.invoice.findUnique({
    where: { id: invoiceId },
    include: { items: true },
  });
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

  const packedBySoItem = new Map(
    packed.map((p) => [p.salesOrderItemId, p.qtyPacked])
  );

  let dirty = false;
  for (const it of invoice.items) {
    if (!it.salesOrderItemId) continue;
    const want = packedBySoItem.get(it.salesOrderItemId) ?? 0;
    if (Math.abs(it.qty - want) < 1e-6) continue;
    dirty = true;
    if (want <= 0) {
      await client.invoiceItem.delete({ where: { id: it.id } });
    } else {
      const newAmount = want * it.rate;
      const gst = it.gstRate ?? 18;
      await client.invoiceItem.update({
        where: { id: it.id },
        data: {
          qty: want,
          amount: newAmount,
          taxAmount: Math.round(newAmount * (gst / 100) * 100) / 100,
        },
      });
    }
  }

  if (!dirty) {
    return client.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: { include: { product: true, variant: true } },
        customer: true,
      },
    });
  }

  const remainingItems = await client.invoiceItem.findMany({
    where: { invoiceId },
    select: { amount: true, gstRate: true },
  });
  const sub = remainingItems.reduce((s, r) => s + r.amount, 0);
  const tax = computeTax(
    remainingItems.map((r) => ({ amount: r.amount, gstRate: r.gstRate ?? 18 }))
  );
  const transportCharge = invoice.transportCharge ?? 0;
  const freight = computeGrandTotal(sub, tax, transportCharge);
  await client.invoice.update({
    where: { id: invoiceId },
    data: {
      amount: freight.total,
      tax,
      transportTax: freight.transportTax,
    },
  });

  // Pack reconciliation can drop / shrink lines — refresh weight.
  // We prefer the packing-slip cached value when the slip is linked
  // because it folds in actual scale readings.
  await recomputeInvoiceWeight(client, invoiceId, { preferPackingSlipKg: true });

  return client.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: { include: { product: true, variant: true } },
      customer: true,
    },
  });
};
