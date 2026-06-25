#!/usr/bin/env tsx
/**
 * Printable shelf labels for godown layouts — compact stickers tiled on 12×18 tabloid.
 * Default **100 × 36 mm** (2× compact size); **3 labels per row** on 12×18 tabloid.
 *
 *   npm run labels:godowns
 *   npx tsx scripts/generate-godown-shelf-labels-pdf.ts --wh WH-DATE
 *
 * Output: backend/output/godown-shelf-labels.pdf (or per-warehouse file)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import bwipjs from "bwip-js";
import { PrismaClient } from "@prisma/client";
import { shelfCodeFromRow } from "../src/lib/codes.js";
import {
  GODOWN_LAYOUTS,
  godownLayoutByCode,
  shelfRows,
} from "../src/lib/godown-layouts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "output");

const whArgIdx = process.argv.indexOf("--wh");
const whFilter =
  whArgIdx >= 0 && process.argv[whArgIdx + 1]
    ? process.argv[whArgIdx + 1]!.toUpperCase()
    : null;

const outArgIdx = process.argv.indexOf("--out");
const OUT_FILE =
  outArgIdx >= 0 && process.argv[outArgIdx + 1]
    ? path.resolve(process.argv[outArgIdx + 1]!)
    : whFilter
      ? path.join(OUT_DIR, `${whFilter.toLowerCase()}-shelf-labels.pdf`)
      : path.join(OUT_DIR, "godown-shelf-labels.pdf");

const PT = 72;
const PAGE_W = 12 * PT;
const PAGE_H = 18 * PT;
const MARGIN = 0.25 * PT;
const mmToPt = (mm: number) => (mm / 25.4) * PT;

/** 2× prior compact size; 3 columns per row. */
const LABEL_W_MM = 100;
const LABEL_H_MM = 36;
const GRID_COLS = 3;
const GRID_GAP_MM = 2;
const LABEL_H = mmToPt(LABEL_H_MM);
const GRID_GAP = mmToPt(GRID_GAP_MM);

function gridForFixedLabel(labelWTarget: number, labelH: number) {
  const usableW = PAGE_W - MARGIN * 2;
  const usableH = PAGE_H - MARGIN * 2;
  const cols = GRID_COLS;
  const labelW = Math.min(
    labelWTarget,
    (usableW - (cols - 1) * GRID_GAP) / cols
  );
  const rows = Math.max(
    1,
    Math.floor((usableH + GRID_GAP) / (labelH + GRID_GAP))
  );
  const gridW = cols * labelW + (cols - 1) * GRID_GAP;
  const gridH = rows * labelH + (rows - 1) * GRID_GAP;
  return {
    cols,
    rows,
    gap: GRID_GAP,
    offsetX: MARGIN + (usableW - gridW) / 2,
    offsetY: MARGIN + (usableH - gridH) / 2,
    labelW,
    labelH,
    perPage: cols * rows,
  };
}

const layout = {
  ...gridForFixedLabel(mmToPt(LABEL_W_MM), LABEL_H),
  barcode: { bcid: "code128" as const, scale: 2, height: 12, pad: 0 },
  typography: {
    roomMax: 9,
    shelfMax: 26,
    code: 7,
    pad: mmToPt(1),
    barH: mmToPt(14),
    codeH: mmToPt(2.8),
    microGap: 0.5,
  },
};

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
      (err, png) => (err ? reject(err) : resolve(png))
    );
  });

interface LabelRow {
  roomName: string;
  code: string;
  zone: string;
  shelf: string;
}

function shelfDisplayLabel(zone: string, shelf: string): string {
  const s = shelf.trim().toUpperCase();
  const m = /^S(\d+)$/.exec(s);
  const padded = m ? `S${m[1]!.padStart(2, "0")}` : s;
  return `${zone.toUpperCase()}/${padded}`;
}

