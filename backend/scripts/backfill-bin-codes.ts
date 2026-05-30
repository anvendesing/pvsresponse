// One-shot backfill that materialises Bin.code on every existing
// Bin row. Idempotent: rows that already have a code matching the
// canonical encoder are skipped, anything else gets rewritten.
//
// Run:  npx tsx scripts/backfill-bin-codes.ts
//
// Output is concise per-row so a stuck bin (e.g. a Warehouse with
// missing code) is easy to spot in the log.

import { PrismaClient } from "@prisma/client";
import { binCodeFromRow } from "../src/lib/codes.js";

const db = new PrismaClient();

(async () => {
  const warehouses = await db.warehouse.findMany();
  const whByCode = new Map(warehouses.map((w) => [w.id, w.code]));
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
  let failed = 0;
  for (const b of bins) {
    const whCode = whByCode.get(b.warehouseId);
    if (!whCode) {
      console.warn(`SKIP ${b.id}: warehouse ${b.warehouseId} has no code`);
      failed += 1;
      continue;
    }
    let target: string;
    try {
      target = binCodeFromRow(b, whCode);
    } catch (e) {
      console.warn(`SKIP ${b.id}: encode failed - ${(e as Error).message}`);
      failed += 1;
      continue;
    }
    if (b.code === target) {
      skipped += 1;
      continue;
    }
    try {
      await db.bin.update({ where: { id: b.id }, data: { code: target } });
      updated += 1;
    } catch (e) {
      console.warn(`SKIP ${b.id}: update failed - ${(e as Error).message}`);
      failed += 1;
    }
  }
  console.log(
    `done. updated=${updated} skipped=${skipped} failed=${failed} total=${bins.length}`
  );
  await db.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
