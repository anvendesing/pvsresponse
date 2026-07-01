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
import { allocateInvoiceNumber } from "../lib/document-series.js";
import { computeLineTax, computeTransportTax, type TaxKind } from "../lib/tax.js";
import { getCompanyTaxContext } from "../lib/company-tax.js";
import { applyAdvancesToInvoice } from "../routes/customer-payments.js";
import { recomputeInvoiceWeight } from "../lib/document-weight.js";
import { aggregateLineTaxes } from "../lib/tax.js";

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
      items: true,
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

  const pricingInclusive = so.pricingInclusive ?? false;

  const { documentNo: invoiceNo, seriesId, seriesSeq } = await allocateInvoiceNumber(
    client,
    { customerId: so.customerId, source: so.source }
  );
  const invoice = await client.invoice.create({
    data: {
      invoiceNo,
      documentSeriesId: seriesId,
      seriesSeq,
      shareToken: mintShareToken(),
      customerId: so.customerId,
      salesOrderId: so.id,
      dispatchOptionId: so.dispatchOptionId,
      transportCharge: so.transportCharge,
      transportTax: so.transportTax,
      amount: so.total,
      tax: so.tax,
      cgstTotal: so.cgstTotal,
      sgstTotal: so.sgstTotal,
      igstTotal: so.igstTotal,
      taxKind: so.taxKind,
      placeOfSupplyState: so.placeOfSupplyState,
      sellerState: so.sellerState,
      pricingInclusive: so.pricingInclusive,
      status: opts.status ?? "issued",
      paymentMode: opts.paymentMode ?? "credit",
      items: {
        create: so.items.map((it) => ({
          productId: it.productId,
          variantId: it.variantId,
          salesOrderItemId: it.id,
          qty: it.qtyOrdered,
          rate: it.rate,
          amount: it.amount,
          taxableValue: it.taxableValue ?? it.amount,
          gstRate: it.gstRate,
          taxAmount:
            (it.cgstAmount ?? 0) + (it.sgstAmount ?? 0) + (it.igstAmount ?? 0),
          cgstAmount: it.cgstAmount,
          sgstAmount: it.sgstAmount,
          igstAmount: it.igstAmount,
        })),
      },
    },
    include: {
      items: { include: { product: true, variant: true } },
      customer: true,
    },
  });

  await recomputeInvoiceWeight(client, invoice.id);
  await applyAdvancesToInvoice(client, invoice.id);
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

  const taxKind = (invoice.taxKind ?? "intra") as TaxKind;
  const pricingInclusive = invoice.pricingInclusive ?? false;

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
      const gst = it.gstRate ?? 18;
      const lineTax = computeLineTax(
        { qty: want, rate: it.rate, gstRate: gst },
        { inclusive: false, taxKind }
      );
      await client.invoiceItem.update({
        where: { id: it.id },
        data: {
          qty: want,
          amount: lineTax.taxableValue,
          taxableValue: lineTax.taxableValue,
          taxAmount: lineTax.totalTax,
          cgstAmount: lineTax.cgst,
          sgstAmount: lineTax.sgst,
          igstAmount: lineTax.igst,
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
    select: {
      amount: true,
      gstRate: true,
      cgstAmount: true,
      sgstAmount: true,
      igstAmount: true,
    },
  });
  const lineTaxes = remainingItems.map((r) => ({
    taxableValue: r.amount,
    cgst: r.cgstAmount ?? 0,
    sgst: r.sgstAmount ?? 0,
    igst: r.igstAmount ?? 0,
    totalTax: (r.cgstAmount ?? 0) + (r.sgstAmount ?? 0) + (r.igstAmount ?? 0),
    gross: r.amount + ((r.cgstAmount ?? 0) + (r.sgstAmount ?? 0) + (r.igstAmount ?? 0)),
  }));
  const agg = aggregateLineTaxes(lineTaxes);
  const transportCharge = invoice.transportCharge ?? 0;
  const { transportGstEnabled } = await getCompanyTaxContext();
  const freight = computeTransportTax(transportCharge, taxKind, transportGstEnabled ?? true);
  await client.invoice.update({
    where: { id: invoiceId },
    data: {
      amount: agg.subTotal + agg.tax + transportCharge + freight.totalTax,
      tax: agg.tax,
      cgstTotal: agg.cgstTotal,
      sgstTotal: agg.sgstTotal,
      igstTotal: agg.igstTotal,
      transportTax: freight.totalTax,
    },
  });

  await recomputeInvoiceWeight(client, invoiceId, { preferPackingSlipKg: true });

  return client.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: { include: { product: true, variant: true } },
      customer: true,
    },
  });
};
