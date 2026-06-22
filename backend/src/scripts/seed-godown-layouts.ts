#!/usr/bin/env tsx
/**
 * Create / update godown warehouses and seed one bin per shelf (bin 01).
 *
 *   npm run db:seed-godowns:dev
 *   npm run db:seed-godowns:dev -- --dry-run
 */

import { PrismaClient } from "@prisma/client";
import { binCodeFromRow } from "../lib/codes.js";
import {
  GODOWN_LAYOUTS,
  shelfBinRows,
  type GodownLayout,
} from "../lib/godown-layouts.js";

const dryRun = process.argv.includes("--dry-run");
const db = new PrismaClient();

async function resolveWarehouse(layout: GodownLayout) {
  let wh = await db.warehouse.findUnique({ where: { code: layout.code } });

  if (!wh) {
    if (dryRun) {
      console.log(
        `[DRY RUN] Would create ${layout.code} ("${layout.name}") scanPrefix=${layout.scanPrefix}`
      );
      return {
        id: "dry-run",
        code: layout.code,
        name: layout.name,
        scanPrefix: layout.scanPrefix,
      };
    }
    wh = await db.warehouse.create({
      data: {
        code: layout.code,
        name: layout.name,
        city: "Kothavaripalle, AP",
        scanPrefix: layout.scanPrefix,
        kind: layout.kind,
        active: true,
      },
    });
    console.log(`Created warehouse ${wh.code} ("${layout.name}")`);
  } else {
    const needsMeta =
      wh.name !== layout.name ||
      wh.scanPrefix !== layout.scanPrefix ||
      wh.kind !== layout.kind;
    if (needsMeta && !dryRun) {
      wh = await db.warehouse.update({
        where: { id: wh.id },
        data: {
          name: layout.name,
          scanPrefix: layout.scanPrefix,
          kind: layout.kind,
        },
      });
      console.log(`Updated warehouse ${wh.code} metadata`);
    }
  }

  return wh;
}

async function seedLayout(layout: GodownLayout) {
  const wh = await resolveWarehouse(layout);
  if (dryRun && wh.id === "dry-run") {
    const planned = shelfBinRows(layout.zones);
    console.log(
      `[DRY RUN] ${layout.code}: ${planned.length} shelf bins`,
      layout.zones.map((z) => `${z.zone}=${z.shelfCount}`).join(", ")
    );
    return;
  }

  const planned = shelfBinRows(layout.zones);
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
    `${layout.code}: ${planned.length} shelves planned,`,
    `${existing.length} in DB, ${toCreate.length} to create`,
    `(${layout.zones.map((z) => `zone ${z.zone}×${z.shelfCount}`).join(", ")})`
  );

  if (dryRun) return;

  if (toCreate.length > 0) {
    await db.bin.createMany({
      data: toCreate.map((r) => ({
        warehouseId: wh.id,
        zone: r.zone,
        shelf: r.shelf,
        bin: r.bin,
        code: binCodeFromRow(r, { code: wh.code, scanPrefix: wh.scanPrefix }),
        qty: 0,
        reservedQty: 0,
        capacity: 9999,
      })),
    });
    console.log(`  Created ${toCreate.length} bins.`);
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
    console.log(`  Refreshed ${refreshed} scan codes.`);
  }

  const sample = planned[0];
  if (sample) {
    console.log(
      `  Example: ${binCodeFromRow(sample, { code: wh.code, scanPrefix: wh.scanPrefix })}`
    );
  }
}

async function main() {
  for (const layout of GODOWN_LAYOUTS) {
    await seedLayout(layout);
  }
  console.log("\nDone. Generate labels: npm run labels:godowns");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
