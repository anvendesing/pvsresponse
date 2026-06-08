// Generate a printable test PDF with two sections:
//   1. Bin location barcodes (CODE128, B.<wh>.<zone>.<shelf>.<bin>)
//   2. Product + variant barcodes (CODE128, SKU/barcode values)
//
// Run:
//   cd backend
//   npm run labels:test
//
// Output: backend/output/test-labels.pdf

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import bwipjs from "bwip-js";
import { PrismaClient } from "@prisma/client";
import { binCodeFromRow } from "../src/lib/codes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "output");
const OUT_FILE = path.join(OUT_DIR, "test-labels.pdf");

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 36;
const COLS = 3;
const ROWS = 8;
const GAP_X = 8;
const GAP_Y = 6;
const USABLE_W = PAGE_W - MARGIN * 2;
const USABLE_H = PAGE_H - MARGIN * 2;
const LABEL_W = (USABLE_W - GAP_X * (COLS - 1)) / COLS;
const LABEL_H = (USABLE_H - GAP_Y * (ROWS - 1)) / ROWS;
const PER_PAGE = COLS * ROWS;

type LabelKind = "bin" | "product" | "variant";

interface LabelRow {
  kind: LabelKind;
  code: string;
  title: string;
  subtitle: string;
}

const barcodePng = (text: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    bwipjs.toBuffer(
      {
        bcid: "code128",
        text,
        scale: 2,
        height: 12,
        includetext: false,
      },
      (err, png) => {
        if (err) reject(err);
        else resolve(png);
      }
    );
  });

async function loadBinLabels(db: PrismaClient): Promise<LabelRow[]> {
  const warehouses = await db.warehouse.findMany({ orderBy: { code: "asc" } });
  const whById = new Map(warehouses.map((w) => [w.id, w]));
  const bins = await db.bin.findMany({
    orderBy: [
      { warehouseId: "asc" },
      { zone: "asc" },
      { shelf: "asc" },
      { bin: "asc" },
    ],
  });

  const labels: LabelRow[] = [];
  for (const b of bins) {
    const wh = whById.get(b.warehouseId);
    if (!wh?.code) continue;
    let code = b.code;
    if (!code) {
      code = binCodeFromRow(b, wh.code);
      await db.bin.update({ where: { id: b.id }, data: { code } });
    }
    labels.push({
      kind: "bin",
      code,
      title: `${wh.code} · ${b.zone}/${b.shelf}/${b.bin}`,
      subtitle: wh.name,
    });
  }
  return labels;
}

async function loadProductLabels(db: PrismaClient): Promise<LabelRow[]> {
  const products = await db.product.findMany({
    where: { state: { in: ["active", "draft"] } },
    include: {
      variants: { orderBy: [{ size: "asc" }, { sku: "asc" }] },
    },
    orderBy: { sku: "asc" },
  });

  const labels: LabelRow[] = [];
  for (const p of products) {
    if (p.variants.length > 0) {
      for (const v of p.variants) {
        const code = v.barcode ?? v.sku;
        const axes = [v.size, v.color, v.grade].filter(Boolean).join(" · ");
        labels.push({
          kind: "variant",
          code,
          title: p.name,
          subtitle: [v.sku, axes].filter(Boolean).join(" · "),
        });
      }
    } else {
      labels.push({
        kind: "product",
        code: p.barcode,
        title: p.name,
        subtitle: `${p.sku} · ${p.uom}`,
      });
    }
  }
  return labels;
}

const kindColor: Record<LabelKind, string> = {
  bin: "#003087",
  product: "#0d6e3f",
  variant: "#7a4b00",
};

function drawSectionCover(
  doc: InstanceType<typeof PDFDocument>,
  title: string,
  lines: string[]
) {
  doc.addPage();
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#003087").text(title, MARGIN, 80);
  doc
    .font("Helvetica")
    .fontSize(11)
    .fillColor("#333333")
    .text(lines.join("\n"), MARGIN, 130, { width: PAGE_W - MARGIN * 2 });
}

function drawLabel(
  doc: InstanceType<typeof PDFDocument>,
  x: number,
  y: number,
  label: LabelRow,
  png: Buffer
) {
  doc
    .roundedRect(x, y, LABEL_W, LABEL_H, 4)
    .lineWidth(0.5)
    .strokeColor("#cccccc")
    .stroke();

  const pad = 6;
  const innerW = LABEL_W - pad * 2;
  const accent = kindColor[label.kind];

  doc
    .font("Helvetica-Bold")
    .fontSize(6.5)
    .fillColor(accent)
    .text(
      label.kind === "bin" ? "BIN" : label.kind === "variant" ? "VARIANT" : "PRODUCT",
      x + pad,
      y + pad,
      { width: innerW, lineBreak: false }
    );

  doc
    .font("Helvetica-Bold")
    .fontSize(7)
    .fillColor("#111111")
    .text(label.title, x + pad, y + pad + 9, {
      width: innerW,
      height: 18,
      ellipsis: true,
    });

  doc
    .font("Helvetica")
    .fontSize(6.5)
    .fillColor("#555555")
    .text(label.subtitle, x + pad, y + pad + 22, {
      width: innerW,
      height: 12,
      ellipsis: true,
    });

  // Fixed zones: header (top) → barcode (middle) → code text (bottom).
  // barMaxH is computed from remaining space so long codes never overlap bars.
  const HEADER_H = 36;
  const CODE_H = 14;
  const BAR_CODE_GAP = 5;
  const barTop = y + pad + HEADER_H;
  const codeTop = y + LABEL_H - pad - CODE_H;
  const barMaxH = Math.max(8, codeTop - BAR_CODE_GAP - barTop);

  doc.image(png, x + pad, barTop, {
    fit: [innerW, barMaxH],
    align: "center",
    valign: "top",
  });

  doc
    .font("Helvetica")
    .fontSize(label.code.length > 18 ? 5 : 6)
    .fillColor("#333333")
    .text(label.code, x + pad, codeTop, {
      width: innerW,
      height: CODE_H,
      align: "center",
      ellipsis: true,
    });
}

