// Shareable document endpoints (Invoice / Sales Order / Packing Slip).
// Quotes have their own equivalent in sales.ts because they also need
// revision-aware sanitization. The patterns are identical:
//
//   GET  /v1/public/<docs>/:token   - anonymous, sanitized projection
//   POST /v1/<docs>/:id/rotate-share-token - authenticated, mints/rotates
//
// Lazy-minting in the rotate endpoint means we don't need every legacy
// row to already have a token; the first share action will issue one.

import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { mintShareToken } from "../lib/share.js";

export const shareRoutes = async (app: FastifyInstance) => {
  // --------------------------------------------------------- INVOICE
  app.get("/public/invoices/:token", async (req, reply) => {
    const token = (req.params as { token: string }).token;
    if (!token || token.length < 8) {
      return reply.code(404).send({ error: { code: "not_found" } });
    }
    const inv = await db.invoice.findUnique({
      where: { shareToken: token },
      include: {
        customer: { select: { name: true, gst: true, city: true, contact: true } },
        salesOrder: { select: { soNo: true } },
        packingSlip: { select: { packingSlipNo: true } },
        items: {
          include: {
            product: { select: { name: true, sku: true, uom: true, hsn: true } },
            variant: {
              select: {
                sku: true,
                size: true,
                color: true,
                grade: true,
                uom: true,
                packSize: true,
              },
            },
          },
        },
      },
    });
    if (!inv) return reply.code(404).send({ error: { code: "not_found" } });
    // Customer-facing projection: no internal IDs, no audit columns.
    return {
      invoiceNo: inv.invoiceNo,
      status: inv.status,
      date: inv.date,
      paymentMode: inv.paymentMode,
      notes: inv.notes,
      tax: inv.tax,
      amount: inv.amount,
      transportCharge: inv.transportCharge,
      transportTax: inv.transportTax,
      createdAt: inv.createdAt,
      customer: inv.customer,
      salesOrderNo: inv.salesOrder?.soNo ?? null,
      packingSlipNo: inv.packingSlip?.packingSlipNo ?? null,
      items: inv.items.map((it) => ({
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
        amount: it.amount,
      })),
    };
  });

  app.post(
    "/invoices/:id/rotate-share-token",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const inv = await db.invoice.findUnique({ where: { id } });
      if (!inv) return reply.code(404).send({ error: { code: "not_found" } });
      const updated = await db.invoice.update({
        where: { id },
        data: { shareToken: mintShareToken() },
      });
      return { shareToken: updated.shareToken };
    }
  );

  // ----------------------------------------------------- SALES ORDER
  app.get("/public/sales-orders/:token", async (req, reply) => {
    const token = (req.params as { token: string }).token;
    if (!token || token.length < 8) {
      return reply.code(404).send({ error: { code: "not_found" } });
    }
    const so = await db.salesOrder.findUnique({
      where: { shareToken: token },
      include: {
        customer: { select: { name: true, gst: true, city: true, contact: true } },
        quote: { select: { quoteNo: true } },
        items: {
          include: {
            product: { select: { name: true, sku: true, uom: true, hsn: true } },
            variant: {
              select: {
                sku: true,
                size: true,
                color: true,
                grade: true,
                uom: true,
                packSize: true,
              },
            },
          },
        },
      },
    });
    if (!so) return reply.code(404).send({ error: { code: "not_found" } });
    return {
      soNo: so.soNo,
      status: so.status,
      orderDate: so.orderDate,
      notes: so.notes,
      subTotal: so.subTotal,
      tax: so.tax,
      transportCharge: so.transportCharge,
      transportTax: so.transportTax,
      total: so.total,
      createdAt: so.createdAt,
      quoteNo: so.quote?.quoteNo ?? null,
      customer: so.customer,
      items: so.items.map((it) => ({
        productName: it.product.name,
        productSku: it.product.sku,
        hsn: it.product.hsn,
        uom: it.product.uom,
        variantSku: it.variant?.sku ?? null,
        variantAttrs: [it.variant?.size, it.variant?.color, it.variant?.grade]
          .filter((x) => x && String(x).trim())
          .join(" · "),
        qtyOrdered: it.qtyOrdered,
        qtyInvoiced: it.qtyInvoiced,
        qtyCancelled: it.qtyCancelled,
        rate: it.rate,
        amount: it.amount,
      })),
    };
  });

  app.post(
    "/sales-orders/:id/rotate-share-token",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const so = await db.salesOrder.findUnique({ where: { id } });
      if (!so) return reply.code(404).send({ error: { code: "not_found" } });
      const updated = await db.salesOrder.update({
        where: { id },
        data: { shareToken: mintShareToken() },
      });
      return { shareToken: updated.shareToken };
    }
  );

  // ----------------------------------------------------- PACKING SLIP
  app.get("/public/packing-slips/:token", async (req, reply) => {
    const token = (req.params as { token: string }).token;
    if (!token || token.length < 8) {
      return reply.code(404).send({ error: { code: "not_found" } });
    }
    const ps = await db.packingSlip.findUnique({
      where: { shareToken: token },
      include: {
        salesOrder: {
          select: {
            soNo: true,
            customer: {
              select: { name: true, gst: true, city: true, contact: true },
            },
          },
        },
        invoice: { select: { invoiceNo: true } },
        items: {
          include: {
            product: { select: { name: true, sku: true, uom: true, hsn: true } },
            variant: {
              select: {
                sku: true,
                size: true,
                color: true,
                grade: true,
                uom: true,
                packSize: true,
              },
            },
          },
        },
      },
    });
    if (!ps) return reply.code(404).send({ error: { code: "not_found" } });
    return {
      packingSlipNo: ps.packingSlipNo,
      status: ps.status,
      packedAt: ps.packedAt,
      notes: ps.notes,
      createdAt: ps.createdAt,
      soNo: ps.salesOrder.soNo,
      invoiceNo: ps.invoice?.invoiceNo ?? null,
      customer: ps.salesOrder.customer,
      items: ps.items.map((it) => ({
        productName: it.product.name,
        productSku: it.product.sku,
        hsn: it.product.hsn,
        uom: it.product.uom,
        variantSku: it.variant?.sku ?? null,
        variantAttrs: [it.variant?.size, it.variant?.color, it.variant?.grade]
          .filter((x) => x && String(x).trim())
          .join(" · "),
        qtyOrdered: it.qtyOrdered,
        qtyPicked: it.qtyPicked,
        qtyPacked: it.qtyPacked,
        rate: it.rate,
        amount: it.amount,
      })),
    };
  });

  app.post(
    "/packing-slips/:id/rotate-share-token",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const ps = await db.packingSlip.findUnique({ where: { id } });
      if (!ps) return reply.code(404).send({ error: { code: "not_found" } });
      const updated = await db.packingSlip.update({
        where: { id },
        data: { shareToken: mintShareToken() },
      });
      return { shareToken: updated.shareToken };
    }
  );

  // ---------------------------------------------------- PURCHASE ORDER
  // Vendor-facing read-only PO. Shows our buyer details (so the vendor
  // knows whose PO it is) plus the PO header, line items and notes.
  // GRN history is intentionally omitted - it's our internal record,
  // not the vendor's.
  app.get("/public/purchase-orders/:token", async (req, reply) => {
    const token = (req.params as { token: string }).token;
    if (!token || token.length < 8) {
      return reply.code(404).send({ error: { code: "not_found" } });
    }
    const po = await db.purchaseOrder.findUnique({
      where: { shareToken: token },
      include: {
        vendor: {
          select: {
            name: true,
            code: true,
            gst: true,
            city: true,
            address: true,
            contact: true,
            email: true,
            paymentTerms: true,
          },
        },
        items: {
          include: {
            product: { select: { name: true, sku: true, uom: true, hsn: true } },
          },
        },
      },
    });
    if (!po) return reply.code(404).send({ error: { code: "not_found" } });
    return {
      poNo: po.poNo,
      status: po.status,
      date: po.date,
      expectedDate: po.expectedDate,
      amount: po.amount,
      receivedPct: po.receivedPct,
      notes: po.notes,
      createdAt: po.createdAt,
      vendor: po.vendor,
      items: po.items.map((it) => ({
        productName: it.product.name,
        productSku: it.product.sku,
        hsn: it.product.hsn,
        uom: it.product.uom,
        qty: it.qty,
        rate: it.rate,
        amount: it.amount,
      })),
    };
  });

  app.post(
    "/purchase-orders/:id/rotate-share-token",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const po = await db.purchaseOrder.findUnique({ where: { id } });
      if (!po) return reply.code(404).send({ error: { code: "not_found" } });
      const updated = await db.purchaseOrder.update({
        where: { id },
        data: { shareToken: mintShareToken() },
      });
      return { shareToken: updated.shareToken };
    }
  );
};
