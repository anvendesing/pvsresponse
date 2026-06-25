#!/usr/bin/env tsx
/**
 * Seed opening stock (default 1234) for BOM components across godowns and
 * facility production warehouses so MO release finds on-hand stock and skips
 * replenishment transfer orders.
 *
 *   npm run db:seed-godown-mo-stock:dev
 *   npm run db:seed-godown-mo-stock:dev -- --dry-run
 *   npm run db:seed-godown-mo-stock:dev -- --godowns-only
 *   npm run db:seed-godown-mo-stock:dev -- --qty 500
 */
import { PrismaClient } from "@prisma/client";
import { applyBinReassign } from "../lib/bin-stock-update.js";
import { resolveOrCreateLocationBin } from "../lib/location-bin.js";
import { shouldSkipRawProcurement } from "../lib/raw-semi-exclusions.js";
import { GODOWN_LAYOUTS } from "../lib/godown-layouts.js";
import {
  EXISTING_FINISHED_GOODS_WH_CODE,
  PRODUCTION_FACILITIES,
  STORAGE_WAREHOUSES,
} from "../../ops-scripts/config/site-layout.js";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const godownsOnly = process.argv.includes("--godowns-only");
const productionOnly = process.argv.includes("--production-only");
const qtyArg = process.argv.find((a) => a.startsWith("--qty="));
const OPENING_QTY = qtyArg ? Number(qtyArg.split("=")[1]) : 1234;

function isTestSku(sku: string): boolean {
  return /^DBOM-/i.test(sku);
}

function locationForIndex(idx: number) {
  const shelfNum = (idx % 99) + 1;
  const binNum = Math.floor(idx / 99) + 1;
  return {
    zone: "A",
    shelf: `S${String(shelfNum).padStart(2, "0")}`,
    bin: String(binNum).padStart(2, "0"),
  };
}

async function systemUserId(): Promise<string> {
  const user =
    (await db.user.findFirst({ where: { username: "admin" }, select: { id: true } })) ??
    (await db.user.findFirst({ select: { id: true } }));
  if (!user) throw new Error("No user found for stock audit trail.");
  return user.id;
}

async function collectMoStockProducts() {
  const ids = new Set<string>();

  const bomItems = await db.bomItem.findMany({
    where: { bom: { active: true } },
    select: { productId: true },
  });
  for (const row of bomItems) ids.add(row.productId);

  const rawAndSemi = await db.product.findMany({
    where: {
      type: { in: ["raw", "semi"] },
      state: { not: "discontinued" },
    },
    include: { category: { select: { slug: true } } },
  });

  for (const p of rawAndSemi) {
    if (isTestSku(p.sku)) continue;
    if (
      shouldSkipRawProcurement({
        sku: p.sku,
        name: p.name,
        type: p.type,
        categorySlug: p.category?.slug ?? null,
      })
    ) {
      continue;
    }
    ids.add(p.id);
  }

  return db.product.findMany({
    where: { id: { in: [...ids] } },
    orderBy: { sku: "asc" },
  });
}

function targetWarehouseCodes(): string[] {
  const godownCodes = GODOWN_LAYOUTS.map((g) => g.code);
  const storageCodes = STORAGE_WAREHOUSES.map((s) => s.code);
  const rawYard = ["WH-RAW"];
  const productionCodes = [
    ...new Set(
      PRODUCTION_FACILITIES.map((f) => f.productionWhCode).filter(
        (c) => c !== EXISTING_FINISHED_GOODS_WH_CODE
      )
    ),
  ];

  if (productionOnly) return productionCodes;
  if (godownsOnly) return [...godownCodes, ...storageCodes, ...rawYard];
  return [...godownCodes, ...storageCodes, ...rawYard, ...productionCodes];
}

async function main() {
  const whCodes = targetWarehouseCodes();
  const products = await collectMoStockProducts();

  console.log(
    dryRun
      ? `DRY RUN — ${products.length} product(s) × ${whCodes.length} warehouse(s) @ qty ${OPENING_QTY}\n`
      : `Seeding MO stock — ${products.length} product(s) × ${whCodes.length} warehouse(s) @ qty ${OPENING_QTY}…\n`
  );

  const warehouses = await db.warehouse.findMany({
    where: { code: { in: whCodes }, active: true },
    select: { id: true, code: true, name: true, kind: true },
    orderBy: { code: "asc" },
  });

  const missing = whCodes.filter((c) => !warehouses.some((w) => w.code === c));
  if (missing.length) {
    console.warn(`  ⚠ Warehouses not found (run ops:site-setup / db:seed-godowns): ${missing.join(", ")}`);
  }

  const userId = dryRun ? "dry-run" : await systemUserId();
  let seeded = 0;
  let skipped = 0;

  for (const wh of warehouses) {
    console.log(`\n${wh.code} (${wh.kind}) — ${wh.name}`);
    let idx = 0;

    for (const product of products) {
      const loc = locationForIndex(idx++);
      const existing = await db.bin.findFirst({
        where: {
          warehouseId: wh.id,
          productId: product.id,
          variantId: null,
          qty: { gte: OPENING_QTY },
        },
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      if (dryRun) {
        console.log(
          `  [dry] ${product.sku} → ${loc.zone}/${loc.shelf}/${loc.bin} ×${OPENING_QTY}`
        );
        seeded += 1;
        continue;
      }

      const bin = await resolveOrCreateLocationBin(db, wh, loc);
      await applyBinReassign(bin, {
        productId: product.id,
        variantId: null,
        qty: OPENING_QTY,
        reasonCode: "physical_match",
        remarks: `MO staging seed (${product.sku} @ ${wh.code})`,
        userId,
      });
      seeded += 1;
    }
  }

  console.log(
    `\n${dryRun ? "[DRY RUN] " : ""}Done.` +
      `\n  bins set/updated: ${seeded}` +
      `\n  already sufficient: ${skipped}`
  );

  if (!dryRun && seeded > 0) {
    console.log("Tip: npm run db:sync-stock:dev to refresh product counters.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
