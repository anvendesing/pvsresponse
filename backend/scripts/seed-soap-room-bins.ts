#!/usr/bin/env tsx
/**
 * Create zones/shelves/bins for Soap Room (WH-PROD-SOAP) per soap-room-layout.ts.
 *
 * Run:
 *   cd backend
 *   npx tsx scripts/seed-soap-room-bins.ts
 *   npx tsx scripts/seed-soap-room-bins.ts --dry-run
 */

import { PrismaClient } from "@prisma/client";
import { binCodeFromRow } from "../src/lib/codes.js";
import {
  SOAP_ROOM_BIN_COUNT,
  SOAP_ROOM_SCAN_PREFIX,
  SOAP_ROOM_WAREHOUSE_CODE,
  soapRoomBinRows,
} from "./config/soap-room-layout.js";

const dryRun = process.argv.includes("--dry-run");
const db = new PrismaClient();

async function main() {
  let wh = await db.warehouse.findUnique({
    where: { code: SOAP_ROOM_WAREHOUSE_CODE },
  });
  if (!wh) {
    throw new Error(
      `Warehouse ${SOAP_ROOM_WAREHOUSE_CODE} not found. Run ops:production-lines or create the facility in Settings.`
    );
  }

  if (!dryRun && wh.scanPrefix !== SOAP_ROOM_SCAN_PREFIX) {
    await db.warehouse.update({
      where: { id: wh.id },
      data: { scanPrefix: SOAP_ROOM_SCAN_PREFIX },
    });
    console.log(`Set scanPrefix=${SOAP_ROOM_SCAN_PREFIX} on ${wh.code}`);
    wh = { ...wh, scanPrefix: SOAP_ROOM_SCAN_PREFIX };
  }

  const planned = soapRoomBinRows();
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
    `Soap Room (${wh.code}): ${planned.length} bins planned, ${existing.length} already exist, ${toCreate.length} to create`
  );

  if (dryRun) {
    for (const r of toCreate.slice(0, 5)) {
      console.log(`  would create ${r.zone}/${r.shelf}/${r.bin}`);
    }
    if (toCreate.length > 5) console.log(`  … and ${toCreate.length - 5} more`);
    const sample = binCodeFromRow(
      { zone: "A", shelf: "S05", bin: "11" },
      { code: wh.code, scanPrefix: SOAP_ROOM_SCAN_PREFIX }
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

  // Refresh compact scan codes on all soap-room bins.
  if (!dryRun) {
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
      console.log(`Refreshed ${refreshed} bin scan codes → ${SOAP_ROOM_SCAN_PREFIX}.<zone><shelf>.<bin>`);
    }
  }

  console.log(`\nExample: ${binCodeFromRow({ zone: "A", shelf: "S05", bin: "11" }, { code: wh.code, scanPrefix: wh.scanPrefix })}`);
  console.log("Generate labels: npm run labels:soap-room");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
