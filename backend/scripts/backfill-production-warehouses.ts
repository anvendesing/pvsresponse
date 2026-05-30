#!/usr/bin/env tsx
// backfill-production-warehouses.ts
//
// Idempotent script that ensures every active WorkCenter has a dedicated
// production-line warehouse.  Run once (or as many times as needed -
// already-linked WCs are skipped).
//
// Usage:
//   npx tsx scripts/backfill-production-warehouses.ts
//
// What it does:
//   1. Loads every active WorkCenter.
//   2. For each WC without a productionLineWarehouseId:
//      a. Creates a Warehouse with kind="production" and
//         code=WH-PROD-<wcCode>, city="Production".
//      b. Creates a single Bin (zone=PROD, rack=01, shelf=01, bin=01)
//         inside it so stock can be landed immediately.
//      c. Links the WC -> Warehouse.
//   3. Reports a summary.

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const slugify = (s: string) =>
  s.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");

async function main() {
  const workCenters = await db.workCenter.findMany({
    where: { active: true },
    include: {
      productionLineWarehouse: { select: { id: true, code: true } },
    },
    orderBy: { code: "asc" },
  });

  console.log(`Found ${workCenters.length} active work centers.`);

  let created = 0;
  let skipped = 0;

  for (const wc of workCenters) {
    if (wc.productionLineWarehouseId) {
      console.log(
        `  SKIP  ${wc.code} — already linked to ${wc.productionLineWarehouse?.code}`
      );
      skipped++;
      continue;
    }

    const whCode = `WH-PROD-${slugify(wc.code)}`;

    // Check if a warehouse with this code already exists (from a previous
    // partial run where the WC link wasn't written).
    let wh = await db.warehouse.findUnique({ where: { code: whCode } });

    if (!wh) {
      wh = await db.warehouse.create({
        data: {
          code: whCode,
          name: `Production line — ${wc.name}`,
          city: "Production",
          kind: "production",
          active: true,
        },
      });
      console.log(`  CREATE warehouse ${wh.code} (id=${wh.id})`);
    } else {
      console.log(`  FOUND existing warehouse ${wh.code} (id=${wh.id})`);
    }

    // Ensure there is at least one bin.
    const existingBin = await db.bin.findFirst({
      where: { warehouseId: wh.id },
    });
    if (!existingBin) {
      const bin = await db.bin.create({
        data: {
          warehouseId: wh.id,
          zone: "PROD",
          rack: "01",
          shelf: "01",
          bin: "01",
          qty: 0,
          reservedQty: 0,
          capacity: 9999,
        },
      });
      console.log(`         + bin ${bin.zone}/${bin.rack}/${bin.shelf}/${bin.bin}`);
    }

    // Link the WC.
    await db.workCenter.update({
      where: { id: wc.id },
      data: { productionLineWarehouseId: wh.id },
    });

    console.log(`  LINK  WC ${wc.code} -> ${wh.code}`);
    created++;
  }

  console.log(`\nDone. Created/linked: ${created}  Skipped: ${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
