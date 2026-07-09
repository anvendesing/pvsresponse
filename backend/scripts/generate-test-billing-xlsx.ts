/**
 * Generate a sample Excel workbook with 25 random POS-style bills for
 * testing billing / GST totals. Uses live storefront catalog only
 * (active product + variant, ecommerce-enabled, in-stock, active category).
 * No transport charges.
 *
 * Usage:
 *   npx tsx scripts/generate-test-billing-xlsx.ts
 *   npx tsx scripts/generate-test-billing-xlsx.ts --out ../test-billing-sample.xlsx
 */
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { computeDocumentTax, type LineTaxResult } from "../src/lib/document-tax.js";
import { getCompanyTaxContext } from "../src/lib/company-tax.js";
import {
  storefrontProductWhere,
  storefrontVariantWhere,
} from "../src/lib/storefront-catalog.js";

const db = new PrismaClient();

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const OUT_PATH =
  outIdx >= 0 ? args[outIdx + 1]! : "scripts/test-billing-sample.xlsx";

const BILL_COUNT = 25;

const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const pickN = <T>(arr: T[], n: number): T[] => {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = rand(0, copy.length - 1);
    out.push(copy.splice(idx, 1)[0]!);
  }
  return out;
};

const variantLabel = (v: {
  size?: string | null;
  color?: string | null;
  grade?: string | null;
  packSize?: string | null;
}): string =>
  [v.size, v.color, v.grade, v.packSize].filter(Boolean).join(" · ") || "—";

const inrFmt = "₹#,##0.00";

type CatalogRow = {
  productId: string;
  variantId: string;
  barcode: string;
  productName: string;
  variantName: string;
  hsn: string | null;
  gstRate: number;
  rate: number;
  uom: string;
};

async function loadCatalog(): Promise<CatalogRow[]> {
  const variants = await db.productVariant.findMany({
    where: {
      ...storefrontVariantWhere,
      stockOnHand: { gt: 0 },
      product: storefrontProductWhere,
    },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          hsn: true,
          gstRate: true,
          sellingPrice: true,
          uom: true,
          barcode: true,
        },
      },
    },
    orderBy: { sku: "asc" },
  });

  const rows: CatalogRow[] = [];
  for (const v of variants) {
    const rate = v.sellingPriceOverride ?? v.product.sellingPrice;
    if (rate <= 0) continue;
    const barcode = (v.barcode ?? v.product.barcode ?? v.sku ?? "").trim();
    if (!barcode) continue;
    rows.push({
      productId: v.product.id,
      variantId: v.id,
      barcode,
      productName: v.product.name,
      variantName: variantLabel(v),
      hsn: v.hsn ?? v.product.hsn,
      gstRate: v.gstRate ?? v.product.gstRate ?? 18,
      rate,
      uom: v.uom ?? v.product.uom ?? "Nos",
    });
  }
  return rows;
}

interface GeneratedBill {
  billNo: string;
  lineCount: number;
  doc: ReturnType<typeof computeDocumentTax>;
  lines: Array<CatalogRow & { qty: number; line: LineTaxResult }>;
}

function buildBill(
  billNo: string,
  catalog: CatalogRow[],
  taxCtx: Awaited<ReturnType<typeof getCompanyTaxContext>> & { taxKind: "intra" }
): GeneratedBill {
  const n = parseInt(billNo.replace(/\D/g, ""), 10);
  const tier = n <= 8 ? "small" : n <= 18 ? "medium" : "large";

  const lineCount =
    tier === "small" ? rand(1, 3) : tier === "medium" ? rand(3, 6) : rand(5, 9);
  const picked = pickN(catalog, lineCount);

  const items = picked.map((row) => {
    const qty =
      tier === "large" && Math.random() > 0.6
        ? rand(5, 15)
        : tier === "medium"
          ? rand(1, 6)
          : rand(1, 3);
    return { qty, rate: row.rate, gstRate: row.gstRate, row };
  });

  const doc = computeDocumentTax({
    items: items.map(({ qty, rate, gstRate }) => ({ qty, rate, gstRate })),
    transportCharge: 0,
    taxCtx,
  });

  const lines = items.map((it, i) => ({
    ...it.row,
    qty: it.qty,
    line: doc.lineResults[i]!,
  }));

  return { billNo, lineCount, doc, lines };
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E3A5F" },
  };
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  row.height = 22;
}

