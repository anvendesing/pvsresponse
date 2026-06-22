// Bulk-order Excel export + import.
//
// Export  →  GET  /v1/price-lists/:id/export.xlsx
//   Produces a styled .xlsx workbook for a given pricelist that an
//   operator can hand to a customer (or fill in themselves). The
//   customer types quantities into the single unlocked column (G)
//   and saves the file. The Meta sheet carries a HMAC so we can
//   round-trip the file safely.
//
// Import  →  POST /v1/quotes/import-xlsx  (multipart, field name "file")
//   Parses an exported xlsx, re-resolves prices from the pricelist,
//   performs soft stock/ATP checks, and creates a Quote draft.
//   Supports ?dryRun=1 which returns the same preview payload without
//   committing anything.

import type { FastifyInstance } from "fastify";
import ExcelJS from "exceljs";
import crypto from "node:crypto";
import { db } from "../db.js";
import { resolveEffectivePrice } from "./pricing.js";
import { mintShareToken } from "../lib/share.js";
import { recordChange } from "../sync/log.js";
import { nextDocNo } from "./sales.js";
import { computeTax } from "../lib/tax.js";

// ------------------------------------------------------------------- Config ---

// Secret used for HMAC signing the meta sheet. In production, override with
// a long random string via the BULK_ORDER_SECRET env var.
const HMAC_SECRET = process.env.BULK_ORDER_SECRET ?? "bulk-order-dev-secret";

// XLSX column indices (1-based)
const COL = {
  SKU: 1,        // A
  PRODUCT: 2,    // B
  VARIANT: 3,    // C
  PACK: 4,       // D
  STOCK: 5,      // E
  RATE: 6,       // F
  QTY: 7,        // G  ← only unlocked column
  SUBTOTAL: 8,   // H
} as const;

const FIRST_DATA_ROW = 5; // rows 1-4 are header/title/instructions/column-header

// ----------------------------------------------------------------- Helpers ---

function hmacSign(payload: string): string {
  return crypto
    .createHmac("sha256", HMAC_SECRET)
    .update(payload)
    .digest("hex")
    .slice(0, 32);
}

function inrFormat(ws: ExcelJS.Worksheet, col: number, row: number) {
  ws.getCell(row, col).numFmt = '₹#,##0.00';
}

function lockCell(cell: ExcelJS.Cell) {
  cell.protection = { locked: true };
}

function freeCell(cell: ExcelJS.Cell) {
  cell.protection = { locked: false };
}

// ------------------------------------------------------------------ Export ---

