// Estimated shipping weight rollups for sales documents
// (Quote / SalesOrder / Invoice).
//
// Same formula across all three docs:
//
//   totalWeightKg = round2( Σ line.qty * unitWeightKg(variant, product) )
//
// where `unitWeightKg` is the catalogue-aware helper that prefers
// variant.weightKg → product.weightKg → parseSizeToKg(variant.size).
//
// The rollup is called from every mutation path: Quote create / patch /
// item add-remove, Quote → SO conversion, SO create, Invoice create
// (direct + ensureInvoiceForSalesOrder + reconcileInvoiceWithPack).
// For pack-derived invoices we prefer the already-cached packing-slip
// weight (which folds in actual scale readings when present) over a
// fresh sum of line items.
//
// Each helper persists the new value with a single UPDATE and returns
// it so callers can include it in their response without a second read.

import type { PrismaClient } from "@prisma/client";
import { unitWeightKg } from "./variant-weight.js";

const round2 = (n: number) => Math.round(n * 100) / 100;

type ItemRow = {
  qty: number;
  variant: { weightKg?: number | null; size?: string | null } | null;
  product: { weightKg?: number | null };
};

/** Pure sum helper, exported for places that already have items in memory. */
export const sumDocumentWeightKg = (items: ItemRow[]): number =>
  round2(
    items.reduce((s, it) => s + it.qty * unitWeightKg(it.variant, it.product), 0)
  );

// ---------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------
type QuoteDb = Pick<PrismaClient, "quote" | "quoteItem">;

export const recomputeQuoteWeight = async (
  db: QuoteDb,
  quoteId: string
): Promise<number> => {
  const items = await db.quoteItem.findMany({
    where: { quoteId },
    select: {
      qty: true,
      product: { select: { weightKg: true } },
      variant: { select: { weightKg: true, size: true } },
    },
  });
  const kg = sumDocumentWeightKg(items);
  await db.quote.update({
    where: { id: quoteId },
    data: { totalWeightKg: kg },
  });
  return kg;
};

// ---------------------------------------------------------------------
// SalesOrder
// ---------------------------------------------------------------------
type SoDb = Pick<PrismaClient, "salesOrder" | "salesOrderItem">;

export const recomputeSalesOrderWeight = async (
  db: SoDb,
  salesOrderId: string
): Promise<number> => {
  const items = await db.salesOrderItem.findMany({
    where: { salesOrderId },
    select: {
      // qtyOrdered is the source of truth for "how much we promised
      // to ship" — cancellations are subtracted because cancelled
      // qty isn't going to be loaded onto a truck.
      qtyOrdered: true,
      qtyCancelled: true,
      product: { select: { weightKg: true } },
      variant: { select: { weightKg: true, size: true } },
    },
  });
  const kg = sumDocumentWeightKg(
    items.map((it) => ({
      qty: Math.max(0, it.qtyOrdered - it.qtyCancelled),
      product: it.product,
      variant: it.variant,
    }))
  );
  await db.salesOrder.update({
    where: { id: salesOrderId },
    data: { totalWeightKg: kg },
  });
  return kg;
};

// ---------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------
type InvoiceDb = Pick<PrismaClient, "invoice" | "invoiceItem">;

/**
 * Recompute Invoice.totalWeightKg from its line items. If
 * `preferPackingSlipKg` is true (the common B2B case) we copy the
 * packing slip's cached weight instead — that one already folds in
 * actual scale readings when the packer recorded them.
 */
export const recomputeInvoiceWeight = async (
  db: InvoiceDb & Pick<PrismaClient, "packingSlip">,
  invoiceId: string,
  opts: { preferPackingSlipKg?: boolean } = {}
): Promise<number> => {
  const inv = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: { packingSlipId: true },
  });
  if (!inv) return 0;

  if (opts.preferPackingSlipKg && inv.packingSlipId) {
    const slip = await db.packingSlip.findUnique({
      where: { id: inv.packingSlipId },
      select: { totalActualWeightKg: true, totalEstWeightKg: true },
    });
    if (slip) {
      const kg = round2(slip.totalActualWeightKg ?? slip.totalEstWeightKg ?? 0);
      await db.invoice.update({
        where: { id: invoiceId },
        data: { totalWeightKg: kg },
      });
      return kg;
    }
  }

  const items = await db.invoiceItem.findMany({
    where: { invoiceId },
    select: {
      qty: true,
      product: { select: { weightKg: true } },
      variant: { select: { weightKg: true, size: true } },
    },
  });
  const kg = sumDocumentWeightKg(items);
  await db.invoice.update({
    where: { id: invoiceId },
    data: { totalWeightKg: kg },
  });
  return kg;
};
