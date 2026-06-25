#!/usr/bin/env tsx
/**
 * Export all BOMs to a formatted Excel workbook for reference.
 *
 * Sheets:
 *   1. Guide          — how to read the export
 *   2. BOM Index      — one row per BOM (product, revision, facility, output qty)
 *   3. Operations     — manufacturing steps (seq, line, machine, QA, dependencies)
 *   4. Components     — materials consumed per step
 *   5. By-products    — co-products / press cake etc.
 *   6. Exploded Raw   — flattened leaf materials for 1 batch output
 *
 *   npm run export:boms:dev
 *   npm run export:boms:dev -- --out=output/boms-reference.xlsx
 *   npm run export:boms:dev -- --all          # include inactive BOMs
 */
import { mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { explodeBom } from "../src/lib/bom.js";

const db = new PrismaClient();

const outArg = process.argv.find((a) => a.startsWith("--out="));
const includeInactive = process.argv.includes("--all");
const outPath = resolve(
  outArg?.slice("--out=".length) ??
    join(process.cwd(), "output", "boms-reference.xlsx")
);

const HEAD = "FF003087";
const NAVY = "FF001A4D";
const ZEBRA = "FFF8FAFC";

function styleHeader(row: ExcelJS.Row) {
  row.height = 22;
  row.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = { bottom: { style: "thin", color: { argb: NAVY } } };
  });
}

function styleBody(ws: ExcelJS.Worksheet) {
  ws.eachRow((row, idx) => {
    if (idx === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
    if (idx % 2 === 0) {
      row.eachCell((c) => {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      });
    }
  });
}

function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  columns: Partial<ExcelJS.Column>[],
  rows: Record<string, unknown>[]
) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns;
  for (const row of rows) ws.addRow(row);
  styleHeader(ws.getRow(1));
  styleBody(ws);
  return ws;
}