async function buildWorkbook(
  priceList: {
    id: string;
    code: string;
    name: string;
    basis: string;
    multiplier: number;
  },
  rows: Array<{
    productId: string;
    variantId: string | null;
    sku: string;
    productName: string;
    variantLabel: string;
    category: string;
    pack: string;
    stock: number;
    rate: number;
  }>,
  brandName: string,
  exportedAt: string
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = brandName;
  wb.lastModifiedBy = brandName;
  wb.created = new Date(exportedAt);
  wb.modified = new Date(exportedAt);

  // ══════════════════════════════════════════════
  // Sheet 1: Order form
  // ══════════════════════════════════════════════
  const ws = wb.addWorksheet("Bulk Order", {
    views: [
      {
        state: "frozen",
        xSplit: 0,
        ySplit: 4,        // freeze header rows 1-4
        topLeftCell: `A${FIRST_DATA_ROW}`,
        activeCell: "G5",
        zoomScale: 110,
      },
    ],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
    },
  });

  // Column widths
  ws.getColumn(COL.SKU).width = 18;
  ws.getColumn(COL.PRODUCT).width = 30;
  ws.getColumn(COL.VARIANT).width = 14;
  ws.getColumn(COL.PACK).width = 11;
  ws.getColumn(COL.STOCK).width = 9;
  ws.getColumn(COL.RATE).width = 12;
  ws.getColumn(COL.QTY).width = 11;
  ws.getColumn(COL.SUBTOTAL).width = 13;

  // ── Row 1: Title ──
  ws.mergeCells(1, 1, 1, 8);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `${brandName}  ·  Bulk Order  ·  ${priceList.name} (${priceList.code})  ·  ${new Date(exportedAt).toLocaleDateString("en-IN")}`;
  titleCell.font = { bold: true, size: 14, color: { argb: "FF1E3A5F" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0FE" } };
  titleCell.alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(1).height = 28;

  // ── Row 2: Instruction ──
  ws.mergeCells(2, 1, 2, 8);
  const instrCell = ws.getCell(2, 1);
  instrCell.value =
    "Enter quantity in the yellow QTY column only  •  Leave blank or 0 to skip  •  Save and import via Quotes → Import from Excel";
  instrCell.font = { italic: true, size: 10, color: { argb: "FF555555" } };
  instrCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFDE7" } };
  instrCell.alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(2).height = 18;

  // ── Row 3: Spacer ──
  ws.getRow(3).height = 4;

  // ── Row 4: Column headers ──
  const headers = ["SKU", "Product", "Variant", "Pack / UoM", "Stock", "Rate (₹)", "QTY ✏", "Subtotal"];
  for (let c = 1; c <= 8; c++) {
    const cell = ws.getCell(4, c);
    cell.value = headers[c - 1];
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    cell.alignment = { vertical: "middle", horizontal: c >= 5 ? "right" : "left" };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FF6B8DB5" } },
    };
    lockCell(cell);
  }
  // Override QTY header background to yellow
  ws.getCell(4, COL.QTY).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE65100" } };
  ws.getCell(4, COL.QTY).font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  ws.getRow(4).height = 20;

  // ── Group rows by category ──
  const categories = [...new Set(rows.map((r) => r.category))].sort();

  let currentRow = FIRST_DATA_ROW;
  const lastRow = currentRow + rows.length - 1;

  for (const cat of categories) {
    const catRows = rows.filter((r) => r.category === cat);
    const catStartRow = currentRow;
    const catEndRow = currentRow + catRows.length - 1;

    for (const r of catRows) {
      const row = ws.getRow(currentRow);
      row.height = 16;

      // Alternate row tint
      const tint = (currentRow - FIRST_DATA_ROW) % 2 === 0 ? "FFFAFBFC" : "FFFFFFFF";

      // A – SKU
      const skuCell = ws.getCell(currentRow, COL.SKU);
      skuCell.value = r.sku;
      skuCell.font = { name: "Courier New", size: 9, color: { argb: "FF1E3A5F" } };
      skuCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tint } };
      skuCell.alignment = { horizontal: "left" };
      lockCell(skuCell);

      // B – Product name
      const prodCell = ws.getCell(currentRow, COL.PRODUCT);
      prodCell.value = r.productName;
      prodCell.font = { size: 9 };
      prodCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tint } };
      prodCell.alignment = { horizontal: "left", wrapText: false };
      lockCell(prodCell);

      // C – Variant label
      const varCell = ws.getCell(currentRow, COL.VARIANT);
      varCell.value = r.variantLabel || "";
      varCell.font = { size: 9, color: { argb: "FF555555" } };
      varCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tint } };
      lockCell(varCell);

      // D – Pack/UoM
      const packCell = ws.getCell(currentRow, COL.PACK);
      packCell.value = r.pack;
      packCell.font = { size: 9, color: { argb: "FF555555" } };
      packCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tint } };
      packCell.alignment = { horizontal: "center" };
      lockCell(packCell);

      // E – Stock
      const stockCell = ws.getCell(currentRow, COL.STOCK);
      stockCell.value = r.stock;
      stockCell.numFmt = '#,##0';
      stockCell.font = { size: 9, color: r.stock > 0 ? { argb: "FF2E7D32" } : { argb: "FFCC0000" } };
      stockCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tint } };
      stockCell.alignment = { horizontal: "right" };
      lockCell(stockCell);

      // F – Rate
      const rateCell = ws.getCell(currentRow, COL.RATE);
      rateCell.value = r.rate;
      rateCell.numFmt = '₹#,##0.00';
      rateCell.font = { size: 9 };
      rateCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tint } };
      rateCell.alignment = { horizontal: "right" };
      lockCell(rateCell);

      // G – QTY (only unlocked column, yellow)
      const qtyCell = ws.getCell(currentRow, COL.QTY);
      qtyCell.value = null;
      qtyCell.numFmt = '#,##0.##';
      qtyCell.font = { size: 10, bold: true };
      qtyCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9C4" } };
      qtyCell.alignment = { horizontal: "right" };
      qtyCell.border = {
        left: { style: "medium", color: { argb: "FFFFB300" } },
        right: { style: "medium", color: { argb: "FFFFB300" } },
        top: { style: "thin", color: { argb: "FFFFCC02" } },
        bottom: { style: "thin", color: { argb: "FFFFCC02" } },
      };
      freeCell(qtyCell); // explicitly unlocked

      // Data validation: whole numbers ≥ 0
      ws.getCell(currentRow, COL.QTY).dataValidation = {
        type: "decimal",
        operator: "greaterThanOrEqual",
        formulae: [0],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Invalid quantity",
        error: "Please enter a number ≥ 0",
        prompt: `Enter qty for ${r.sku}`,
        promptTitle: "Quantity",
        showInputMessage: true,
      };

      // H – Subtotal formula =G*F
      const subCell = ws.getCell(currentRow, COL.SUBTOTAL);
      subCell.value = {
        formula: `IF(G${currentRow}>0,G${currentRow}*F${currentRow},0)`,
        result: 0,
      };
      subCell.numFmt = '₹#,##0.00';
      subCell.font = { size: 9 };
      subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tint } };
      subCell.alignment = { horizontal: "right" };
      lockCell(subCell);

      currentRow++;
    }

    // Row group outline for this category (collapse by default)
    for (let r = catStartRow; r <= catEndRow; r++) {
      ws.getRow(r).outlineLevel = 1;
    }
    // Excel row grouping – add a category summary row above (outline "above" style)
    // Insert a category separator row before the group
    // (We do it after adding data rows so row numbers are stable)
    void cat; void catStartRow; void catEndRow; // used for outline above
  }

  // ── Total row ──
  const totalRow = currentRow;
  ws.mergeCells(totalRow, 1, totalRow, 6);
  const totalLabelCell = ws.getCell(totalRow, 1);
  totalLabelCell.value = "ORDER TOTAL";
  totalLabelCell.font = { bold: true, size: 10, color: { argb: "FF1E3A5F" } };
  totalLabelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0FE" } };
  totalLabelCell.alignment = { horizontal: "right" };
  lockCell(totalLabelCell);

  const totalQtyCell = ws.getCell(totalRow, COL.QTY);
  totalQtyCell.value = {
    formula: `SUM(G${FIRST_DATA_ROW}:G${lastRow})`,
    result: 0,
  };
  totalQtyCell.numFmt = '#,##0.##';
  totalQtyCell.font = { bold: true, size: 10 };
  totalQtyCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0FE" } };
  totalQtyCell.alignment = { horizontal: "right" };
  lockCell(totalQtyCell);

  const totalAmtCell = ws.getCell(totalRow, COL.SUBTOTAL);
  totalAmtCell.value = {
    formula: `SUM(H${FIRST_DATA_ROW}:H${lastRow})`,
    result: 0,
  };
  totalAmtCell.numFmt = '₹#,##0.00';
  totalAmtCell.font = { bold: true, size: 10 };
  totalAmtCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0FE" } };
  totalAmtCell.alignment = { horizontal: "right" };
  lockCell(totalAmtCell);

  ws.getRow(totalRow).height = 20;

  // ── Sheet protection – lock everything except column G ──
  ws.protect("", {
    selectLockedCells: true,
    selectUnlockedCells: true,
    sort: true,
    autoFilter: true,
    insertRows: false,
    deleteRows: false,
    formatCells: false,
    formatColumns: false,
    formatRows: false,
    scenarios: false,
  });

  // ══════════════════════════════════════════════
  // Sheet 2: How to use
  // ══════════════════════════════════════════════
  const wsHelp = wb.addWorksheet("How to use");
  const tips = [
    ["Step 1", "Open the 'Bulk Order' tab (the first sheet)."],
    ["Step 2", "Find the SKUs you want to order. Use Ctrl+F to search by name or SKU code."],
    ["Step 3", "Type your quantity in the yellow QTY column (column G).  Only this column is editable."],
    ["Step 4", "Leave other rows at 0 or blank — they will be ignored on import."],
    ["Step 5", "Save the file (Ctrl+S) and upload it via  Quotes → Import from Excel  in the ERP portal."],
    ["Note",   "Prices shown are from pricelist '" + priceList.name + "' and will be re-validated server-side on import."],
    ["Note",   "Do NOT rename the file tabs or the import will fail."],
  ];
  wsHelp.getColumn(1).width = 10;
  wsHelp.getColumn(2).width = 75;
  for (const [i, [step, text]] of tips.entries()) {
    const r = wsHelp.getRow(i + 2);
    r.height = 20;
    const s = r.getCell(1);
    s.value = step;
    s.font = { bold: true, size: 10 };
    s.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0FE" } };
    s.alignment = { vertical: "middle", horizontal: "center" };
    const t = r.getCell(2);
    t.value = text;
    t.font = { size: 10 };
    t.alignment = { vertical: "middle", wrapText: true };
  }

  // ══════════════════════════════════════════════
  // Sheet 3: Meta (hidden) – used by import to verify provenance
  // ══════════════════════════════════════════════
  const wsMeta = wb.addWorksheet("_meta");
  wsMeta.state = "veryHidden"; // hidden from tab strip, not accessible via View > Unhide
  const sigPayload = `${priceList.id}|${exportedAt}`;
  wsMeta.getCell("A1").value = "priceListId";
  wsMeta.getCell("B1").value = priceList.id;
  wsMeta.getCell("A2").value = "priceListCode";
  wsMeta.getCell("B2").value = priceList.code;
  wsMeta.getCell("A3").value = "exportedAt";
  wsMeta.getCell("B3").value = exportedAt;
  wsMeta.getCell("A4").value = "schemaVersion";
  wsMeta.getCell("B4").value = "2";
  wsMeta.getCell("A5").value = "signature";
  wsMeta.getCell("B5").value = hmacSign(sigPayload);

  // ── Row-count hint used by the importer to know the data range ──
  wsMeta.getCell("A6").value = "firstDataRow";
  wsMeta.getCell("B6").value = FIRST_DATA_ROW;
  wsMeta.getCell("A7").value = "lastDataRow";
  wsMeta.getCell("B7").value = lastRow;
  wsMeta.getCell("A8").value = "rowCount";
  wsMeta.getCell("B8").value = rows.length;

  // Embed SKU→productId + variantId mapping so the importer can resolve
  // IDs from the sku without hitting the DB for each row individually.
  // Format: one row per SKU, columns A=sku B=productId C=variantId
  const mapWs = wb.addWorksheet("_skumap");
  mapWs.state = "veryHidden";
  mapWs.getCell("A1").value = "sku";
  mapWs.getCell("B1").value = "productId";
  mapWs.getCell("C1").value = "variantId";
  for (const [idx, r] of rows.entries()) {
    mapWs.getCell(idx + 2, 1).value = r.sku;
    mapWs.getCell(idx + 2, 2).value = r.productId;
    mapWs.getCell(idx + 2, 3).value = r.variantId ?? "";
  }

  return wb;
}

