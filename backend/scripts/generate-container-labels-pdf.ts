// Generate a printable PDF of CODE128 stickers for every packing
// container on a slip (or every container on every open slip when no
// --slip is provided).
//
// Each label encodes the canonical scan code:
//   C.<packingSlipNo>.<NN>
// e.g. C.PS-2026-8042.03
//
// Used at dispatch scan-out so the loader confirms every sealed
// container actually made it onto the right truck.
//
// Run:
//   cd backend
//   npx tsx scripts/generate-container-labels-pdf.ts                    # all open / packed slips
//   npx tsx scripts/generate-container-labels-pdf.ts --slip PS-2026-8042
//
// Output: backend/output/container-labels.pdf

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import bwipjs from "bwip-js";
import { PrismaClient } from "@prisma/client";
import { containerCode } from "../src/lib/container-codes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "output");
const OUT_FILE = path.join(OUT_DIR, "container-labels.pdf");

// 3 across × 4 down on A4 = 12 labels per page. Each label is
// large enough to read from across a loading bay.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 30;
const COLS = 3;
const ROWS = 4;
const GAP_X = 8;
const GAP_Y = 8;
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
        height: 14,
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
  slipNo: string;
  label: string;
  customerName: string;
  typeName: string;
  itemCount: number;
  estWeightKg: number;
  containerOf: string; // "02 of 05"
}

async function loadLabels(
  db: PrismaClient,
  slipFilter: string | null
): Promise<LabelRow[]> {
  const slips = await db.packingSlip.findMany({
    where: {
      ...(slipFilter ? { packingSlipNo: slipFilter } : {}),
      ...(slipFilter
        ? {}
        : { status: { in: ["open", "packed", "invoiced"] } }),
      containers: { some: {} },
    },
    include: {
      salesOrder: { include: { customer: true } },
      containers: {
        orderBy: { seq: "asc" },
        include: { containerType: true, items: true },
      },
    },
    orderBy: { packingSlipNo: "asc" },
  });

  const out: LabelRow[] = [];
  for (const s of slips) {
    const total = s.containers.length;
    for (const c of s.containers) {
      out.push({
        code: containerCode(s.packingSlipNo, c.seq),
        slipNo: s.packingSlipNo,
        label: c.label,
        customerName: s.salesOrder?.customer?.name ?? "—",
        typeName: c.containerType?.name ?? "No type",
        itemCount: c.items.length,
        estWeightKg: c.estWeightKg,
        containerOf: `${c.label} of ${total.toString().padStart(2, "0")}`,
      });
    }
  }
  return out;
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

  const pad = 8;
  const innerW = LABEL_W - pad * 2;

  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor("#003087")
    .text(label.slipNo, x + pad, y + pad, {
      width: innerW,
      lineBreak: false,
    });

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#333333")
    .text(label.customerName, x + pad, y + pad + 12, {
      width: innerW,
      lineBreak: false,
      ellipsis: true,
    });

  // BIG container label on the right side of the header so loaders see
  // the box number from across the room.
  doc
    .font("Helvetica-Bold")
    .fontSize(28)
    .fillColor("#003087")
    .text(label.label, x + LABEL_W - pad - 56, y + pad - 4, {
      width: 56,
      align: "right",
      lineBreak: false,
    });

  // barcode
  const barTop = y + pad + 32;
  const barH = 38;
  doc.image(png, x + pad, barTop, {
    fit: [innerW, barH],
    align: "center",
    valign: "top",
  });

  // code text
  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor("#222222")
    .text(label.code, x + pad, barTop + barH + 2, {
      width: innerW,
      align: "center",
      lineBreak: false,
      ellipsis: true,
    });

  // bottom metadata
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#444444")
    .text(
      `${label.typeName} · ${label.itemCount} items · ${label.estWeightKg.toFixed(2)} kg`,
      x + pad,
      y + LABEL_H - pad - 22,
      { width: innerW, lineBreak: false, ellipsis: true }
    );
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor("#003087")
    .text(label.containerOf, x + pad, y + LABEL_H - pad - 10, {
      width: innerW,
      lineBreak: false,
    });
}

async function main() {
  const slipFlagIdx = process.argv.indexOf("--slip");
  const slipFilter =
    slipFlagIdx >= 0 ? (process.argv[slipFlagIdx + 1] ?? null) : null;

  const db = new PrismaClient();
  try {
    const labels = await loadLabels(db, slipFilter);
    if (labels.length === 0) {
      console.error(
        slipFilter
          ? `No containers found for slip "${slipFilter}".`
          : "No packing slips with containers found. Pack a slip first."
      );
      process.exit(1);
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });

    const doc = new PDFDocument({ size: "A4", margin: 0 });
    const stream = fs.createWriteStream(OUT_FILE);
    doc.pipe(stream);

    // Cover page
    doc
      .font("Helvetica-Bold")
      .fontSize(18)
      .fillColor("#003087")
      .text("Packing container labels", MARGIN, 80);
    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor("#333333")
      .text(
        [
          `${labels.length} container labels · CODE128 · scan at dispatch loading`,
          "",
          "Format: C.<packingSlipNo>.<NN>",
          "Example: C.PS-2026-8042.03",
          "",
          slipFilter
            ? `Filtered to slip ${slipFilter}.`
            : "All slips with containers (open / packed / invoiced).",
          "",
          "Print at 100% scale (no fit-to-page). Cut along grey borders.",
          "One sticker per physical container — the loader scans these as each",
          "container is loaded onto the truck so any missed container shows",
          "up at dispatch confirm.",
        ].join("\n"),
        MARGIN,
        120,
        { width: PAGE_W - MARGIN * 2 }
      );

    doc.addPage();

    console.log(
      `Generating ${labels.length} labels (${Math.ceil(labels.length / PER_PAGE)} pages)…`
    );

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