function writeBillBlock(ws: ExcelJS.Worksheet, startRow: number, bill: GeneratedBill): number {
  let r = startRow;

  ws.mergeCells(r, 1, r, 13);
  const title = ws.getCell(r, 1);
  title.value = `${bill.billNo}  ·  ${bill.lineCount} line(s)  ·  Test billing sample`;
  title.font = { bold: true, size: 13, color: { argb: "FF1E3A5F" } };
  title.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE8F0FE" },
  };
  title.alignment = { vertical: "middle" };
  ws.getRow(r).height = 24;
  r++;

  ws.getRow(r).values = [
    "#",
    "Barcode",
    "Product",
    "Variant",
    "HSN",
    "GST %",
    "Qty",
    "UoM",
    "Rate",
    "Taxable",
    "CGST",
    "SGST",
    "Line total",
  ];
  styleHeaderRow(ws.getRow(r));
  r++;

  bill.lines.forEach((ln, i) => {
    const row = ws.getRow(r);
    row.values = [
      i + 1,
      ln.barcode,
      ln.productName,
      ln.variantName,
      ln.hsn ?? "",
      ln.gstRate,
      ln.qty,
      ln.uom,
      ln.rate,
      ln.line.taxableValue,
      ln.line.cgst,
      ln.line.sgst,
      ln.line.gross,
    ];
    for (const col of [9, 10, 11, 12, 13]) row.getCell(col).numFmt = inrFmt;
    if (i % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF8FAFC" },
        };
      });
    }
    r++;
  });

  const { doc } = bill;
  ws.mergeCells(r, 1, r, 8);
  ws.getCell(r, 1).value = "Bill totals (no transport)";
  ws.getCell(r, 1).font = { bold: true };
  ws.getCell(r, 9).value = "Subtotal";
  ws.getCell(r, 9).font = { bold: true };
  ws.getCell(r, 10).value = doc.subTotal;
  ws.getCell(r, 10).numFmt = inrFmt;
  ws.getCell(r, 11).value = doc.cgstTotal;
  ws.getCell(r, 11).numFmt = inrFmt;
  ws.getCell(r, 12).value = doc.sgstTotal;
  ws.getCell(r, 12).numFmt = inrFmt;
  ws.getCell(r, 13).value = doc.total;
  ws.getCell(r, 13).numFmt = inrFmt;
  ws.getCell(r, 13).font = { bold: true, size: 11 };
  for (let c = 9; c <= 13; c++) {
    ws.getCell(r, c).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE8F5E9" },
    };
  }
  r++;

  if (Math.abs(doc.roundOff) >= 0.01) {
    ws.mergeCells(r, 1, r, 8);
    ws.getCell(r, 1).value = "Round off";
    ws.getCell(r, 10).value = doc.roundOff;
    ws.getCell(r, 10).numFmt = inrFmt;
    r++;
  }

  ws.mergeCells(r, 1, r, 8);
  ws.getCell(r, 1).value = "Goods tax (CGST + SGST)";
  ws.getCell(r, 12).value = doc.tax;
  ws.getCell(r, 12).numFmt = inrFmt;

  return r + 2;
}

function wsTitle(ws: ExcelJS.Worksheet, pricingInclusive: boolean) {
  ws.mergeCells(1, 1, 1, 13);
  const c = ws.getCell(1, 1);
  c.value =
    `Test billing samples (25 bills) — storefront variants only, no transport`;
  c.font = { bold: true, size: 14, color: { argb: "FF1E3A5F" } };
  c.alignment = { horizontal: "center" };
  ws.getRow(1).height = 28;

  ws.mergeCells(2, 1, 2, 13);
  const sub = ws.getCell(2, 1);
  sub.value = pricingInclusive
    ? "Rates are GST-inclusive (MRP). Taxable / CGST / SGST back-calculated to match POS."
    : "Rates are ex-GST. Line total = taxable + CGST + SGST.";
  sub.font = { italic: true, size: 10, color: { argb: "FF64748B" } };
  sub.alignment = { horizontal: "center" };
}

async function main() {
  const catalog = await loadCatalog();
  if (catalog.length < 20) {
    throw new Error(
      `Need at least 20 storefront-active priced variants with barcodes; found ${catalog.length}.`
    );
  }

  const baseCtx = await getCompanyTaxContext();
  const taxCtx = { ...baseCtx, taxKind: "intra" as const };

  const bills: GeneratedBill[] = [];
  for (let i = 1; i <= BILL_COUNT; i++) {
    bills.push(buildBill(`TEST-BILL-${String(i).padStart(2, "0")}`, catalog, taxCtx));
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "NovaERP Test Data";
  wb.created = new Date();

  const summary = wb.addWorksheet("Summary", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  summary.columns = [
    { header: "Bill #", key: "billNo", width: 16 },
    { header: "Lines", key: "lines", width: 8 },
    { header: "Subtotal", key: "subTotal", width: 14 },
    { header: "CGST", key: "cgst", width: 12 },
    { header: "SGST", key: "sgst", width: 12 },
    { header: "Goods tax", key: "tax", width: 12 },
    { header: "Round off", key: "roundOff", width: 11 },
    { header: "Grand total", key: "total", width: 14 },
  ];
  styleHeaderRow(summary.getRow(1));
  for (const b of bills) {
    const row = summary.addRow({
      billNo: b.billNo,
      lines: b.lineCount,
      subTotal: b.doc.subTotal,
      cgst: b.doc.cgstTotal,
      sgst: b.doc.sgstTotal,
      tax: b.doc.tax,
      roundOff: b.doc.roundOff,
      total: b.doc.total,
    });
    for (const col of [3, 4, 5, 6, 7, 8]) row.getCell(col).numFmt = inrFmt;
    row.getCell(8).font = { bold: true };
  }

  const detail = wb.addWorksheet("Bill details", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  detail.columns = [
    { width: 5 },
    { width: 16 },
    { width: 28 },
    { width: 18 },
    { width: 10 },
    { width: 8 },
    { width: 7 },
    { width: 8 },
    { width: 12 },
    { width: 12 },
    { width: 10 },
    { width: 10 },
    { width: 12 },
  ];

  wsTitle(detail, taxCtx.pricingInclusive);

  let row = 3;
  for (const bill of bills) {
    row = writeBillBlock(detail, row, bill);
  }

  await wb.xlsx.writeFile(OUT_PATH);

  console.log(`Wrote ${BILL_COUNT} test bills → ${OUT_PATH}`);
  console.log(
    `Pricing: ${taxCtx.pricingInclusive ? "GST-inclusive (MRP)" : "ex-GST"} · ${catalog.length} storefront SKUs in pool`
  );
  console.log(
    "Totals range:",
    `₹${Math.min(...bills.map((b) => b.doc.total)).toFixed(2)}`,
    "–",
    `₹${Math.max(...bills.map((b) => b.doc.total)).toFixed(2)}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
