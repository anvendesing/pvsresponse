/**
 * Rename WH-FG → Stock Room, set scan prefix STR, seed zones A–D bins (Zone C layout).
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
  STOCK_ROOM_BIN_COUNT,
  STOCK_ROOM_NAME,
  STOCK_ROOM_SCAN_PREFIX,
  STOCK_ROOM_WAREHOUSE_CODE,
  STOCK_ROOM_ZONE_C_BIN_COUNT,
  stockRoomBinRows,
} from "../lib/stock-room-layout.js";

const dryRun = process.argv.includes("--dry-run");
const db = new PrismaClient();

async function main() {
  let wh = await db.warehouse.findUnique({
    where: { code: STOCK_ROOM_WAREHOUSE_CODE },
  });
  if (!wh) {
    throw new Error(
      `Warehouse ${STOCK_ROOM_WAREHOUSE_CODE} not found. Create it in Settings or run prisma seed.`
    );
  }

  const needsRename = wh.name !== STOCK_ROOM_NAME;
  const needsPrefix = wh.scanPrefix !== STOCK_ROOM_SCAN_PREFIX;

  if (!dryRun && (needsRename || needsPrefix)) {
    await db.warehouse.update({
      where: { id: wh.id },
      data: {
        name: STOCK_ROOM_NAME,
        scanPrefix: STOCK_ROOM_SCAN_PREFIX,
      },
    });
    console.log(`Updated ${wh.code}: name="${STOCK_ROOM_NAME}", scanPrefix=${STOCK_ROOM_SCAN_PREFIX}`);
    wh = {
      ...wh,
      name: STOCK_ROOM_NAME,
      scanPrefix: STOCK_ROOM_SCAN_PREFIX,
    };
  } else if (dryRun && (needsRename || needsPrefix)) {
    console.log(
      `[DRY RUN] Would rename to "${STOCK_ROOM_NAME}" and set scanPrefix=${STOCK_ROOM_SCAN_PREFIX}`
    );
  }

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
    `Stock Room (${wh.code}): ${planned.length} layout bins (${STOCK_ROOM_ZONE_C_BIN_COUNT} in zone C),`,
    `${existing.length} already in DB, ${toCreate.length} to create`
  );
  console.log("  Zones A, B, D reserved (empty). Zone C fully mapped.");

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
