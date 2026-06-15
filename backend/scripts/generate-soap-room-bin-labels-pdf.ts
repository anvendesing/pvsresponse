#!/usr/bin/env tsx
/**
 * Printable CODE128 bin labels for Soap Room (WH-PROD-SOAP).
 *
 * Default: **50 × 25 mm** shelf stickers (tiled on 12×18 tabloid).
 * Optional: `--large` for oversized 2×2 grid (aisle signage).
 *
 * Run:
 *   cd backend
 *   npm run labels:soap-room
 *   npx tsx scripts/generate-soap-room-bin-labels-pdf.ts --large
 *
 * Output: backend/output/soap-room-bin-labels.pdf
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import bwipjs from "bwip-js";
import { PrismaClient } from "@prisma/client";
import { binCodeFromRow } from "../src/lib/codes.js";
import { SOAP_ROOM_WAREHOUSE_CODE } from "./config/soap-room-layout.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "output");
const outArgIdx = process.argv.indexOf("--out");
const OUT_FILE =
  outArgIdx >= 0 && process.argv[outArgIdx + 1]
    ? path.resolve(process.argv[outArgIdx + 1]!)
    : path.join(OUT_DIR, "soap-room-bin-labels.pdf");

const PT = 72; // points per inch
const PAGE_W = 12 * PT;
const PAGE_H = 18 * PT;
const MARGIN = 0.25 * PT;

const mmToPt = (mm: number) => (mm / 25.4) * PT;

/** 50 mm wide × 25 mm tall — common small bin sticker. */
const LABEL_W_MM = 50;
const LABEL_H_MM = 25;
const PACKAGE_LABEL_W = mmToPt(LABEL_W_MM);
const PACKAGE_LABEL_H = mmToPt(LABEL_H_MM);

const largeMode = process.argv.includes("--large");

// Tile fixed-size labels on the sheet (centred grid).
function gridForFixedLabel(labelW: number, labelH: number) {
  const gap = 2;
  const usableW = PAGE_W - MARGIN * 2;
  const usableH = PAGE_H - MARGIN * 2;
  const cols = Math.max(1, Math.floor((usableW + gap) / (labelW + gap)));
  const rows = Math.max(1, Math.floor((usableH + gap) / (labelH + gap)));
  const gridW = cols * labelW + (cols - 1) * gap;
  const gridH = rows * labelH + (rows - 1) * gap;
  const offsetX = MARGIN + (usableW - gridW) / 2;
  const offsetY = MARGIN + (usableH - gridH) / 2;
  return { cols, rows, gap, offsetX, offsetY, labelW, labelH, perPage: cols * rows };
}

const layout = largeMode
  ? (() => {
      const cols = 2;
      const rows = 2;
      const gap = 16;
      const usableW = PAGE_W - MARGIN * 2;
      const usableH = PAGE_H - MARGIN * 2;
      const labelW = (usableW - gap * (cols - 1)) / cols;
      const labelH = (usableH - gap * (rows - 1)) / rows;
      return {
        cols,
        rows,
        gap,
        offsetX: MARGIN,
        offsetY: MARGIN,
        labelW,
        labelH,
        perPage: cols * rows,
        barcode: { bcid: "code128" as const, scale: 4, height: 28, pad: 6 },
        typography: { room: 16, locationMax: 22, code: 10, pad: 14, codeStrip: 14, barStrip: 72, codeGap: 4 },
      };
    })()
  : {
      ...gridForFixedLabel(PACKAGE_LABEL_W, PACKAGE_LABEL_H),
      barcode: { bcid: "code128" as const, scale: 1, height: 8, pad: 0 },
      typography: { locationMax: 13, code: 4.5, pad: 2, codeStrip: 6, barStrip: 20, codeGap: 2 },
    };

/** Pick the largest bold font that fits the header band. */
function fitLocationFontSize(
  doc: InstanceType<typeof PDFDocument>,
  text: string,
  maxWidth: number,
  maxHeight: number,
  maxPt: number,
  minPt: number
): number {
  for (let size = maxPt; size >= minPt; size -= 0.5) {
    doc.font("Helvetica-Bold").fontSize(size);
    if (doc.widthOfString(text) <= maxWidth && size <= maxHeight) return size;
  }
  return minPt;
}

