#!/usr/bin/env tsx
/**
 * Create StockLot rows from existing Bin stock that has no lot record yet.
 * Run once after deploying lot tracking so MO FIFO issue can consume pre-existing stock.
 *
 *   npm run db:backfill-lots-from-bins:dev
 *   npm run db:backfill-lots-from-bins        (container / dist)
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const bins = await db.bin.findMany({
    where: { qty: { gt: 0 }, productId: { not: null } },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
  });

  let created = 0;
  let skipped = 0;

  for (const bin of bins) {
    if (!bin.productId) continue;
    const lotHeld = await db.stockLot.aggregate({
      where: { binId: bin.id, qtyOnHand: { gt: 0 } },
      _sum: { qtyOnHand: true },
    });
    const tracked = lotHeld._sum.qtyOnHand ?? 0;
    const legacyQty = bin.qty - tracked;
    if (legacyQty <= 0) {
      skipped++;
      continue;
    }

    const batchNo =
      bin.batch?.trim() ||
      `LEGACY-${bin.warehouseId.slice(-4)}-${bin.zone}${bin.shelf}${bin.bin}`;

    await db.stockLot.create({
      data: {
        productId: bin.productId,
        variantId: bin.variantId,
        batchNo: batchNo.slice(0, 60),
        sourceType: "adjustment",
        sourceRef: "BACKFILL-BINS",
        receivedAt: bin.updatedAt,
        qtyOnHand: legacyQty,
        warehouseId: bin.warehouseId,
        binId: bin.id,
      },
    });
    if (!bin.batch) {
      await db.bin.update({ where: { id: bin.id }, data: { batch: batchNo.slice(0, 60) } });
    }
    created++;
  }

  console.log(`Backfill complete: ${created} lots created, ${skipped} bins skipped.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
