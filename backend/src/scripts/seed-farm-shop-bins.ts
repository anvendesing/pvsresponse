#!/usr/bin/env tsx
/**
 * Create Farm Shop warehouse (WH-FARM) and seed zone A bins.
 *
 * Run:
 *   cd backend
 *   npm run db:seed-farm-shop:dev
 *   npx tsx scripts/seed-farm-shop-bins.ts --dry-run
 */

import { PrismaClient } from "@prisma/client";
import { binCodeFromRow } from "../lib/codes.js";
import {
  FARM_SHOP_BIN_COUNT,
  FARM_SHOP_NAME,
  FARM_SHOP_SCAN_PREFIX,
  FARM_SHOP_WAREHOUSE_CODE,
  FARM_SHOP_ZONE_A_BIN_COUNT,
  farmShopBinRows,
} from "../lib/farm-shop-layout.js";

const dryRun = process.argv.includes("--dry-run");
const db = new PrismaClient();

async function resolveFarmShopWarehouse() {
  let wh = await db.warehouse.findUnique({
    where: { code: FARM_SHOP_WAREHOUSE_CODE },
  });

  if (!wh) {
    if (dryRun) {
      console.log(
        `[DRY RUN] Would create warehouse ${FARM_SHOP_WAREHOUSE_CODE} ("${FARM_SHOP_NAME}") scanPrefix=${FARM_SHOP_SCAN_PREFIX}`
      );
      return {
        id: "dry-run",
        code: FARM_SHOP_WAREHOUSE_CODE,
        name: FARM_SHOP_NAME,
        scanPrefix: FARM_SHOP_SCAN_PREFIX,
      };
    }
    wh = await db.warehouse.create({
      data: {
        code: FARM_SHOP_WAREHOUSE_CODE,
        name: FARM_SHOP_NAME,
        city: "Pune",
        scanPrefix: FARM_SHOP_SCAN_PREFIX,
        kind: "storage",
        active: true,
      },
    });
    console.log(`Created warehouse ${wh.code} ("${FARM_SHOP_NAME}")`);
  }

  const needsMeta =
    wh.name !== FARM_SHOP_NAME || wh.scanPrefix !== FARM_SHOP_SCAN_PREFIX;
  if (needsMeta && !dryRun) {
    await db.warehouse.update({
      where: { id: wh.id },
      data: { name: FARM_SHOP_NAME, scanPrefix: FARM_SHOP_SCAN_PREFIX },
    });
    wh = { ...wh, name: FARM_SHOP_NAME, scanPrefix: FARM_SHOP_SCAN_PREFIX };
  }

  return wh;
}

async function main() {
  const wh = await resolveFarmShopWarehouse();
  if (dryRun && wh.id === "dry-run") {
    const planned = farmShopBinRows();
    console.log(
      `[DRY RUN] Farm Shop: ${planned.length} zone A bins (${FARM_SHOP_ZONE_A_BIN_COUNT} planned)`
    );
    return;
  }

  const planned = farmShopBinRows();
  const existing = await db.bin.findMany({
    where: { warehouseId: wh.id },
    select: { zone: true, shelf: true, bin: true },
  });
  const existingKeys = new Set(
    existing.map((b) => `${b.zone}/${b.shelf}/${b.bin}`)
  );

  const toCreate = planned.filter(
    (r) => !existingKeys.has(`${r.zone}/${r.shelf}/${r.bin}`)
  );

  console.log(
    dryRun ? "[DRY RUN] " : "",
    `Farm Shop (${wh.code}): ${planned.length} layout bins (zone A=${FARM_SHOP_ZONE_A_BIN_COUNT}),`,
    `${existing.length} already in DB, ${toCreate.length} to create`
  );
  console.log("  Zone A: 25 shelves.");

  if (dryRun) {
    for (const r of toCreate.slice(0, 5)) {
      console.log(`  would create ${r.zone}/${r.shelf}/${r.bin}`);
    }
    if (toCreate.length > 5) console.log(`  … and ${toCreate.length - 5} more`);
    const sample = binCodeFromRow(
      { zone: "A", shelf: "S01", bin: "06" },
      { code: wh.code, scanPrefix: FARM_SHOP_SCAN_PREFIX }
    );
    console.log(`  sample code: ${sample}`);
    return;
  }

  if (toCreate.length > 0) {
    const data = toCreate.map((r) => ({
      warehouseId: wh.id,
      zone: r.zone,
      shelf: r.shelf,
      bin: r.bin,
      code: binCodeFromRow(r, { code: wh.code, scanPrefix: wh.scanPrefix }),
      qty: 0,
      reservedQty: 0,
      capacity: 9999,
    }));
    const result = await db.bin.createMany({ data });
    console.log(`Created ${result.count} bins.`);
  }

  const allBins = await db.bin.findMany({ where: { warehouseId: wh.id } });
  let refreshed = 0;
  for (const b of allBins) {
    const target = binCodeFromRow(b, { code: wh.code, scanPrefix: wh.scanPrefix });
    if (b.code !== target) {
      await db.bin.update({ where: { id: b.id }, data: { code: target } });
      refreshed += 1;
    }
  }
  if (refreshed > 0) {
    console.log(`Refreshed ${refreshed} bin scan codes → ${FARM_SHOP_SCAN_PREFIX}.<zone><shelf>.<bin>`);
  }

  console.log(
    `\nExample: ${binCodeFromRow({ zone: "A", shelf: "S01", bin: "06" }, { code: wh.code, scanPrefix: wh.scanPrefix })}`
  );
  console.log(`Total layout bins: ${FARM_SHOP_BIN_COUNT}.`);
  console.log("Generate labels: npm run labels:farm-shop");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