async function loadLabels(db: PrismaClient): Promise<LabelRow[]> {
  const layouts = whFilter
    ? GODOWN_LAYOUTS.filter((g) => g.code === whFilter)
    : [...GODOWN_LAYOUTS];

  if (whFilter && layouts.length === 0) {
    throw new Error(
      `Unknown warehouse ${whFilter}. Known: ${GODOWN_LAYOUTS.map((g) => g.code).join(", ")}`
    );
  }

  const labels: LabelRow[] = [];

  for (const def of layouts) {
    const wh = await db.warehouse.findUnique({
      where: { code: def.code },
      select: { id: true, code: true, name: true, scanPrefix: true },
    });
    if (!wh) {
      throw new Error(
        `Warehouse ${def.code} not found. Run: npm run db:seed-godowns:dev`
      );
    }

    for (const row of shelfRows(def.zones)) {
      labels.push({
        roomName: wh.name,
        code: shelfCodeFromRow(row, wh),
        zone: row.zone,
        shelf: row.shelf,
      });
    }
  }

  if (labels.length === 0) {
    throw new Error("No shelves in layout. Check GODOWN_LAYOUTS.");
  }
  return labels;
}

function labelRect(doc: InstanceType<typeof PDFDocument>, x: number, y: number) {
  doc
    .roundedRect(x, y, layout.labelW, layout.labelH, 2)
    .lineWidth(0.5)
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

function lineHeight(doc: InstanceType<typeof PDFDocument>, size: number): number {
  return size * 1.08;
}

function drawLabel(
  doc: InstanceType<typeof PDFDocument>,
  x: number,
  y: number,
  label: LabelRow,
  png: Buffer
) {
  const { labelW, labelH } = layout;
  const { code, pad, barH, codeH, microGap, roomMax, shelfMax } = layout.typography;

  labelRect(doc, x, y);
  const innerW = labelW - pad * 2;
  const innerX = x + pad;

  const codeY = y + labelH - pad - codeH;
  const barTopY = codeY - microGap - barH;
  const topLimitY = y + pad;

  const roomText = label.roomName.toUpperCase();
  const roomSize = fitLocationFontSize(doc, roomText, innerW, roomMax, roomMax, 7);
  doc
    .font("Helvetica-Bold")
    .fontSize(roomSize)
    .fillColor("#003087")
    .text(roomText, innerX, topLimitY, {
      width: innerW,
      align: "center",
      lineBreak: false,
    });

  const shelfText = shelfDisplayLabel(label.zone, label.shelf);
  const shelfTopY = topLimitY + lineHeight(doc, roomSize);
  const shelfBandH = Math.max(4, barTopY - microGap - shelfTopY);
  const shelfSize = fitLocationFontSize(
    doc,
    shelfText,
    innerW,
    shelfBandH,
    shelfMax,
    16
  );

  doc
    .font("Helvetica-Bold")
    .fontSize(shelfSize)
    .fillColor("#111111")
    .text(shelfText, innerX, shelfTopY, {
      width: innerW,
      align: "center",
      lineBreak: false,
    });

  doc.image(png, innerX, barTopY, {
    fit: [innerW, barH],
    align: "center",
    valign: "top",
  });

  doc
    .font("Helvetica")
    .fontSize(code)
    .fillColor("#333333")
    .text(label.code, innerX, codeY, {
      width: innerW,
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

    console.log(
      `Generating ${labels.length} shelf labels (${(layout.labelW / PT * 25.4).toFixed(1)}×${LABEL_H_MM} mm, ${layout.cols}×${layout.rows} per page) → ${OUT_FILE}`
    );

    for (let i = 0; i < labels.length; i++) {
      if (i % layout.perPage === 0) {
        if (i > 0) drawBlankCutSheet(doc);
        doc.addPage();
      }
      const slot = i % layout.perPage;
      const { x, y } = gridPos(slot);
      const png = await barcodePng(labels[i]!.code);
      drawLabel(doc, x, y, labels[i]!, png);
    }

    doc.end();
    await new Promise<void>((resolve, reject) => {
      stream.on("finish", resolve);
      stream.on("error", reject);
    });

    const pages = Math.ceil(labels.length / layout.perPage);
    console.log(`Wrote ${labels.length} labels on ${pages} page(s).`);
    if (whFilter) {
      const def = godownLayoutByCode(whFilter);
      if (def) {
        console.log(
          `Layout: ${def.zones.map((z) => `zone ${z.zone}=${z.shelfCount} shelves`).join(", ")}`
        );
      }
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
