#!/usr/bin/env tsx
/**
 * Assign scan prefixes to remaining warehouses, deactivate demo WH-MAIN,
 * and backfill all Bin.code values to compact format.
 *
 *   npx tsx scripts/purge-legacy-bin-codes.ts
 */
import { PrismaClient } from "@prisma/client";
import { binCodeFromRow } from "../src/lib/codes.js";

const db = new PrismaClient();

/** Warehouses that should use compact scan codes (2–4 char prefix). */
const SCAN_PREFIX_BY_WH: Record<string, string> = {
  "WH-PROD-FLOUR": "PFL",
  "WH-PROD-MILL": "PML",
  "WH-PROD-OIL": "POL",
  "WH-PROD-SNACKS": "PSK",
  "WH-STO-COLD-1": "CL1",
  "WH-STO-COLD-2": "CL2",
  "WH-STO-FILTERMAT": "FMT",
  "WH-STO-GROUNDNUT": "GNT",
  "WH-STO-OILSEEDS": "OSD",
};

const isLegacy = (code: string | null) =>
  !!code && (code.startsWith("B.") || code.startsWith("S.") || code.startsWith("Z."));

(async () => {
  const mainWh = await db.warehouse.findUnique({ where: { code: "WH-MAIN" } });
  if (mainWh) {
    if (mainWh.active) {
      await db.warehouse.update({
        where: { id: mainWh.id },
        data: { active: false },
      });
      console.log("Deactivated demo warehouse WH-MAIN");
    }
    const removed = await db.bin.deleteMany({ where: { warehouseId: mainWh.id } });
    if (removed.count) {
      console.log(`Removed ${removed.count} demo bin row(s) from WH-MAIN`);
    }
  }

  for (const [code, scanPrefix] of Object.entries(SCAN_PREFIX_BY_WH)) {
    const wh = await db.warehouse.findUnique({ where: { code } });
    if (!wh) {
      console.warn(`SKIP prefix: warehouse ${code} not found`);
      continue;
    }
    if (wh.scanPrefix === scanPrefix) continue;
    await db.warehouse.update({
      where: { id: wh.id },
      data: { scanPrefix },
    });
    console.log(`Set scanPrefix=${scanPrefix} on ${code}`);
  }

  const warehouses = await db.warehouse.findMany({
    select: { id: true, code: true, scanPrefix: true },
  });
  const whById = new Map(warehouses.map((w) => [w.id, w]));
  const bins = await db.bin.findMany({
    select: {
      id: true,
      warehouseId: true,
      zone: true,
      shelf: true,
      bin: true,
      code: true,
    },
  });

  let updated = 0;
  let skipped = 0;
  for (const b of bins) {
    const wh = whById.get(b.warehouseId);
    if (!wh?.scanPrefix) {
      skipped += 1;
      continue;
    }
    const target = binCodeFromRow(b, wh);
    if (b.code === target) {
      skipped += 1;
      continue;
    }
    await db.bin.update({ where: { id: b.id }, data: { code: target } });
    updated += 1;
  }

  const remaining = await db.bin.findMany({
    select: { code: true },
    where: { code: { not: null } },
  });
  const legacy = remaining.filter((b) => isLegacy(b.code));

  console.log(
    `Backfill done. updated=${updated} skipped=${skipped} total=${bins.length}`
  );
  console.log(`Legacy B./S./Z. bin codes remaining: ${legacy.length}`);
  if (legacy.length) {
    console.log("Sample:", legacy.slice(0, 5).map((b) => b.code));
  }

  await db.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
