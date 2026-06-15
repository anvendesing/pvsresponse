#!/usr/bin/env tsx
/**
 * Step 2 — Production facilities (rooms) + their default production lines +
 * link to facility production warehouses.
 *
 * Each entry in PRODUCTION_FACILITIES maps to:
 *   • One ProductionFacility row (formerly WorkCenter — same DB table via @@map)
 *   • One default ProductionLine ("Main Line") created if it doesn't exist yet
 *   • The facility's productionLineWarehouseId linked to the production WH
 */

import {
  EXISTING_FINISHED_GOODS_WH_CODE,
  PRODUCTION_FACILITIES,
  type FacilityDef,
} from "./config/site-layout.js";
import { db, dryRun, log } from "./lib/db.js";

const opsTag = (fac: FacilityDef) => {
  const parts = [
    `fg=${fac.putawayDestinationWhCode}`,
    `staging=${fac.productionWhCode}`,
    `replenish=${fac.replenishFromStorageCodes.join(",")}`,
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

async function seedFacility(fac: FacilityDef) {
  const wh = await db.warehouse.findUnique({
    where: { code: fac.productionWhCode },
  });
  if (!wh) {
    throw new Error(
      `Production warehouse ${fac.productionWhCode} missing — run 01-warehouses first.`
    );
  }
  if (wh.kind !== "production") {
    throw new Error(`${fac.productionWhCode} must be kind=production`);
  }

  const description = `${fac.description}\n${opsTag(fac)}`;

  if (dryRun) {
    log(`  [dry] Facility ${fac.facilityCode} → ${fac.productionWhCode}`);
    log(`  [dry]   Lines: ${fac.lines.map((l) => l.code).join(", ")}`);
    return;
  }

  // Upsert the facility (stored in the WorkCenter table via @@map).
  const facility = await db.productionFacility.upsert({
    where: { code: fac.facilityCode },
    create: {
      code: fac.facilityCode,
      name: fac.facilityName,
      description,
      active: true,
      productionLineWarehouseId: wh.id,
    },
    update: {
      name: fac.facilityName,
      description,
      active: true,
      productionLineWarehouseId: wh.id,
    },
  });

  const conflict = await db.productionFacility.findFirst({
    where: {
      productionLineWarehouseId: wh.id,
      id: { not: facility.id },
    },
  });
  if (conflict) {
    throw new Error(
      `Warehouse ${wh.code} already linked to facility ${conflict.code}. Resolve manually.`
    );
  }

  // Upsert each declared production line (first is the seeded "Main Line").
  for (const lineDef of fac.lines) {
    const line = await db.productionLine.upsert({
      where: { code: lineDef.code },
      create: {
        code: lineDef.code,
        name: lineDef.name,
        facilityId: facility.id,
        active: true,
      },
      update: {
        name: lineDef.name,
        facilityId: facility.id,
        active: true,
      },
    });
    log(`  ✓ ${facility.code} / ${line.code} → ${wh.code}  (putaway → ${fac.putawayDestinationWhCode})`);
  }
}

async function main() {
  log(dryRun ? "02-production-lines (DRY RUN)" : "02-production-lines — facilities + lines…");

  await assertFinishedGoodsWarehouse();

  for (const fac of PRODUCTION_FACILITIES) {
    await seedFacility(fac);
  }

  log("\n── Next step ──");
  log(`  Run: npm run ops:putaway-fg  (one bin per variant in ${EXISTING_FINISHED_GOODS_WH_CODE})`);
  log("  Optional: stock rules, BOM default facilities.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