/** CODE128 — narrower than CODE39 for the same 12-char scan string on 50 mm labels. */
const barcodePng = (text: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    bwipjs.toBuffer(
      {
        bcid: layout.barcode.bcid,
        text,
        scale: layout.barcode.scale,
        height: layout.barcode.height,
        paddingwidth: layout.barcode.pad,
        paddingheight: layout.barcode.pad,
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
  zone: string;
  shelf: string;
  bin: string;
}

async function loadLabels(db: PrismaClient): Promise<LabelRow[]> {
  const wh = await db.warehouse.findUnique({
    where: { code: SOAP_ROOM_WAREHOUSE_CODE },
    select: { id: true, code: true, scanPrefix: true },
  });
  if (!wh) {
    throw new Error(`Warehouse ${SOAP_ROOM_WAREHOUSE_CODE} not found.`);
  }

  const bins = await db.bin.findMany({
    where: { warehouseId: wh.id },
    orderBy: [{ zone: "asc" }, { shelf: "asc" }, { bin: "asc" }],
  });

  if (bins.length === 0) {
    throw new Error(
      `No bins in ${SOAP_ROOM_WAREHOUSE_CODE}. Run: npx tsx scripts/seed-soap-room-bins.ts`
    );
  }

  const labels: LabelRow[] = [];
  for (const b of bins) {
    let code = b.code;
    if (!code) {
      code = binCodeFromRow(b, wh);
      await db.bin.update({ where: { id: b.id }, data: { code } });
    }
    labels.push({ code, zone: b.zone, shelf: b.shelf, bin: b.bin });
  }
  return labels;
}

function labelRect(
  doc: InstanceType<typeof PDFDocument>,
  x: number,
  y: number
) {
  const { labelW, labelH } = layout;
  doc
    .roundedRect(x, y, labelW, labelH, largeMode ? 6 : 2)
    .lineWidth(0.35)
    .strokeColor("#cccccc")
    .stroke();
}

function gridPos(pageIndex: number) {
  const col = pageIndex % layout.cols;
  const row = Math.floor(pageIndex / layout.cols);
  return {
    x: layout.offsetX + col * (layout.labelW + layout.gap),
    y: layout.offsetY + row * (layout.labelH + layout.gap),
  };
}

function drawBlankCutSheet(doc: InstanceType<typeof PDFDocument>) {
  doc.addPage();
  for (let i = 0; i < layout.perPage; i++) {
    const { x, y } = gridPos(i);
    labelRect(doc, x, y);
  }
}

function drawLabel(
  doc: InstanceType<typeof PDFDocument>,
  x: number,
  y: number,
  label: LabelRow,
  png: Buffer
) {
  const { labelW, labelH } = layout;
  const { code, pad, codeStrip, barStrip, codeGap } = layout.typography;
  const hasRoom = "room" in layout.typography;
  const locationMax = (layout.typography as { locationMax: number }).locationMax;

  labelRect(doc, x, y);

  const innerW = labelW - pad * 2;

  const codeY = y + labelH - pad - codeStrip;
  const barBottomY = codeY - codeGap;
  const barTopY = barBottomY - barStrip;
  let headerY = y + pad;
  let headerH = barTopY - headerY - 1;

  if (hasRoom) {
    const room = (layout.typography as { room: number }).room;
    doc
      .font("Helvetica-Bold")
      .fontSize(room)
      .fillColor("#003087")
      .text("SOAP ROOM", x + pad, headerY, { width: innerW, align: "center", lineBreak: false });
    headerY += room + 4;
    headerH = barTopY - headerY - 1;
  }

  const locText = `${label.zone}/${label.shelf}/${label.bin}`;
  const locSize = fitLocationFontSize(doc, locText, innerW, headerH, locationMax, largeMode ? 14 : 8);
  const locY = headerY + Math.max(0, (headerH - locSize) / 2);

  doc
    .font("Helvetica-Bold")
    .fontSize(locSize)
    .fillColor("#111111")
    .text(locText, x + pad, locY, { width: innerW, align: "center", lineBreak: false });

  doc.image(png, x + pad, barTopY, {
    fit: [innerW, barStrip],
    align: "center",
    valign: "top",
  });

  doc
    .font("Helvetica")
    .fontSize(code)
    .fillColor("#333333")
    .text(label.code, x + pad, codeY, {
      width: innerW,
      height: codeStrip,
      align: "center",
      lineBreak: false,
    });
}

async function main() {
  const db = new PrismaClient();
  try {
    const labels = await loadLabels(db);
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const doc = new PDFDocument({
      size: [PAGE_W, PAGE_H],
      margin: 0,
      autoFirstPage: false,
    });
    const stream = fs.createWriteStream(OUT_FILE);
    doc.pipe(stream);

    const labelMm = `${LABEL_W_MM}×${LABEL_H_MM} mm`;

    doc.addPage();
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#003087").text("Soap Room bin labels", MARGIN, 48);
    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor("#333333")
      .text(
        [
          `${labels.length} labels · ${SOAP_ROOM_WAREHOUSE_CODE} · scan prefix WSP`,
          largeMode
            ? `Large mode · ${layout.perPage} per 12×18 sheet`
            : `Label size: ${labelMm} · ${layout.perPage} per 12×18 sheet (${layout.cols}×${layout.rows})`,
          "Barcode: CODE128 (narrower than CODE39 on 50 mm labels) · scan code WSP.AS07.08",
          "",
          "Sheet 2: blank cut guide (grey outlines only, same grid as labels).",
          "Print at 100% scale on 12×18 tabloid (or match 50×25 mm label stock).",
          "Cut on grey borders. Aisle signage: re-run with --large.",
        ].join("\n"),
        MARGIN,
        80,
        { width: PAGE_W - MARGIN * 2 }
      );

    drawBlankCutSheet(doc);

    console.log(
      `Generating ${labels.length} × ${labelMm} labels (${Math.ceil(labels.length / layout.perPage)} pages)…`
    );

    for (let i = 0; i < labels.length; i++) {
      const pageIndex = i % layout.perPage;
      if (pageIndex === 0) doc.addPage();

      const { x, y: yPos } = gridPos(pageIndex);

      const label = labels[i]!;
      const png = await barcodePng(label.code);
      drawLabel(doc, x, yPos, label, png);

      if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${labels.length}`);
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
