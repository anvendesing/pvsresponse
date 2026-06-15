#!/usr/bin/env tsx
/**
 * Printable CODE128 bin labels for Stock Room (WH-FG).
 *
 * Default: zone C only (145 bins). Use --all for every bin in WH-FG.
 *
 * Run:
 *   cd backend
 *   npm run labels:stock-room
 *   npx tsx scripts/generate-stock-room-bin-labels-pdf.ts --zone C
 *
 * Output: backend/output/stock-room-bin-labels.pdf
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import bwipjs from "bwip-js";
import { PrismaClient } from "@prisma/client";
import { binCodeFromRow } from "../src/lib/codes.js";
import {
  STOCK_ROOM_SCAN_PREFIX,
  STOCK_ROOM_WAREHOUSE_CODE,
  STOCK_ROOM_ZONE_C_BIN_COUNT,
  stockRoomBinRows,
} from "../src/lib/stock-room-layout.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "output");
const outArgIdx = process.argv.indexOf("--out");
const OUT_FILE =
  outArgIdx >= 0 && process.argv[outArgIdx + 1]
    ? path.resolve(process.argv[outArgIdx + 1]!)
    : path.join(OUT_DIR, "stock-room-bin-labels.pdf");

const zoneArgIdx = process.argv.indexOf("--zone");
const zoneFilter =
  process.argv.includes("--all")
    ? null
    : zoneArgIdx >= 0 && process.argv[zoneArgIdx + 1]
      ? process.argv[zoneArgIdx + 1]!.toUpperCase()
      : "C";

const PT = 72;
const PAGE_W = 12 * PT;
const PAGE_H = 18 * PT;
const MARGIN = 0.25 * PT;
const mmToPt = (mm: number) => (mm / 25.4) * PT;
const LABEL_W_MM = 50;
const LABEL_H_MM = 25;
const PACKAGE_LABEL_W = mmToPt(LABEL_W_MM);
const PACKAGE_LABEL_H = mmToPt(LABEL_H_MM);
const largeMode = process.argv.includes("--large");

function gridForFixedLabel(labelW: number, labelH: number) {
  const gap = 2;
  const usableW = PAGE_W - MARGIN * 2;
  const usableH = PAGE_H - MARGIN * 2;
  const cols = Math.max(1, Math.floor((usableW + gap) / (labelW + gap)));
  const rows = Math.max(1, Math.floor((usableH + gap) / (labelH + gap)));
  const gridW = cols * labelW + (cols - 1) * gap;
  const gridH = rows * labelH + (rows - 1) * gap;
  return {
    cols,
    rows,
    gap,
    offsetX: MARGIN + (usableW - gridW) / 2,
    offsetY: MARGIN + (usableH - gridH) / 2,
    labelW,
    labelH,
    perPage: cols * rows,
  };
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
        typography: { room: 14, locationMax: 22, code: 10, pad: 14, codeStrip: 14, barStrip: 72, codeGap: 4 },
      };
    })()
  : {
      ...gridForFixedLabel(PACKAGE_LABEL_W, PACKAGE_LABEL_H),
      barcode: { bcid: "code128" as const, scale: 1, height: 8, pad: 0 },
      typography: { locationMax: 13, code: 4.5, pad: 2, codeStrip: 6, barStrip: 20, codeGap: 2 },
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
  code: string;
  zone: string;
  shelf: string;
  bin: string;
}

const layoutKeys =
  zoneFilter === "C"
    ? new Set(
        stockRoomBinRows()
          .filter((r) => r.zone === "C")
          .map((r) => `${r.zone}/${r.shelf}/${r.bin}`)
      )
    : null;

async function loadLabels(db: PrismaClient): Promise<LabelRow[]> {
  const wh = await db.warehouse.findUnique({
    where: { code: STOCK_ROOM_WAREHOUSE_CODE },
    select: { id: true, code: true, scanPrefix: true },
  });
  if (!wh) {
    throw new Error(`Warehouse ${STOCK_ROOM_WAREHOUSE_CODE} not found.`);
  }

  const bins = await db.bin.findMany({
    where: {
      warehouseId: wh.id,
      ...(zoneFilter ? { zone: zoneFilter } : {}),
    },
    orderBy: [{ zone: "asc" }, { shelf: "asc" }, { bin: "asc" }],
  });

  if (bins.length === 0) {
    throw new Error(
      `No bins in ${STOCK_ROOM_WAREHOUSE_CODE}${zoneFilter ? ` zone ${zoneFilter}` : ""}. Run: npx tsx scripts/seed-stock-room-bins.ts`
    );
  }

  const labels: LabelRow[] = [];
  for (const b of bins) {
    const key = `${b.zone}/${b.shelf}/${b.bin}`;
    if (layoutKeys && !layoutKeys.has(key)) continue;
    let code = b.code;
    if (!code) {
      code = binCodeFromRow(b, wh);
      await db.bin.update({ where: { id: b.id }, data: { code } });
    }
    labels.push({ code, zone: b.zone, shelf: b.shelf, bin: b.bin });
  }
  return labels;
}

function labelRect(doc: InstanceType<typeof PDFDocument>, x: number, y: number) {
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
  const barTopY = codeY - codeGap - barStrip;
  let headerY = y + pad;
  let headerH = barTopY - headerY - 1;

  if (hasRoom) {
    const room = (layout.typography as { room: number }).room;
    doc
      .font("Helvetica-Bold")
      .fontSize(room)
      .fillColor("#003087")
      .text("STOCK ROOM", x + pad, headerY, { width: innerW, align: "center", lineBreak: false });
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

  doc.image(png, x + pad, barTopY, { fit: [innerW, barStrip], align: "center", valign: "top" });

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

    const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, autoFirstPage: false });
    const stream = fs.createWriteStream(OUT_FILE);
    doc.pipe(stream);

    const labelMm = `${LABEL_W_MM}×${LABEL_H_MM} mm`;
    const zoneNote = zoneFilter ? `zone ${zoneFilter} only` : "all zones";

    doc.addPage();
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#003087").text("Stock Room bin labels", MARGIN, 48);
    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor("#333333")
      .text(
        [
          `${labels.length} labels · ${STOCK_ROOM_WAREHOUSE_CODE} · ${zoneNote}`,
          `Scan prefix ${STOCK_ROOM_SCAN_PREFIX} · compact code STR.CS05.08 (12 chars)`,
          largeMode
            ? `Large mode · ${layout.perPage} per 12×18 sheet`
            : `Label size: ${labelMm} · ${layout.perPage} per 12×18 sheet (${layout.cols}×${layout.rows})`,
          zoneFilter === "C"
            ? `Zone C layout: ${STOCK_ROOM_ZONE_C_BIN_COUNT} bins · zones A, B, D reserved`
            : "",
          "Barcode: CODE128 · print at 100% on 50×25 mm stock or 12×18 tabloid.",
          "Sheet 2: blank cut guide.",
        ]
          .filter(Boolean)
          .join("\n"),
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
      const png = await barcodePng(labels[i]!.code);
      drawLabel(doc, x, yPos, labels[i]!, png);
      if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${labels.length}`);
    }

    doc.end();
    await new Promise<void>((resolve, reject) => {
      stream.on("finish", () => resolve());
      stream.on("error", reject);
    });

    console.log(`\nWrote ${OUT_FILE} (${labels.length} labels)`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