// ================================================================== Routes ===

export const bulkOrderRoutes = async (app: FastifyInstance) => {
  // ------------------------------------------------- Export endpoint ---
  app.get(
    "/price-lists/:id/export.xlsx",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const qs = req.query as {
        includeOutOfStock?: string;
        customerId?: string;
      };

      const includeOutOfStock = qs.includeOutOfStock === "1";

      const priceList = await db.priceList.findUnique({
        where: { id },
        select: { id: true, code: true, name: true, basis: true, multiplier: true, active: true },
      });
      if (!priceList) {
        return reply.code(404).send({ error: { code: "not_found", message: "Price list not found." } });
      }
      if (!priceList.active) {
        return reply.code(409).send({ error: { code: "inactive", message: "Price list is inactive." } });
      }

      // Load all active products with their active variants
      const products = await db.product.findMany({
        where: { state: "active", priceListEnabled: true },
        orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
        include: {
          category: { select: { name: true } },
          variants: {
            where: { active: true, priceListEnabled: true },
            orderBy: [{ size: "asc" }, { grade: "asc" }],
            select: {
              id: true,
              sku: true,
              size: true,
              color: true,
              grade: true,
              uom: true,
              packSize: true,
              stockOnHand: true,
              sellingPriceOverride: true,
            },
          },
        },
      });

      // Build rows: one per variant (if any), or one per parent product
      const rows: Parameters<typeof buildWorkbook>[1] = [];

      for (const p of products) {
        if (p.variants.length > 0) {
          for (const v of p.variants) {
            if (!includeOutOfStock && v.stockOnHand <= 0) continue;
            const resolved = await resolveEffectivePrice({
              productId: p.id,
              variantId: v.id,
              customerId: qs.customerId ?? null,
              qty: 1,
            });
            const variantParts = [v.size, v.color, v.grade].filter(Boolean);
            rows.push({
              productId: p.id,
              variantId: v.id,
              sku: v.sku,
              productName: p.name,
              variantLabel: variantParts.join(" / "),
              category: p.category?.name ?? "General",
              pack: buildPackLabel(v.uom ?? p.uom, v.packSize),
              stock: v.stockOnHand,
              rate: resolved.price,
            });
          }
        } else {
          if (!includeOutOfStock && p.stockOnHand <= 0) continue;
          const resolved = await resolveEffectivePrice({
            productId: p.id,
            variantId: null,
            customerId: qs.customerId ?? null,
            qty: 1,
          });
          rows.push({
            productId: p.id,
            variantId: null,
            sku: p.sku,
            productName: p.name,
            variantLabel: "",
            category: p.category?.name ?? "General",
            pack: buildPackLabel(p.uom, 1),
            stock: p.stockOnHand,
            rate: resolved.price,
          });
        }
      }

      if (rows.length === 0) {
        return reply.code(409).send({
          error: { code: "empty_catalog", message: "No in-stock products found for export. Set ?includeOutOfStock=1 to include all." },
        });
      }

      // Company name for branding
      const company = await db.companyProfile.findFirst({ select: { tradeName: true, legalName: true } });
      const brand = company?.tradeName ?? company?.legalName ?? "ERP";
      const exportedAt = new Date().toISOString();
      const slug = brand.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

      const wb = await buildWorkbook(priceList, rows, brand, exportedAt);

      const buf = await wb.xlsx.writeBuffer();
      const filename = `${slug}-${priceList.code.toLowerCase()}-${exportedAt.slice(0, 10)}.xlsx`;

      return reply
        .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .send(Buffer.from(buf));
    }
  );

  // ------------------------------------------------- Import endpoint ---
  // Multipart: field "file" = xlsx blob, field "customerId" = string,
  //            optional "priceListId" override, optional "notes"
  // Query: ?dryRun=1 returns preview without creating the quote.
  app.post(
    "/quotes/import-xlsx",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const qs = req.query as { dryRun?: string };
      const isDryRun = qs.dryRun === "1";

      // Collect multipart fields using parts() so we can interleave
      // text fields and the file field in any order.
      let xlsxBuffer: Buffer | null = null;
      let customerId = "";
      let priceListIdOverride: string | null = null;
      let notes: string | null = null;

      for await (const part of req.parts()) {
        if (part.type === "file" && part.fieldname === "file") {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk as Buffer);
          }
          xlsxBuffer = Buffer.concat(chunks);
        } else if (part.type === "field") {
          const v = (part as { value: string }).value?.trim() ?? "";
          if (part.fieldname === "customerId") customerId = v;
          else if (part.fieldname === "priceListId") priceListIdOverride = v || null;
          else if (part.fieldname === "notes") notes = v || null;
        }
      }

      if (!xlsxBuffer) {
        return reply.code(400).send({ error: { code: "missing_file", message: "Expected multipart field 'file'." } });
      }

      if (!customerId) {
        return reply.code(400).send({ error: { code: "missing_customer", message: "Field 'customerId' is required." } });
      }

      // Parse workbook
      const wb = new ExcelJS.Workbook();
      try {
        // exceljs's xlsx.load typing expects the older Node Buffer. Cast
        // via ArrayBuffer to satisfy the type checker across Node versions.
        await wb.xlsx.load(xlsxBuffer.buffer.slice(
          xlsxBuffer.byteOffset,
          xlsxBuffer.byteOffset + xlsxBuffer.byteLength
        ) as ArrayBuffer);
      } catch {
        return reply.code(400).send({ error: { code: "invalid_xlsx", message: "Could not parse the uploaded file as an .xlsx workbook." } });
      }

      // Read meta
      const wsMeta = wb.getWorksheet("_meta");
      if (!wsMeta) {
        return reply.code(400).send({ error: { code: "missing_meta", message: "File was not produced by this system (missing _meta sheet). Export a fresh file from Price Lists and try again." } });
      }
      const getMeta = (key: string): string => {
        for (let r = 1; r <= 10; r++) {
          if (wsMeta.getCell(r, 1).value === key) {
            return String(wsMeta.getCell(r, 2).value ?? "");
          }
        }
        return "";
      };
      const metaPriceListId = getMeta("priceListId");
      const metaExportedAt  = getMeta("exportedAt");
      const metaSig         = getMeta("signature");
      const firstDataRow    = parseInt(getMeta("firstDataRow") || `${FIRST_DATA_ROW}`, 10);
      const lastDataRow     = parseInt(getMeta("lastDataRow") || "1000", 10);

      // Verify signature
      const expectedSig = hmacSign(`${metaPriceListId}|${metaExportedAt}`);
      if (metaSig !== expectedSig) {
        return reply.code(400).send({
          error: {
            code: "signature_invalid",
            message: "File signature is invalid. The file may have been tampered with or was not exported from this system. Export a fresh file and try again.",
          },
        });
      }

      const priceListId = priceListIdOverride ?? metaPriceListId;
      const priceList = await db.priceList.findUnique({
        where: { id: priceListId },
        select: { id: true, code: true, name: true, active: true },
      });
      if (!priceList) {
        return reply.code(400).send({ error: { code: "pricelist_not_found", message: `Price list ${priceListId} not found.` } });
      }
      if (!priceList.active) {
        return reply.code(400).send({ error: { code: "pricelist_inactive", message: `Price list '${priceList.name}' is inactive.` } });
      }

      const customer = await db.customer.findUnique({
        where: { id: customerId },
        select: { id: true, name: true, active: true, creditLimit: true },
      });
      if (!customer) {
        return reply.code(400).send({ error: { code: "customer_not_found", message: `Customer ${customerId} not found.` } });
      }
      if (!customer.active) {
        return reply.code(409).send({ error: { code: "customer_inactive", message: `Customer '${customer.name}' is inactive.` } });
      }

      // Load SKU map from hidden sheet
      const wsMap = wb.getWorksheet("_skumap");
      const skuToIds = new Map<string, { productId: string; variantId: string | null }>();
      if (wsMap) {
        for (let r = 2; r <= wsMap.rowCount; r++) {
          const sku = String(wsMap.getCell(r, 1).value ?? "").trim();
          const pid = String(wsMap.getCell(r, 2).value ?? "").trim();
          const vid = String(wsMap.getCell(r, 3).value ?? "").trim() || null;
          if (sku && pid) skuToIds.set(sku, { productId: pid, variantId: vid });
        }
      }

      // Parse the bulk-order sheet
      const wsOrder = wb.getWorksheet("Bulk Order");
      if (!wsOrder) {
        return reply.code(400).send({ error: { code: "missing_sheet", message: "Sheet 'Bulk Order' not found." } });
      }

      type Accepted = {
        productId: string;
        variantId: string | null;
        sku: string;
        productName: string;
        // Variant attributes mirrored on each accepted row so the
        // import preview UI can label lines with the actual variant
        // (e.g. "Agarbathi · Jasmine 90 sticks") instead of just the
        // bare parent product name shared across many variants.
        variantSku: string | null;
        variantSize: string | null;
        variantUom: string | null;
        variantPackSize: number | null;
        qty: number;
        rate: number;
        amount: number;
        gstRate: number;
        discount: number;
        stockOnHand: number;
        stockWarning: boolean;
      };
      type Rejected = { sku: string; row: number; qty: number; reason: string };

      const accepted: Accepted[] = [];
      const rejected: Rejected[] = [];

      for (let rowNum = firstDataRow; rowNum <= lastDataRow; rowNum++) {
        const skuRaw = wsOrder.getCell(rowNum, COL.SKU).value;
        const qtyRaw = wsOrder.getCell(rowNum, COL.QTY).value;

        const sku = String(skuRaw ?? "").trim();
        if (!sku) continue; // past data range

        const qty = typeof qtyRaw === "number" ? qtyRaw
          : typeof qtyRaw === "object" && qtyRaw !== null && "result" in (qtyRaw as ExcelJS.CellFormulaValue)
            ? Number((qtyRaw as ExcelJS.CellFormulaValue).result ?? 0)
            : Number(qtyRaw ?? 0);

        if (!qty || qty <= 0) continue; // skip blank / zero rows

        // Resolve IDs
        let ids = skuToIds.get(sku);
        if (!ids) {
          // Fallback: look up from DB (handles edge case where _skumap is missing)
          const variant = await db.productVariant.findUnique({
            where: { sku },
            select: { id: true, productId: true },
          });
          if (variant) {
            ids = { productId: variant.productId, variantId: variant.id };
          } else {
            const product = await db.product.findFirst({ where: { sku } });
            if (product) {
              ids = { productId: product.id, variantId: null };
            }
          }
        }
        if (!ids) {
          rejected.push({ sku, row: rowNum, qty, reason: "SKU not found in catalogue" });
          continue;
        }

        // Re-resolve price server-side (do NOT trust the Excel rate)
        let rate: number;
        try {
          const resolved = await resolveEffectivePrice({
            productId: ids.productId,
            variantId: ids.variantId,
            customerId,
            qty,
          });
          rate = resolved.price;
        } catch {
          rejected.push({ sku, row: rowNum, qty, reason: "Price could not be resolved" });
          continue;
        }

        // Stock / ATP soft check + variant metadata for the preview
        // label. One findUnique per variant covers both — saves a
        // round-trip vs the previous active+gstRate split.
        let stockOnHand = 0;
        let variantSku: string | null = null;
        let variantSize: string | null = null;
        let variantUom: string | null = null;
        let variantPackSize: number | null = null;
        let variantGstRate: number | null = null;
        if (ids.variantId) {
          const v = await db.productVariant.findUnique({
            where: { id: ids.variantId },
            select: {
              stockOnHand: true,
              active: true,
              sku: true,
              size: true,
              uom: true,
              packSize: true,
              gstRate: true,
            },
          });
          if (!v || !v.active) {
            rejected.push({ sku, row: rowNum, qty, reason: "SKU is inactive" });
            continue;
          }
          stockOnHand = v.stockOnHand;
          variantSku = v.sku;
          variantSize = v.size;
          variantUom = v.uom;
          variantPackSize = v.packSize;
          variantGstRate = v.gstRate;
        } else {
          const p = await db.product.findUnique({
            where: { id: ids.productId },
            select: { stockOnHand: true, state: true, name: true },
          });
          if (!p || p.state !== "active") {
            rejected.push({ sku, row: rowNum, qty, reason: "Product is inactive" });
            continue;
          }
          stockOnHand = p.stockOnHand;
        }

        const product = await db.product.findUnique({
          where: { id: ids.productId },
          select: { name: true, gstRate: true },
        });
        const lineGstRate = variantGstRate ?? product?.gstRate ?? 18;

        accepted.push({
          productId: ids.productId,
          variantId: ids.variantId,
          sku,
          productName: product?.name ?? sku,
          variantSku,
          variantSize,
          variantUom,
          variantPackSize,
          qty,
          rate,
          amount: Math.round(qty * rate * 100) / 100,
          gstRate: lineGstRate,
          discount: 0,
          stockOnHand,
          stockWarning: qty > stockOnHand,
        });
      }

      if (accepted.length === 0) {
        return reply.code(422).send({
          error: {
            code: "nothing_to_quote",
            message: "No lines with qty > 0 were found in the file. Fill in the QTY column and try again.",
            rejected,
          },
        });
      }

      const subTotal = accepted.reduce((s, l) => s + l.amount, 0);
      const tax = computeTax(accepted.map((l) => ({ amount: l.amount, gstRate: l.gstRate })));
      const total = subTotal + tax;

      if (isDryRun) {
        return reply.send({
          dryRun: true,
          accepted: accepted.map(({ stockWarning, stockOnHand, ...l }) => ({
            ...l,
            stockOnHand,
            stockWarning,
          })),
          rejected,
          subTotal,
          tax,
          total,
          priceList: { id: priceList.id, code: priceList.code, name: priceList.name },
          customer: { id: customer.id, name: customer.name },
        });
      }

      // ── Create the quote ──
      const quoteNo = await nextDocNo("Q", 2026, 1001);
      const validUntil = new Date(Date.now() + 30 * 86400000);
      const quote = await db.quote.create({
        data: {
          quoteNo,
          shareToken: mintShareToken(),
          customerId,
          validUntil,
          notes: notes ?? `Imported from bulk order Excel – pricelist ${priceList.code}`,
          subTotal,
          tax,
          total,
          createdById: req.user.sub,
          items: {
            create: accepted.map((l) => ({
              productId: l.productId,
              variantId: l.variantId,
              qty: l.qty,
              rate: l.rate,
              discount: l.discount,
              amount: l.amount,
            })),
          },
        },
        include: {
          items: true,
          customer: { select: { id: true, name: true } },
        },
      });

      await recordChange("Quote", quote.id, "insert", quote, req.user.sub);

      return reply.code(201).send({
        dryRun: false,
        quoteId: quote.id,
        quoteNo: quote.quoteNo,
        accepted: accepted.length,
        rejected,
        subTotal,
        tax,
        total,
        priceList: { id: priceList.id, code: priceList.code, name: priceList.name },
        customer: { id: customer.id, name: customer.name },
        stockWarnings: accepted.filter((l) => l.stockWarning).map((l) => ({ sku: l.sku, qty: l.qty, stockOnHand: l.stockOnHand })),
      });
    }
  );
};

// ------------------------------------------------------------------ Helpers ---

function buildPackLabel(uom: string, packSize: number): string {
  if (!packSize || packSize === 1) return uom || "Pcs";
  return `${packSize} ${uom}`;
}
