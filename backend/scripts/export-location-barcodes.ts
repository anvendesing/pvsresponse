#!/usr/bin/env tsx
/**
 * Export every zone, shelf, and bin with mobile scan barcodes.
 *
 *   npx tsx scripts/export-location-barcodes.ts
 *   npx tsx scripts/export-location-barcodes.ts --format csv
 *   npx tsx scripts/export-location-barcodes.ts --format both
 *
 * Output:
 *   docs/warehouse-location-barcodes.md
 *   backend/output/location-barcodes.csv
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
  binCodeFromRow,
  shelfCodeFromRow,
  zoneCodeFromRow,
} from "../src/lib/codes.js";
import {
  GODOWN_LAYOUTS,
  godownLayoutByCode,
  shelfRows,
} from "../src/lib/godown-layouts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const MD_OUT = path.join(ROOT, "docs", "warehouse-location-barcodes.md");
const CSV_OUT = path.join(__dirname, "..", "output", "location-barcodes.csv");

type RowKind = "zone" | "shelf" | "bin";

type ExportRow = {
  kind: RowKind;
  warehouseCode: string;
  warehouseName: string;
  scanPrefix: string;
  zone: string;
  shelf: string;
  bin: string;
  zoneScan: string;
  shelfScan: string;
  binScan: string;
  productSku: string;
  productName: string;
  qty: number;
  source: "bin" | "layout";
};

const fmtArg = process.argv.includes("--format")
  ? process.argv[process.argv.indexOf("--format") + 1]
  : "both";
const format = fmtArg === "csv" || fmtArg === "md" ? fmtArg : "both";

const whInput = (wh: { code: string; scanPrefix: string | null }) => ({
  code: wh.code,
  scanPrefix: wh.scanPrefix,
});

async function main() {
  const db = new PrismaClient();
  try {
    const warehouses = await db.warehouse.findMany({
      where: { active: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, scanPrefix: true, kind: true },
    });

    const activeIds = warehouses.map((w) => w.id);

    const bins = await db.bin.findMany({
      where: { warehouseId: { in: activeIds } },
      orderBy: [
        { warehouseId: "asc" },
        { zone: "asc" },
        { shelf: "asc" },
        { bin: "asc" },
      ],
      include: {
        product: { select: { sku: true, name: true } },
        warehouse: { select: { code: true, name: true, scanPrefix: true } },
      },
    });

    const rows: ExportRow[] = [];
    const seenShelf = new Set<string>();
    const seenZone = new Set<string>();

    const pushZone = (
      wh: { code: string; name: string; scanPrefix: string | null },
      zone: string,
      source: "bin" | "layout"
    ) => {
      const key = `${wh.code}|${zone}`;
      if (seenZone.has(key)) return;
      seenZone.add(key);
      rows.push({
        kind: "zone",
        warehouseCode: wh.code,
        warehouseName: wh.name,
        scanPrefix: wh.scanPrefix ?? "",
        zone,
        shelf: "",
        bin: "",
        zoneScan: zoneCodeFromRow(zone, whInput(wh)),
        shelfScan: "",
        binScan: "",
        productSku: "",
        productName: "",
        qty: 0,
        source,
      });
    };

    const pushShelf = (
      wh: { code: string; name: string; scanPrefix: string | null },
      zone: string,
      shelf: string,
      source: "bin" | "layout"
    ) => {
      const key = `${wh.code}|${zone}|${shelf}`;
      if (seenShelf.has(key)) return;
      seenShelf.add(key);
      pushZone(wh, zone, source);
      rows.push({
        kind: "shelf",
        warehouseCode: wh.code,
        warehouseName: wh.name,
        scanPrefix: wh.scanPrefix ?? "",
        zone,
        shelf,
        bin: "",
        zoneScan: zoneCodeFromRow(zone, whInput(wh)),
        shelfScan: shelfCodeFromRow({ zone, shelf }, whInput(wh)),
        binScan: "",
        productSku: "",
        productName: "",
        qty: 0,
        source,
      });
    };

    for (const b of bins) {
      const wh = b.warehouse;
      pushShelf(wh, b.zone, b.shelf, "bin");
      const scan = binCodeFromRow(
        { zone: b.zone, shelf: b.shelf, bin: b.bin },
        whInput(wh)
      );
      rows.push({
        kind: "bin",
        warehouseCode: wh.code,
        warehouseName: wh.name,
        scanPrefix: wh.scanPrefix ?? "",
        zone: b.zone,
        shelf: b.shelf,
        bin: b.bin,
        zoneScan: zoneCodeFromRow(b.zone, whInput(wh)),
        shelfScan: shelfCodeFromRow(
          { zone: b.zone, shelf: b.shelf },
          whInput(wh)
        ),
        binScan: scan,
        productSku: b.product?.sku ?? "",
        productName: b.product?.name ?? "",
        qty: b.qty ?? 0,
        source: "bin",
      });
    }

    // Planned godown shelves (layout) even when no bin rows exist yet.
    for (const layout of GODOWN_LAYOUTS) {
      const wh = warehouses.find((w) => w.code === layout.code);
      if (!wh) continue;
      for (const { zone, shelf } of shelfRows(layout.zones)) {
        pushShelf(wh, zone, shelf, "layout");
      }
    }

    rows.sort((a, b) => {
      const wh = a.warehouseCode.localeCompare(b.warehouseCode);
      if (wh !== 0) return wh;
      const k = `${a.kind}|${a.zone}|${a.shelf}|${a.bin}`.localeCompare(
        `${b.kind}|${b.zone}|${b.shelf}|${b.bin}`
      );
      if (k !== 0) return k;
      return a.kind.localeCompare(b.kind);
    });

    const generated = new Date().toISOString().slice(0, 19).replace("T", " ");

    if (format === "both" || format === "csv") {
      fs.mkdirSync(path.dirname(CSV_OUT), { recursive: true });
      const header =
        "kind,warehouse_code,warehouse_name,scan_prefix,zone,shelf,bin,zone_scan,shelf_scan,bin_scan,product_sku,qty,source";
      const lines = rows.map((r) =>
        [
          r.kind,
          r.warehouseCode,
          csvEscape(r.warehouseName),
          r.scanPrefix,
          r.zone,
          r.shelf,
          r.bin,
          r.zoneScan,
          r.shelfScan,
          r.binScan,
          r.productSku,
          r.qty,
          r.source,
        ].join(",")
      );
      fs.writeFileSync(CSV_OUT, [header, ...lines].join("\n"), "utf8");
      console.log(`Wrote ${rows.length} rows → ${CSV_OUT}`);
    }

    if (format === "both" || format === "md") {
      fs.mkdirSync(path.dirname(MD_OUT), { recursive: true });
      const md = buildMarkdown(rows, warehouses, generated);
      fs.writeFileSync(MD_OUT, md, "utf8");
      console.log(`Wrote ${MD_OUT}`);
    }

    const binCount = rows.filter((r) => r.kind === "bin").length;
    const shelfCount = rows.filter((r) => r.kind === "shelf").length;
    const zoneCount = rows.filter((r) => r.kind === "zone").length;
    console.log(
      `Summary: ${warehouses.length} warehouses · ${zoneCount} zones · ${shelfCount} shelves · ${binCount} bins`
    );
  } finally {
    await db.$disconnect();
  }
}

const csvEscape = (s: string) =>
  s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;

function buildMarkdown(
  rows: ExportRow[],
  warehouses: Array<{
    code: string;
    name: string;
    scanPrefix: string | null;
    kind: string;
  }>,
  generated: string
): string {
  const lines: string[] = [
    "# Warehouse location barcodes",
    "",
    `Generated: ${generated}`,
    "",
    "Compact scan format (when `scanPrefix` is set):",
    "",
    "| Level | Example | Meaning |",
    "|-------|---------|---------|",
    "| Zone | `DTE.A` | Zone A in Date Room |",
    "| Shelf | `DTE.AS05` | Zone A, shelf S05 |",
    "| Bin | `STR.CS05.08` | Zone C, shelf S05, bin 08 |",
    "",
    "Godowns are primarily scanned at **shelf** level; bins appear when stock is put away.",
    "",
    "---",
    "",
  ];

  for (const wh of warehouses) {
    const layout = godownLayoutByCode(wh.code);
    const whRows = rows.filter((r) => r.warehouseCode === wh.code);
    const zones = [...new Set(whRows.filter((r) => r.kind === "zone").map((r) => r.zone))].sort();
    const bins = whRows.filter((r) => r.kind === "bin");

    lines.push(`## ${wh.name} (\`${wh.code}\`)`);
    lines.push("");
    lines.push(
      `- **Scan prefix:** ${wh.scanPrefix ? `\`${wh.scanPrefix}\`` : "— (legacy B./Z./S. codes)"}`
    );
    lines.push(`- **Kind:** ${wh.kind}`);
    if (layout) {
      lines.push(
        `- **Layout:** ${layout.zones.map((z) => `zone ${z.zone} × ${z.shelfCount} shelves`).join(", ")}`
      );
    }
    lines.push(
      `- **Counts:** ${zones.length} zone(s), ${whRows.filter((r) => r.kind === "shelf").length} shelf(ves), ${bins.length} bin(s)`
    );
    lines.push("");

    if (zones.length === 0 && bins.length === 0) {
      lines.push("_No zones/shelves/bins in database yet._");
      lines.push("");
      continue;
    }

    for (const zone of zones) {
      const zoneRow = whRows.find((r) => r.kind === "zone" && r.zone === zone);
      lines.push(`### Zone ${zone}`);
      if (zoneRow?.zoneScan) {
        lines.push(`- **Zone scan:** \`${zoneRow.zoneScan}\``);
      }
      lines.push("");

      const shelves = whRows
        .filter((r) => r.kind === "shelf" && r.zone === zone)
        .sort((a, b) => a.shelf.localeCompare(b.shelf, undefined, { numeric: true }));

      for (const sh of shelves) {
        lines.push(`#### Shelf ${sh.shelf}`);
        lines.push(`- **Shelf scan:** \`${sh.shelfScan}\`${sh.source === "layout" ? " _(layout — no bins yet)_" : ""}`);
        lines.push("");

        const shelfBins = whRows
          .filter((r) => r.kind === "bin" && r.zone === zone && r.shelf === sh.shelf)
          .sort((a, b) => a.bin.localeCompare(b.bin, undefined, { numeric: true }));

        if (shelfBins.length === 0) {
          lines.push("_No bin slots yet — scan shelf label to receive/count at shelf level._");
          lines.push("");
          continue;
        }

        lines.push("| Bin | Scan code | Product | Qty |");
        lines.push("|-----|-----------|---------|-----|");
        for (const b of shelfBins) {
          const prod = b.productSku
            ? `${b.productSku}${b.productName ? ` — ${b.productName}` : ""}`
            : "—";
          lines.push(`| ${b.bin} | \`${b.binScan}\` | ${prod} | ${b.qty} |`);
        }
        lines.push("");
      }
    }
  }

  lines.push("---");
  lines.push("");
  lines.push("## Godown layout reference (all planned shelves)");
  lines.push("");
  for (const layout of GODOWN_LAYOUTS) {
    lines.push(`### ${layout.name} (\`${layout.code}\`) — prefix \`${layout.scanPrefix}\``);
    lines.push("");
    lines.push("| Zone | Shelf | Shelf scan code |");
    lines.push("|------|-------|-----------------|");
    for (const { zone, shelf } of shelfRows(layout.zones)) {
      const scan = shelfCodeFromRow(
        { zone, shelf },
        { code: layout.code, scanPrefix: layout.scanPrefix }
      );
      lines.push(`| ${zone} | ${shelf} | \`${scan}\` |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