async function main() {
  console.log(
    includeInactive
      ? "Exporting all BOMs (active + inactive)…"
      : "Exporting active BOMs…"
  );

  const boms = await db.bom.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ product: { sku: "asc" } }, { revision: "asc" }],
    include: {
      product: {
        select: { sku: true, name: true, type: true, uom: true },
      },
      variant: { select: { sku: true, size: true } },
      defaultFacility: { select: { code: true, name: true } },
      defaultLine: { select: { code: true, name: true } },
      defaultMachine: { select: { code: true, name: true } },
      items: {
        orderBy: { id: "asc" },
        include: {
          product: { select: { sku: true, name: true, type: true, uom: true } },
          bomOperation: { select: { seq: true, name: true } },
        },
      },
      byproducts: {
        include: {
          product: { select: { sku: true, name: true, uom: true } },
          variant: { select: { sku: true, size: true } },
        },
      },
      operations: {
        orderBy: { seq: "asc" },
        include: {
          facility: { select: { code: true, name: true } },
          line: { select: { code: true, name: true } },
          machine: { select: { code: true, name: true } },
          blockedBy: { select: { seq: true, name: true } },
          eligibleLines: {
            include: { line: { select: { code: true, name: true } } },
          },
        },
      },
    },
  });

  console.log(`  BOMs loaded: ${boms.length}`);

  const wb = new ExcelJS.Workbook();
  wb.creator = "PVS ERP";
  wb.created = new Date();
  wb.title = "BOM Reference Export";

  // --- Guide sheet ---
  const guide = wb.addWorksheet("Guide", { views: [{ state: "frozen", ySplit: 1 }] });
  guide.columns = [
    { header: "Topic", key: "topic", width: 22 },
    { header: "Description", key: "desc", width: 90 },
  ];
  const guideRows = [
    {
      topic: "Purpose",
      desc: "Reference export of all Bills of Materials (BOMs) with manufacturing steps, components, by-products, and exploded raw material totals.",
    },
    {
      topic: "BOM Index",
      desc: "One row per BOM. Parent SKU is the product being made. Variant SKU is set when the BOM applies to one retail pack size only. Output Qty is the batch size for one MO run of this BOM.",
    },
    {
      topic: "Operations",
      desc: "Manufacturing steps in sequence (Step Seq). Each step may run on a facility, production line, and machine. Blocked By Seq shows which step must finish first. Eligible Lines lists parallel lines (e.g. oil extractors EXT-01 … EXT-06).",
    },
    {
      topic: "Components",
      desc: "Materials consumed when running the BOM. Step Seq links to Operations. Scrap % adds extra consumption. Qty is per one BOM batch (see Output Qty on BOM Index).",
    },
    {
      topic: "By-products",
      desc: "Secondary outputs produced alongside the main product (e.g. press cake from oil extraction). Posted to inventory on MO complete, not consumed at issue.",
    },
    {
      topic: "Exploded Raw",
      desc: "Fully flattened material list for 1 batch — walks multi-level BOMs to leaf raw/semi items. Use for planning and godown stock checks.",
    },
    {
      topic: "Revision codes",
      desc: "Rev-Oil-Extract / Rev-Oil-Filter / Rev-Pack / Rev-Grain-Mill / Rev-Soap-* indicate process stage. Pack BOMs are usually auto-generated per variant.",
    },
    {
      topic: "Regenerate",
      desc: "Run: npm run export:boms:dev  (from backend folder). Add --all to include inactive BOMs.",
    },
  ];
  for (const r of guideRows) guide.addRow(r);
  styleHeader(guide.getRow(1));
  styleBody(guide);

  const indexRows: Record<string, unknown>[] = [];
  const opRows: Record<string, unknown>[] = [];
  const compRows: Record<string, unknown>[] = [];
  const byproductRows: Record<string, unknown>[] = [];
  const explodedRows: Record<string, unknown>[] = [];

  for (const bom of boms) {
    const parentSku = bom.product.sku;
    const variantSku = bom.variant?.sku ?? "";
    const batchLabel = `${bom.outputQty} ${bom.product.uom}`;

    indexRows.push({
      parentSku,
      parentName: bom.product.name,
      parentType: bom.product.type,
      variantSku,
      variantSize: bom.variant?.size ?? "",
      revision: bom.revision,
      active: bom.active ? "Yes" : "No",
      outputQty: bom.outputQty,
      outputUom: bom.product.uom,
      operationCount: bom.operations.length,
      componentCount: bom.items.length,
      byproductCount: bom.byproducts.length,
      facilityCode: bom.defaultFacility?.code ?? "",
      facilityName: bom.defaultFacility?.name ?? "",
      defaultLineCode: bom.defaultLine?.code ?? "",
      defaultLineName: bom.defaultLine?.name ?? "",
      defaultMachineCode: bom.defaultMachine?.code ?? "",
      operationDependencies: bom.operationDependencies ? "Yes" : "No",
      bomId: bom.id,
    });

    if (bom.operations.length === 0) {
      opRows.push({
        parentSku,
        variantSku,
        revision: bom.revision,
        stepSeq: 1,
        stepName: "(single step — no operations defined)",
        description: "All components issue at MO start.",
        facilityCode: bom.defaultFacility?.code ?? "",
        lineCode: bom.defaultLine?.code ?? "",
        machineCode: bom.defaultMachine?.code ?? "",
        durationMin: "",
        requiresQa: "",
        blockedBySeq: "",
        eligibleLines: bom.defaultLine?.code ?? "",
      });
    }

    for (const op of bom.operations) {
      const eligible = op.eligibleLines.map((el) => el.line.code).join(", ");
      opRows.push({
        parentSku,
        variantSku,
        revision: bom.revision,
        stepSeq: op.seq,
        stepName: op.name,
        description: op.description ?? "",
        facilityCode: op.facility?.code ?? bom.defaultFacility?.code ?? "",
        facilityName: op.facility?.name ?? bom.defaultFacility?.name ?? "",
        lineCode: op.line?.code ?? "",
        lineName: op.line?.name ?? "",
        machineCode: op.machine?.code ?? "",
        machineName: op.machine?.name ?? "",
        durationMin: op.durationMinutes ?? "",
        requiresQa: op.requiresQa ? "Yes" : "No",
        blockedBySeq: op.blockedBy?.seq ?? "",
        blockedByName: op.blockedBy?.name ?? "",
        eligibleLines: eligible || op.line?.code || "",
      });
    }

    for (const item of bom.items) {
      const stepSeq = item.bomOperation?.seq ?? 1;
      const stepName = item.bomOperation?.name ?? "(default)";
      compRows.push({
        parentSku,
        variantSku,
        revision: bom.revision,
        stepSeq,
        stepName,
        componentSku: item.product.sku,
        componentName: item.product.name,
        componentType: item.product.type,
        qty: item.qty,
        uom: item.uom,
        scrapPct: item.scrapPct,
        stockUom: item.product.uom,
        qtyPerBatch: item.qty,
        batchOutput: batchLabel,
      });
    }

    for (const bp of bom.byproducts) {
      byproductRows.push({
        parentSku,
        variantSku,
        revision: bom.revision,
        byproductSku: bp.variant?.sku ?? bp.product.sku,
        byproductName: bp.product.name,
        variantSize: bp.variant?.size ?? "",
        qty: bp.qty,
        uom: bp.uom,
        costSharePct: bp.costShare,
        batchOutput: batchLabel,
      });
    }

    try {
      const leaves = await explodeBom(bom.productId, bom.outputQty, {
        variantId: bom.variantId,
      });
      for (const leaf of leaves) {
        explodedRows.push({
          parentSku,
          variantSku,
          revision: bom.revision,
          batchOutput: batchLabel,
          leafSku: leaf.sku,
          leafName: leaf.name,
          leafUom: leaf.uom,
          totalQty: Math.round(leaf.qty * 1000) / 1000,
          bomUom: leaf.bomUom,
          bomQty: leaf.bomQty,
          path: leaf.path.join(" → "),
        });
      }
    } catch (e) {
      explodedRows.push({
        parentSku,
        variantSku,
        revision: bom.revision,
        batchOutput: batchLabel,
        leafSku: "(explode error)",
        leafName: e instanceof Error ? e.message : String(e),
        leafUom: "",
        totalQty: "",
        bomUom: "",
        bomQty: "",
        path: "",
      });
    }
  }

  addSheet(wb, "BOM Index", [
    { header: "Parent SKU", key: "parentSku", width: 14 },
    { header: "Parent Name", key: "parentName", width: 28 },
    { header: "Type", key: "parentType", width: 10 },
    { header: "Variant SKU", key: "variantSku", width: 16 },
    { header: "Variant Size", key: "variantSize", width: 12 },
    { header: "Revision", key: "revision", width: 18 },
    { header: "Active", key: "active", width: 8 },
    { header: "Output Qty", key: "outputQty", width: 10 },
    { header: "Output UoM", key: "outputUom", width: 10 },
    { header: "Steps", key: "operationCount", width: 8 },
    { header: "Components", key: "componentCount", width: 11 },
    { header: "By-products", key: "byproductCount", width: 11 },
    { header: "Facility Code", key: "facilityCode", width: 14 },
    { header: "Facility Name", key: "facilityName", width: 22 },
    { header: "Default Line", key: "defaultLineCode", width: 16 },
    { header: "Default Line Name", key: "defaultLineName", width: 20 },
    { header: "Default Machine", key: "defaultMachineCode", width: 16 },
    { header: "Op Dependencies", key: "operationDependencies", width: 14 },
    { header: "BOM ID", key: "bomId", width: 28 },
  ], indexRows);

  addSheet(wb, "Operations", [
    { header: "Parent SKU", key: "parentSku", width: 14 },
    { header: "Variant SKU", key: "variantSku", width: 16 },
    { header: "Revision", key: "revision", width: 18 },
    { header: "Step Seq", key: "stepSeq", width: 9 },
    { header: "Step Name", key: "stepName", width: 22 },
    { header: "Description", key: "description", width: 40 },
    { header: "Facility Code", key: "facilityCode", width: 14 },
    { header: "Facility Name", key: "facilityName", width: 20 },
    { header: "Line Code", key: "lineCode", width: 16 },
    { header: "Line Name", key: "lineName", width: 20 },
    { header: "Machine Code", key: "machineCode", width: 16 },
    { header: "Machine Name", key: "machineName", width: 20 },
    { header: "Duration (min)", key: "durationMin", width: 12 },
    { header: "Requires QA", key: "requiresQa", width: 11 },
    { header: "Blocked By Seq", key: "blockedBySeq", width: 13 },
    { header: "Blocked By Name", key: "blockedByName", width: 18 },
    { header: "Eligible Lines", key: "eligibleLines", width: 36 },
  ], opRows);

  addSheet(wb, "Components", [
    { header: "Parent SKU", key: "parentSku", width: 14 },
    { header: "Variant SKU", key: "variantSku", width: 16 },
    { header: "Revision", key: "revision", width: 18 },
    { header: "Step Seq", key: "stepSeq", width: 9 },
    { header: "Step Name", key: "stepName", width: 20 },
    { header: "Component SKU", key: "componentSku", width: 16 },
    { header: "Component Name", key: "componentName", width: 28 },
    { header: "Component Type", key: "componentType", width: 12 },
    { header: "Qty", key: "qty", width: 10 },
    { header: "UoM", key: "uom", width: 8 },
    { header: "Scrap %", key: "scrapPct", width: 9 },
    { header: "Stock UoM", key: "stockUom", width: 10 },
    { header: "Qty per Batch", key: "qtyPerBatch", width: 12 },
    { header: "Batch Output", key: "batchOutput", width: 14 },
  ], compRows);

  addSheet(wb, "By-products", [
    { header: "Parent SKU", key: "parentSku", width: 14 },
    { header: "Variant SKU", key: "variantSku", width: 16 },
    { header: "Revision", key: "revision", width: 18 },
    { header: "By-product SKU", key: "byproductSku", width: 16 },
    { header: "By-product Name", key: "byproductName", width: 28 },
    { header: "Variant Size", key: "variantSize", width: 12 },
    { header: "Qty", key: "qty", width: 10 },
    { header: "UoM", key: "uom", width: 8 },
    { header: "Cost Share %", key: "costSharePct", width: 12 },
    { header: "Batch Output", key: "batchOutput", width: 14 },
  ], byproductRows);

  addSheet(wb, "Exploded Raw", [
    { header: "Parent SKU", key: "parentSku", width: 14 },
    { header: "Variant SKU", key: "variantSku", width: 16 },
    { header: "Revision", key: "revision", width: 18 },
    { header: "Batch Output", key: "batchOutput", width: 14 },
    { header: "Leaf SKU", key: "leafSku", width: 16 },
    { header: "Leaf Name", key: "leafName", width: 28 },
    { header: "Leaf UoM", key: "leafUom", width: 10 },
    { header: "Total Qty", key: "totalQty", width: 12 },
    { header: "BOM UoM", key: "bomUom", width: 10 },
    { header: "BOM Qty", key: "bomQty", width: 10 },
    { header: "BOM Path", key: "path", width: 50 },
  ], explodedRows);

  mkdirSync(dirname(outPath), { recursive: true });
  await wb.xlsx.writeFile(outPath);

  console.log(`\nExported ${boms.length} BOM(s):`);
  console.log(`  BOM Index rows:    ${indexRows.length}`);
  console.log(`  Operation rows:    ${opRows.length}`);
  console.log(`  Component rows:    ${compRows.length}`);
  console.log(`  By-product rows:   ${byproductRows.length}`);
  console.log(`  Exploded rows:     ${explodedRows.length}`);
  console.log(`\nFile: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
