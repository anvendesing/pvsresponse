#!/usr/bin/env tsx
/**
 * Seed MO stock rules from Tally sales history (JIT production plan).
 *
 * Reads tally_history_production_planning.xlsx and creates triggerType=mo rules
 * on Stock Room bins — when variant stock falls below the reorder point, an MO
 * is auto-created using the variant's active manufacturing BOM.
 *
 *   npm run db:seed-tally-mo-rules:dev
 *   npm run db:seed-tally-mo-rules:dev -- --dry-run
 *   npm run db:seed-tally-mo-rules:dev -- path/to/file.xlsx
 *   npm run db:seed-tally-mo-rules:dev -- --replace   # deactivate prior tally-jit rules
 */
import { readFileSync } from "fs";
import { join } from "path";
import XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";
import {
  parseTallyJitSheet,
  reorderPointFromTally,
  reorderTargetFromTally,
  type TallyJitRow,
} from "../src/lib/tally-jit-plan.js";
import {
  binCandidates,
  parseOpeningStockAssignments,
  shelfCandidates,
} from "../src/lib/opening-stock-assignments.js";
import { EXISTING_FINISHED_GOODS_WH_CODE } from "../ops-scripts/config/site-layout.js";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const replace = process.argv.includes("--replace");
const fileArg = process.argv.find((a) => a.endsWith(".xlsx"));
const xlsxPath = fileArg
  ? join(process.cwd(), fileArg)
  : join(process.cwd(), "..", "tally_history_production_planning.xlsx");

const openingStrBinBySku = new Map<string, { zone: string; shelf: string; bin: string }>();
for (const a of parseOpeningStockAssignments()) {
  if (a.warehouseCode === EXISTING_FINISHED_GOODS_WH_CODE) {
    openingStrBinBySku.set(a.variantSku.toUpperCase(), {
      zone: a.zone,
      shelf: a.shelf,
      bin: a.bin,
    });
  }
}

const TALLY_TAG = "tally-jit";

const BOM_REVISION_PRIORITY = [
  "Rev-Pack",
  "Rev-Oil-Filter",
  "Rev-Soap-Pack",
  "Rev-Oil-Extract",
  "Rev-Soap-Cook",
] as const;

type BomPick = {
  id: string;
  revision: string;
  outputQty: number;
  defaultFacilityId: string | null;
};

function pickBestBom(boms: BomPick[]): BomPick | null {
  if (boms.length === 0) return null;
  for (const prefix of BOM_REVISION_PRIORITY) {
    const hit = boms.find((b) => b.revision.includes(prefix));
    if (hit) return hit;
  }
  return boms[0] ?? null;
}

