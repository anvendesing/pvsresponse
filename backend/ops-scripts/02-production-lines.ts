#!/usr/bin/env tsx
/**
 * Step 2 — Work centers + link to production-line warehouses.
 */

import {
  EXISTING_FINISHED_GOODS_WH_CODE,
  PRODUCTION_LINES,
  type ProductionLineDef,
} from "./config/site-layout.js";
import { db, dryRun, log } from "./lib/db.js";

const opsTag = (line: ProductionLineDef) => {
  const parts = [
    `fg=${line.putawayDestinationWhCode}`,
    `staging=${line.productionWhCode}`,
    `replenish=${line.replenishFromStorageCodes.join(",")}`,
  ];
  return `[ops] ${parts.join(" ")}`;
};

async function assertFinishedGoodsWarehouse() {
  const fg = await db.warehouse.findUnique({
    where: { code: EXISTING_FINISHED_GOODS_WH_CODE },
    select: { id: true, code: true, name: true, active: true },
  });
  if (!fg) {
    log(
      `\n  ⚠ Missing warehouse "${EXISTING_FINISHED_GOODS_WH_CODE}". ` +
        `Use your existing finished-goods warehouse code in EXISTING_FINISHED_GOODS_WH_CODE ` +
        `if the code differs.\n`
    );
    return;
  }
  if (!fg.active) {
    log(`  ⚠ ${fg.code} exists but is inactive — activate in Settings → Warehouses.`);
  }
}

async function linkProductionWarehouse(line: ProductionLineDef) {
  const wh = await db.warehouse.findUnique({
    where: { code: line.productionWhCode },
  });
  if (!wh) {
    throw new Error(
      `Production warehouse ${line.productionWhCode} missing — run 01-warehouses first.`
    );
  }
  if (wh.kind !== "production") {
    throw new Error(`${line.productionWhCode} must be kind=production`);
  }

  const description = `${line.description}\n${opsTag(line)}`;

  if (dryRun) {
    log(`  [dry] WC ${line.workCenterCode} → ${line.productionWhCode}`);
    return;
  }

  const wc = await db.workCenter.upsert({
    where: { code: line.workCenterCode },
    create: {
      code: line.workCenterCode,
      name: line.workCenterName,
      description,
      active: true,
      productionLineWarehouseId: wh.id,
    },
    update: {
      name: line.workCenterName,
      description,
      active: true,
      productionLineWarehouseId: wh.id,
    },
  });

  const conflict = await db.workCenter.findFirst({
    where: {
      productionLineWarehouseId: wh.id,
      id: { not: wc.id },
    },
  });
  if (conflict) {
    throw new Error(
      `Warehouse ${wh.code} already linked to WC ${conflict.code}. Resolve manually.`
    );
  }

  log(`  ✓ ${wc.code} → ${wh.code}  (putaway → ${line.putawayDestinationWhCode})`);
}

async function main() {
  log(dryRun ? "02-production-lines (DRY RUN)" : "02-production-lines — work centers…");

  await assertFinishedGoodsWarehouse();

  for (const line of PRODUCTION_LINES) {
    await linkProductionWarehouse(line);
  }

  log("\n── Next step ──");
  log(`  Run: npm run ops:putaway-fg  (one bin per variant in ${EXISTING_FINISHED_GOODS_WH_CODE})`);
  log("  Optional: stock rules, BOM default work centers.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
