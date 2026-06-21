/**
 * Ensure Stock Room exists as code STR (migrate legacy WH-FG), seed layout bins (zones B + C).
 *
 * Local dev:
 *   npm run db:seed-stock-room:dev
 *   npm run db:seed-stock-room:dev -- --dry-run
 *
 * VPS (inside Docker — uses compiled dist/):
 *   docker compose exec backend npm run db:seed-stock-room
 *   docker compose exec backend npm run db:seed-stock-room -- --dry-run
 */

import { PrismaClient } from "@prisma/client";
import { binCodeFromRow } from "../lib/codes.js";
import {
  LEGACY_STOCK_ROOM_WH_CODE,
  STOCK_ROOM_BIN_COUNT,
  STOCK_ROOM_NAME,
  STOCK_ROOM_SCAN_PREFIX,
  STOCK_ROOM_WAREHOUSE_CODE,
  STOCK_ROOM_ZONE_A_BIN_COUNT,
  STOCK_ROOM_ZONE_B_BIN_COUNT,
  STOCK_ROOM_ZONE_C_BIN_COUNT,
  stockRoomBinRows,
} from "../lib/stock-room-layout.js";

const dryRun = process.argv.includes("--dry-run");
const db = new PrismaClient();

async function resolveStockRoomWarehouse() {
  let wh = await db.warehouse.findUnique({
    where: { code: STOCK_ROOM_WAREHOUSE_CODE },
  });

  if (!wh) {
    const legacy = await db.warehouse.findUnique({
      where: { code: LEGACY_STOCK_ROOM_WH_CODE },
    });
    if (legacy) {
      if (!dryRun) {
        await db.warehouse.update({
          where: { id: legacy.id },
          data: {
            code: STOCK_ROOM_WAREHOUSE_CODE,
            name: STOCK_ROOM_NAME,
            scanPrefix: STOCK_ROOM_SCAN_PREFIX,
          },
        });
      }
      console.log(
        dryRun ? "[DRY RUN] Would migrate" : "Migrated",
        `${LEGACY_STOCK_ROOM_WH_CODE} → ${STOCK_ROOM_WAREHOUSE_CODE} ("${STOCK_ROOM_NAME}")`
      );
      wh = {
        ...legacy,
        code: STOCK_ROOM_WAREHOUSE_CODE,
        name: STOCK_ROOM_NAME,
        scanPrefix: STOCK_ROOM_SCAN_PREFIX,
      };
    }
  }

  if (!wh) {
    throw new Error(
      `Stock Room warehouse not found (expected code ${STOCK_ROOM_WAREHOUSE_CODE} or legacy ${LEGACY_STOCK_ROOM_WH_CODE}). Run prisma seed or create in Settings.`
    );
  }

  const needsMeta =
    wh.name !== STOCK_ROOM_NAME || wh.scanPrefix !== STOCK_ROOM_SCAN_PREFIX;
  if (needsMeta && !dryRun) {
    await db.warehouse.update({
      where: { id: wh.id },
      data: { name: STOCK_ROOM_NAME, scanPrefix: STOCK_ROOM_SCAN_PREFIX },
    });
    wh = { ...wh, name: STOCK_ROOM_NAME, scanPrefix: STOCK_ROOM_SCAN_PREFIX };
  }

  return wh;
}

async function main() {
  let wh = await resolveStockRoomWarehouse();

  const planned = stockRoomBinRows();
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
    `Stock Room (${wh.code}): ${planned.length} layout bins (A=${STOCK_ROOM_ZONE_A_BIN_COUNT}, B=${STOCK_ROOM_ZONE_B_BIN_COUNT}, C=${STOCK_ROOM_ZONE_C_BIN_COUNT}),`,
    `${existing.length} already in DB, ${toCreate.length} to create`
  );
  console.log("  Zone A: 6 shelves. Zone B: 18 shelves. Zone C fully mapped. Zone D reserved.");

  if (dryRun) {
    for (const r of toCreate.slice(0, 5)) {
      console.log(`  would create ${r.zone}/${r.shelf}/${r.bin}`);
    }
    if (toCreate.length > 5) console.log(`  … and ${toCreate.length - 5} more`);
    const sample = binCodeFromRow(
      { zone: "C", shelf: "S05", bin: "08" },
      { code: wh.code, scanPrefix: STOCK_ROOM_SCAN_PREFIX }
    );
    console.log(`  sample code: ${sample} (${sample.length} chars)`);
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
    console.log(`Refreshed ${refreshed} bin scan codes → ${STOCK_ROOM_SCAN_PREFIX}.<zone><shelf>.<bin>`);
  }

  console.log(
    `\nExample: ${binCodeFromRow({ zone: "C", shelf: "S05", bin: "08" }, { code: wh.code, scanPrefix: wh.scanPrefix })}`
  );
  console.log(`Total layout bins: ${STOCK_ROOM_BIN_COUNT}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
