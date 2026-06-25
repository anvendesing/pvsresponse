// Imported sales-order pipeline.
//
//   POST /v1/imported-orders/preview   (multipart: pdf)
//        → parses the PDF, looks up channel mappings, returns a
//          structured preview the UI can render in an editable table.
//          Nothing is persisted.
//
//   POST /v1/imported-orders/commit    (JSON: edited preview)
//        → looks up / creates the customer, allocates a Prakruthivanam
//          SO number, creates the SalesOrder with source="imported"
//          and the external refs stamped. The first invoice generated
//          for this SO (via the regular packing pipeline) will be
//          numbered IMP-INV-2026-XXXX — see invoice-create.ts.
//
// The UI is expected to upload the PDF first, let the operator fix any
// unmapped items or address typos, then call commit with the corrected
// payload. The two-step design avoids any silent SO creation on a
// PDF that's slightly off — every line is shown to the operator with
// its resolution status before any rows hit the database.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { db } from "../db.js";
import { parseOrderPdfText, type ParsedOrder } from "../lib/import-pdf-parser.js";
import { resolveInternalSku } from "./channel-mappings.js";
import { mintShareToken } from "../lib/share.js";
import { nextDocNo } from "./sales.js";
import { recordChange } from "../sync/log.js";
import { reserveSalesOrderStock } from "../lib/so-reservations.js";
import { recomputeSalesOrderWeight } from "../lib/document-weight.js";
import { computeTax, computeGrandTotal } from "../lib/tax.js";

// ---------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------
// Parses the uploaded PDF and resolves every line item against the
// channel mapping + product catalogue. Returns enough detail for the
// UI to render a "looks-good / needs attention" preview without any
// further round-trips.

type PreviewItem = {
  externalCode: string;
  description: string;
  qty: number;
  rate: number;
  // Resolution status:
  //   ok       — mapped + product/variant found
  //   no_map   — no ChannelMapping row for (channel, externalCode)
  //   no_sku   — mapping exists but SKU does not match any product
  internalSku: string | null;
  productId: string | null;
  variantId: string | null;
  productName: string | null;
  status: "ok" | "no_map" | "no_sku";
  rawLine: string;
  note?: string;
};

const resolvePreview = async (parsed: ParsedOrder, channel: string) => {
  const codes = parsed.items.map((i) => i.externalCode);
  const mappings = await db.channelMapping.findMany({
    where: { channel, externalCode: { in: codes } },
    select: { externalCode: true, internalSku: true },
  });
  const mapByCode = new Map(mappings.map((m) => [m.externalCode, m.internalSku]));

  const items: PreviewItem[] = [];
  for (const it of parsed.items) {
    const internalSku = mapByCode.get(it.externalCode) ?? null;
    let resolved: Awaited<ReturnType<typeof resolveInternalSku>> | null = null;
    if (internalSku) {
      resolved = await resolveInternalSku(internalSku);
    }
    let status: PreviewItem["status"];
    if (!internalSku) status = "no_map";
    else if (!resolved || !resolved.found) status = "no_sku";
    else status = "ok";
    items.push({
      externalCode: it.externalCode,
      description: it.description,
      qty: it.qty,
      rate: it.rate,
      internalSku,
      productId: resolved && resolved.found ? resolved.productId : null,
      variantId: resolved && resolved.found ? resolved.variantId : null,
      productName: resolved && resolved.found ? resolved.productName : null,
      status,
      rawLine: it.rawLine,
      ...(it.note ? { note: it.note } : {}),
    });
  }

  // Customer match — phone first, then external code stamped onto
  // Customer.code (with the channel prefix "EXT-<channel>-<code>" so
  // we never collide with internally-allocated CUST-XXXX codes).
  let customerMatch: {
    id: string;
    code: string;
    name: string;
    matchedBy: "phone" | "code";
  } | null = null;
  if (parsed.customer.phone) {
    const byPhone = await db.customer.findFirst({
      where: { contact: parsed.customer.phone },
      select: { id: true, code: true, name: true },
    });
    if (byPhone) customerMatch = { ...byPhone, matchedBy: "phone" };
  }
  if (!customerMatch && parsed.customer.externalCode) {
    const code = `EXT-${channel}-${parsed.customer.externalCode}`;
    const byCode = await db.customer.findUnique({
      where: { code },
      select: { id: true, code: true, name: true },
    });
    if (byCode) customerMatch = { ...byCode, matchedBy: "code" };
  }

  // Detect duplicate import — same externalRef already in the DB.
  const existingSo = parsed.shipping.externalOrderNo
    ? await db.salesOrder.findFirst({
        where: {
          externalRef: parsed.shipping.externalOrderNo,
          externalChannel: channel,
        },
        select: { id: true, soNo: true, status: true },
      })
    : null;

  return {
    channel,
    parsed,
    items,
    customerMatch,
    existingSo,
    counts: {
      total: items.length,
      ok: items.filter((i) => i.status === "ok").length,
      noMap: items.filter((i) => i.status === "no_map").length,
      noSku: items.filter((i) => i.status === "no_sku").length,
    },
  };
};