async function resolveManufacturingBom(
  productId: string,
  variantId: string
): Promise<BomPick | null> {
  const variantBoms = await db.bom.findMany({
    where: { productId, variantId, active: true, defaultFacilityId: { not: null } },
    select: {
      id: true,
      revision: true,
      outputQty: true,
      defaultFacilityId: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  const fromVariant = pickBestBom(variantBoms);
  if (fromVariant) return fromVariant;

  const productBoms = await db.bom.findMany({
    where: { productId, variantId: null, active: true, defaultFacilityId: { not: null } },
    select: {
      id: true,
      revision: true,
      outputQty: true,
      defaultFacilityId: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  return pickBestBom(productBoms);
}

async function resolveStrMonitorBin(
  strWarehouseId: string,
  productId: string,
  variantId: string,
  variantSku: string
): Promise<{ id: string; label: string } | null> {
  const held = await db.bin.findFirst({
    where: { warehouseId: strWarehouseId, variantId },
    select: { id: true, zone: true, shelf: true, bin: true },
  });
  if (held) {
    return { id: held.id, label: `${held.zone}/${held.shelf}/${held.bin}` };
  }

  const putaway = await db.putawayRule.findFirst({
    where: {
      variantId,
      toWarehouseId: strWarehouseId,
      active: true,
      toBinId: { not: null },
    },
    orderBy: { priority: "asc" },
    include: {
      tobin: { select: { id: true, zone: true, shelf: true, bin: true } },
    },
  });
  if (putaway?.tobin) {
    const b = putaway.tobin;
    return { id: b.id, label: `${b.zone}/${b.shelf}/${b.bin} (putaway)` };
  }

  const productPutaway = await db.putawayRule.findFirst({
    where: {
      productId,
      variantId: null,
      toWarehouseId: strWarehouseId,
      active: true,
      toBinId: { not: null },
    },
    orderBy: { priority: "asc" },
    include: {
      tobin: { select: { id: true, zone: true, shelf: true, bin: true } },
    },
  });
  if (productPutaway?.tobin) {
    const b = productPutaway.tobin;
    return { id: b.id, label: `${b.zone}/${b.shelf}/${b.bin} (product putaway)` };
  }

  const opening = openingStrBinBySku.get(variantSku.toUpperCase());
  if (opening) {
    for (const shelf of shelfCandidates(opening.shelf)) {
      for (const bin of binCandidates(opening.bin)) {
        const row = await db.bin.findUnique({
          where: {
            warehouseId_zone_shelf_bin: {
              warehouseId: strWarehouseId,
              zone: opening.zone,
              shelf,
              bin,
            },
          },
          select: { id: true, zone: true, shelf: true, bin: true },
        });
        if (row) {
          return {
            id: row.id,
            label: `${row.zone}/${row.shelf}/${row.bin} (opening map)`,
          };
        }
      }
    }
  }

  const parentBin = await db.bin.findFirst({
    where: { warehouseId: strWarehouseId, productId, variantId: null },
    select: { id: true, zone: true, shelf: true, bin: true },
  });
  if (parentBin) {
    return {
      id: parentBin.id,
      label: `${parentBin.zone}/${parentBin.shelf}/${parentBin.bin} (parent)`,
    };
  }

  return null;
}

function ruleNotes(row: TallyJitRow, bomRevision: string, binLabel: string): string {
  return (
    `Tally JIT · ${row.tallyName} · ROP=${reorderPointFromTally(row)} · max=${reorderTargetFromTally(row)}` +
    ` · avg ${row.avgDailySales.toFixed(1)}/day · BOM ${bomRevision} · monitor STR ${binLabel}`
  );
}

async function upsertMoRule(opts: {
  productId: string;
  variantId: string;
  monitorBinId: string;
  bomId: string;
  minQty: number;
  maxQty: number;
  tags: string;
  notes: string;
}) {
  const existing = await db.stockRule.findFirst({
    where: {
      productId: opts.productId,
      variantId: opts.variantId,
      monitorBinId: opts.monitorBinId,
      triggerType: "mo",
      active: true,
    },
  });

  if (dryRun) return existing ? "updated" : "created";

  const data = {
    minQty: opts.minQty,
    maxQty: opts.maxQty,
    bomId: opts.bomId,
    tags: opts.tags,
    notes: opts.notes,
    active: true,
    triggerType: "mo" as const,
    toBinId: opts.monitorBinId,
  };

  if (existing) {
    await db.stockRule.update({ where: { id: existing.id }, data });
    return "updated";
  }

  await db.stockRule.create({
    data: {
      productId: opts.productId,
      variantId: opts.variantId,
      monitorBinId: opts.monitorBinId,
      ...data,
    },
  });
  return "created";
}

async function main() {
  console.log(
    dryRun
      ? `DRY RUN — Tally MO stock rules\n  file: ${xlsxPath}\n`
      : `Seeding MO stock rules from Tally JIT plan\n  file: ${xlsxPath}\n`
  );

  const wb = XLSX.read(readFileSync(xlsxPath));
  const sheet = wb.Sheets["JIT Production Plan"];
  if (!sheet) {
    throw new Error('Sheet "JIT Production Plan" not found in workbook.');
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
  const plan = parseTallyJitSheet(rawRows);
  console.log(
    `Parsed ${plan.rows.length} matched SKU(s) (${plan.matched} matched, ${plan.unmatched} other rows in file)\n`
  );

  const strWh = await db.warehouse.findUnique({
    where: { code: EXISTING_FINISHED_GOODS_WH_CODE },
  });
  if (!strWh) {
    throw new Error(`Warehouse ${EXISTING_FINISHED_GOODS_WH_CODE} not found.`);
  }

  if (replace && !dryRun) {
    const off = await db.stockRule.updateMany({
      where: { tags: { contains: TALLY_TAG }, triggerType: "mo", active: true },
      data: { active: false },
    });
    if (off.count > 0) console.log(`Deactivated ${off.count} prior ${TALLY_TAG} MO rule(s).\n`);
  }

  let created = 0;
  let updated = 0;
  let skippedNoVariant = 0;
  let skippedNoBom = 0;
  let skippedNoBin = 0;

  for (const row of plan.rows) {
    const variant = await db.productVariant.findUnique({
      where: { sku: row.variantSku },
      include: { product: { select: { id: true, sku: true, name: true } } },
    });
    if (!variant) {
      skippedNoVariant += 1;
      continue;
    }

    const bom = await resolveManufacturingBom(variant.productId, variant.id);
    if (!bom) {
      skippedNoBom += 1;
      continue;
    }

    const monitor = await resolveStrMonitorBin(
      strWh.id,
      variant.productId,
      variant.id,
      row.variantSku
    );
    if (!monitor) {
      skippedNoBin += 1;
      continue;
    }

    const minQty = reorderPointFromTally(row);
    const maxQty = reorderTargetFromTally(row);
    const action = await upsertMoRule({
      productId: variant.productId,
      variantId: variant.id,
      monitorBinId: monitor.id,
      bomId: bom.id,
      minQty,
      maxQty,
      tags: `${TALLY_TAG},rank-${row.rank}`,
      notes: ruleNotes(row, bom.revision, monitor.label),
    });

    if (action === "created") created += 1;
    else updated += 1;

    if (dryRun && (created + updated) <= 12) {
      console.log(
        `  [dry] ${row.variantSku} ROP=${minQty} max=${maxQty} bom=${bom.revision} bin=${monitor.label}`
      );
    }
  }

  console.log(
    `\n${dryRun ? "[DRY RUN] " : ""}Done.` +
      `\n  MO rules created: ${created}` +
      `\n  MO rules updated: ${updated}` +
      `\n  skipped — no variant: ${skippedNoVariant}` +
      `\n  skipped — no BOM: ${skippedNoBom}` +
      `\n  skipped — no STR monitor bin: ${skippedNoBin}` +
      `\n\nTrigger when STR stock < ROP (minQty); MO qty sized to reach maxQty using BOM batch output.`
  );

  if (skippedNoBom > 0) {
    console.log(
      `\nTip: ${skippedNoBom} SKU(s) have no manufacturing BOM — run db:generate-pack-boms:dev -- --apply or product-specific BOM seeds first.`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
