// Generate a printable PDF of CODE128 barcodes for every warehouse bin.
//
// Each label encodes the canonical scan code (B.<wh>.<zone>.<shelf>.<bin>)
// used by /v1/locations/scan and the mobile pick/pack flows.
//
// Run:
//   cd backend
//   npx tsx scripts/generate-bin-labels-pdf.ts
//
// Output: backend/output/bin-location-labels.pdf

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import bwipjs from "bwip-js";
import { PrismaClient } from "@prisma/client";
import { binCodeFromRow } from "../src/lib/codes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "output");
const OUT_FILE = path.join(OUT_DIR, "bin-location-labels.pdf");

// A4 label grid (points: 72 pt = 1 inch)
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

interface LabelRow {
  code: string;
  warehouseCode: string;
  warehouseName: string;
  zone: string;
  shelf: string;
  bin: string;
}

async function loadLabels(db: PrismaClient): Promise<LabelRow[]> {
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
      code,
      warehouseCode: wh.code,
      warehouseName: wh.name,
      zone: b.zone,
      shelf: b.shelf,
      bin: b.bin,
    });
  }
  return labels;
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

  doc
    .font("Helvetica-Bold")
    .fontSize(7)
    .fillColor("#003087")
    .text(`${label.warehouseCode} · ${label.zone}/${label.shelf}/${label.bin}`, x + pad, y + pad, {
      width: innerW,
      lineBreak: false,
    });

  const barTop = y + pad + 10;
  const barMaxH = LABEL_H - pad * 2 - 28;
  doc.image(png, x + pad, barTop, {
    fit: [innerW, barMaxH],
    align: "center",
    valign: "center",
  });

  doc
    .font("Helvetica")
    .fontSize(6.5)
    .fillColor("#333333")
    .text(label.code, x + pad, y + LABEL_H - pad - 14, {
      width: innerW,
      align: "center",
    });
}

async function main() {
  const db = new PrismaClient();
  try {
    const labels = await loadLabels(db);
    if (labels.length === 0) {
      console.error("No bins found. Run: npm run db:seed");
      process.exit(1);
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });

    const doc = new PDFDocument({ size: "A4", margin: 0 });
    const stream = fs.createWriteStream(OUT_FILE);
    doc.pipe(stream);

    // Cover / instructions page
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#003087").text("Bin location barcodes", MARGIN, 80);
    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor("#333333")
      .text(
        [
          `${labels.length} bin labels · CODE128 · scan with warehouse mobile app`,
          "",
          "Format: B.<warehouse>.<zone>.<shelf>.<bin>",
          "Example: B.WH-MAIN.A.S1.01",
          "",
          "Print at 100% scale (no fit-to-page). Cut along grey borders.",
          "Stick labels on bins, then test via Scan tab or pick-line scan.",
        ].join("\n"),
        MARGIN,
        120,
        { width: PAGE_W - MARGIN * 2 }
      );

    const whCounts = new Map<string, number>();
    for (const l of labels) {
      whCounts.set(l.warehouseCode, (whCounts.get(l.warehouseCode) ?? 0) + 1);
    }
    let y = 280;
    doc.font("Helvetica-Bold").fontSize(10).text("Warehouses in this PDF:", MARGIN, y);
    y += 18;
    doc.font("Helvetica").fontSize(10);
    for (const [code, count] of whCounts) {
      doc.text(`  ${code}: ${count} bins`, MARGIN, y);
      y += 14;
    }

    doc.addPage();

    console.log(`Generating ${labels.length} labels (${Math.ceil(labels.length / PER_PAGE)} pages)…`);

    for (let i = 0; i < labels.length; i++) {
      const pageIndex = i % PER_PAGE;
      if (pageIndex === 0 && i > 0) doc.addPage();

      const col = pageIndex % COLS;
      const row = Math.floor(pageIndex / COLS);
      const x = MARGIN + col * (LABEL_W + GAP_X);
      const yPos = MARGIN + row * (LABEL_H + GAP_Y);

      const label = labels[i]!;
      const png = await barcodePng(label.code);
      drawLabel(doc, x, yPos, label, png);

      if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${labels.length}`);
    }

    doc.end();
    await new Promise<void>((resolve, reject) => {
      stream.on("finish", () => resolve());
      stream.on("error", reject);
    });

    const stat = fs.statSync(OUT_FILE);
    console.log(`\nWrote ${OUT_FILE}`);
    console.log(`  ${labels.length} labels, ${(stat.size / 1024).toFixed(1)} KB`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