// ---------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------

const commitItemSchema = z.object({
  externalCode: z.string(),
  description: z.string().optional(),
  internalSku: z.string().min(1),
  productId: z.string().min(1),
  variantId: z.string().nullable().optional(),
  qty: z.number().positive(),
  rate: z.number().nonnegative(),
});

const commitBody = z.object({
  channel: z.string().min(1).max(40),
  customer: z.object({
    customerId: z.string().nullable().optional(), // null => create new
    externalCode: z.string().nullable().optional(),
    name: z.string().min(1),
    addressLine: z.string().nullable().optional(),
    landmark: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    pincode: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    gst: z.string().nullable().optional(),
  }),
  shipping: z.object({
    awb: z.string().nullable().optional(),
    externalOrderNo: z.string().nullable().optional(),
    courier: z.string().nullable().optional(),
  }),
  invoice: z.object({
    externalInvoiceNo: z.string().nullable().optional(),
    invoiceDate: z.string().nullable().optional(),
  }),
  items: z.array(commitItemSchema).min(1),
  notes: z.string().nullable().optional(),
  // Allow re-import of the same external order #. Default false.
  forceReimport: z.boolean().optional(),
});

export const importedOrderRoutes = async (app: FastifyInstance) => {
  app.post("/imported-orders/preview", { preHandler: [app.authenticate] }, async (req, reply) => {
    const channel = (req.query as { channel?: string }).channel?.trim() || "DTDC";
    // multipart upload — single file under field "pdf".
    const file = await req.file({ limits: { fileSize: 20 * 1024 * 1024 } });
    if (!file) {
      return reply.code(400).send({
        error: { code: "no_file", message: "Upload a PDF file under field 'pdf'." },
      });
    }
    const buf = await file.toBuffer();
    let text = "";
    try {
      const out = await pdfParse(buf);
      text = out.text;
    } catch (e) {
      return reply.code(400).send({
        error: { code: "pdf_parse_failed", message: (e as Error).message },
      });
    }
    const parsed = parseOrderPdfText(text);
    const preview = await resolvePreview(parsed, channel);
    return preview;
  });

  app.post("/imported-orders/commit", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = commitBody.parse(req.body);

    // Duplicate guard — externalRef + channel pair is the natural key
    // for an imported order. Operator can override with forceReimport.
    if (body.shipping.externalOrderNo && !body.forceReimport) {
      const dup = await db.salesOrder.findFirst({
        where: {
          externalRef: body.shipping.externalOrderNo,
          externalChannel: body.channel,
        },
        select: { id: true, soNo: true },
      });
      if (dup) {
        return reply.code(409).send({
          error: {
            code: "duplicate_external_order",
            message: `Order ${body.shipping.externalOrderNo} already imported as ${dup.soNo}.`,
            details: { existingSoId: dup.id, existingSoNo: dup.soNo },
          },
        });
      }
    }

    // Customer: link existing, or create with EXT-<channel>-<code>.
    let customerId = body.customer.customerId ?? null;
    if (!customerId) {
      const code = body.customer.externalCode
        ? `EXT-${body.channel}-${body.customer.externalCode}`
        : `EXT-${body.channel}-${Date.now()}`;
      // Idempotent — if the code already exists (race), update fields
      // instead of erroring.
      const existing = await db.customer.findUnique({ where: { code } });
      const addressLine = [
        body.customer.addressLine,
        body.customer.landmark,
      ]
        .filter(Boolean)
        .join(" · ");
      if (existing) {
        const updated = await db.customer.update({
          where: { id: existing.id },
          data: {
            name: body.customer.name,
            addressLine: addressLine || null,
            city: body.customer.city ?? null,
            state: body.customer.state ?? null,
            pincode: body.customer.pincode ?? null,
            contact: body.customer.phone ?? null,
            gst: body.customer.gst ?? existing.gst,
            active: true,
          },
        });
        customerId = updated.id;
      } else {
        const created = await db.customer.create({
          data: {
            code,
            name: body.customer.name,
            addressLine: addressLine || null,
            city: body.customer.city ?? null,
            state: body.customer.state ?? null,
            pincode: body.customer.pincode ?? null,
            contact: body.customer.phone ?? null,
            gst: body.customer.gst ?? null,
            creditLimit: 0,
            active: true,
          },
        });
        customerId = created.id;
      }
    } else {
      // Refresh known fields on the existing customer in case the
      // shipping address changed (typical for D2C marketplaces).
      const addressLine = [
        body.customer.addressLine,
        body.customer.landmark,
      ]
        .filter(Boolean)
        .join(" · ");
      await db.customer.update({
        where: { id: customerId },
        data: {
          name: body.customer.name,
          addressLine: addressLine || undefined,
          city: body.customer.city ?? undefined,
          state: body.customer.state ?? undefined,
          pincode: body.customer.pincode ?? undefined,
          contact: body.customer.phone ?? undefined,
        },
      });
    }

    // Totals — imported orders carry rates inclusive of "what the
    // courier collected". For the back-office invoice we recompute
    // tax on top per standard rules so finance numbers stay
    // consistent. Operators that prefer a 1:1 mirror can flip the
    // line gstRate to 0 on the SO before pack.
    const itemTotals = body.items.map((it) => ({
      amount: it.qty * it.rate,
      gstRate: 0, // imported lines are post-tax courier prices; GST 0
    }));
    const subTotal = itemTotals.reduce((s, x) => s + x.amount, 0);
    const tax = computeTax(itemTotals);
    const freight = computeGrandTotal(subTotal, tax, 0);

    const soNo = await nextDocNo("SO", 2026, 2001);

    const notesParts: string[] = [];
    if (body.shipping.courier) notesParts.push(`Courier: ${body.shipping.courier}`);
    if (body.shipping.awb) notesParts.push(`AWB: ${body.shipping.awb}`);
    if (body.invoice.externalInvoiceNo)
      notesParts.push(`Ext invoice: ${body.invoice.externalInvoiceNo}`);
    if (body.invoice.invoiceDate)
      notesParts.push(`Ext invoice date: ${body.invoice.invoiceDate}`);
    if (body.notes) notesParts.push(body.notes);
    const notes = notesParts.length > 0 ? notesParts.join(" | ") : null;

    const so = await db.salesOrder.create({
      data: {
        soNo,
        shareToken: mintShareToken(),
        customerId,
        source: "imported",
        externalChannel: body.channel,
        externalRef: body.shipping.externalOrderNo ?? null,
        externalAwb: body.shipping.awb ?? null,
        externalInvoiceNo: body.invoice.externalInvoiceNo ?? null,
        notes,
        subTotal,
        tax,
        transportCharge: 0,
        transportTax: 0,
        total: freight.total,
        items: {
          create: body.items.map((it) => ({
            productId: it.productId,
            variantId: it.variantId ?? null,
            qtyOrdered: it.qty,
            rate: it.rate,
            amount: it.qty * it.rate,
          })),
        },
      },
      include: {
        customer: true,
        items: { include: { product: true, variant: true } },
      },
    });

    await recomputeSalesOrderWeight(db, so.id);
    await recordChange("SalesOrder", so.id, "insert", so, req.user.sub);

    // Hard-reserve stock just like a regular SO so the picker sees the
    // commitment immediately. Shortages don't block — the operator
    // resolves them via the standard SO detail panel.
    try {
      await reserveSalesOrderStock(so.id);
    } catch (e) {
      req.log?.warn({ err: e, soId: so.id }, "reserveSalesOrderStock failed");
    }

    return reply.code(201).send(so);
  });
};