async function renderLabelGrid(
  doc: InstanceType<typeof PDFDocument>,
  labels: LabelRow[],
  logPrefix: string
) {
  if (labels.length === 0) return;

  console.log(`Generating ${labels.length} ${logPrefix} (${Math.ceil(labels.length / PER_PAGE)} pages)…`);

  for (let i = 0; i < labels.length; i++) {
    const pageIndex = i % PER_PAGE;
    if (pageIndex === 0) doc.addPage();

    const col = pageIndex % COLS;
    const row = Math.floor(pageIndex / COLS);
    const x = MARGIN + col * (LABEL_W + GAP_X);
    const yPos = MARGIN + row * (LABEL_H + GAP_Y);

    const label = labels[i]!;
    const png = await barcodePng(label.code);
    drawLabel(doc, x, yPos, label, png);

    if ((i + 1) % 50 === 0) console.log(`  ${logPrefix}: ${i + 1}/${labels.length}`);
  }
}

async function main() {
  const db = new PrismaClient();
  try {
    const [binLabels, productLabels] = await Promise.all([
      loadBinLabels(db),
      loadProductLabels(db),
    ]);

    if (binLabels.length === 0 && productLabels.length === 0) {
      console.error("No bins or products found. Run: npm run db:seed");
      process.exit(1);
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });

    const doc = new PDFDocument({ size: "A4", margin: 0 });
    const stream = fs.createWriteStream(OUT_FILE);
    doc.pipe(stream);

    doc.font("Helvetica-Bold").fontSize(22).fillColor("#003087").text("Warehouse test labels", MARGIN, 72);
    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor("#333333")
      .text(
        [
          "Two printable sections for mobile scan / pick / pack testing.",
          "",
          `Section 1 — Bin locations: ${binLabels.length} labels`,
          "  Scan format: B.<warehouse>.<zone>.<shelf>.<bin>",
          "",
          `Section 2 — Products & variants: ${productLabels.length} labels`,
          "  Encodes product barcode or variant SKU/barcode",
          "",
          "Print at 100% scale (no fit-to-page). Cut along grey borders.",
        ].join("\n"),
        MARGIN,
        115,
        { width: PAGE_W - MARGIN * 2 }
      );

    const whCounts = new Map<string, number>();
    for (const l of binLabels) {
      const wh = l.title.split(" · ")[0] ?? "?";
      whCounts.set(wh, (whCounts.get(wh) ?? 0) + 1);
    }
    let y = 300;
    if (whCounts.size > 0) {
      doc.font("Helvetica-Bold").fontSize(10).text("Bins by warehouse:", MARGIN, y);
      y += 16;
      doc.font("Helvetica").fontSize(10);
      for (const [code, count] of whCounts) {
        doc.text(`  ${code}: ${count}`, MARGIN, y);
        y += 13;
      }
    }

    drawSectionCover(doc, "Sheet 1 — Bin locations", [
      `${binLabels.length} bin labels · CODE128`,
      "",
      "Stick on physical bins. Scan in mobile:",
      "  • Scan tab → resolves warehouse location",
      "  • Pick line → confirm bin before product scan",
      "",
      "Code format: B.WH-MAIN.A.S1.01",
    ]);

    await renderLabelGrid(doc, binLabels, "bin labels");

    drawSectionCover(doc, "Sheet 2 — Products & variants", [
      `${productLabels.length} product/variant labels · CODE128`,
      "",
      "Use for pick/pack product confirmation scans.",
      "Variants are listed separately from parent products.",
      "",
      "Encodes variant barcode when set, otherwise variant SKU.",
      "Products without variants use the parent product barcode.",
    ]);

    await renderLabelGrid(doc, productLabels, "product labels");

    doc.end();
    await new Promise<void>((resolve, reject) => {
      stream.on("finish", () => resolve());
      stream.on("error", reject);
    });

    const stat = fs.statSync(OUT_FILE);
    console.log(`\nWrote ${OUT_FILE}`);
    console.log(`  ${binLabels.length} bin + ${productLabels.length} product labels`);
    console.log(`  ${(stat.size / 1024).toFixed(1)} KB`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
