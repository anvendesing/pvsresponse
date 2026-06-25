#!/usr/bin/env tsx
/**
 * Clear all bin stock and ledger history from Cold Storage warehouses.
 *
 *   npx tsx scripts/clear-cold-storage-stock.ts --dry-run
 *   npx tsx scripts/clear-cold-storage-stock.ts --apply
 */
import { db } from "../src/db.js";

const WAREHOUSE_CODES = ["WH-STO-COLD-1", "WH-STO-COLD-2"] as const;
const apply = process.argv.includes("--apply");

async function recomputeCountersFromBins(): Promise<void> {
  console.log("\nRecomputing stockOnHand from remaining bins…");

  for (const v of await db.productVariant.findMany({ select: { id: true, sku: true, stockOnHand: true } })) {
    const binTotal = Math.round(
      (await db.bin.aggregate({ where: { variantId: v.id }, _sum: { qty: true } }))._sum.qty ?? 0
    );
    if (binTotal !== v.stockOnHand) {
      await db.productVariant.update({ where: { id: v.id }, data: { stockOnHand: binTotal } });
      console.log(`  variant ${v.sku.padEnd(28)} ${v.stockOnHand} → ${binTotal}`);
    }
  }

  for (const p of await db.product.findMany({
    select: { id: true, sku: true, stockOnHand: true, _count: { select: { variants: true } } },
  })) {
    const binTotal = Math.round(
      (
        await db.bin.aggregate({
          where: p._count.variants > 0
            ? { productId: p.id, variantId: null }
            : { productId: p.id },
          _sum: { qty: true },
        })
      )._sum.qty ?? 0
    );
    if (binTotal !== p.stockOnHand) {
      await db.product.update({ where: { id: p.id }, data: { stockOnHand: binTotal } });
      console.log(`  product ${p.sku.padEnd(28)} ${p.stockOnHand} → ${binTotal}`);
    }
  }
}

async function clearWarehouse(code: string): Promise<void> {
  const wh = await db.warehouse.findUnique({
    where: { code },
    include: { _count: { select: { bins: true, ledger: true } } },
  });
  if (!wh) {
    console.log(`  ${code}: not found — skipped`);
    return;
  }

  const before = await db.bin.aggregate({
    where: { warehouseId: wh.id },
    _sum: { qty: true, reservedQty: true },
  });

  console.log(
    `\n${code} (${wh.name}): ${wh._count.bins} bin(s), ${wh._count.ledger} ledger row(s), qty=${before._sum.qty ?? 0}`
  );

  if (!apply) return;

  const binIds = (
    await db.bin.findMany({ where: { warehouseId: wh.id }, select: { id: true } })
  ).map((b) => b.id);

  await db.$transaction(async (tx) => {
    if (binIds.length > 0) {
      await tx.stockRule.deleteMany({
        where: {
          OR: [
            { monitorBinId: { in: binIds } },
            { sourceBinId: { in: binIds } },
            { toBinId: { in: binIds } },
          ],
        },
      });
      await tx.putawayRule.updateMany({
        where: { toBinId: { in: binIds } },
        data: { toBinId: null },
      });
      await tx.pickListItem.updateMany({
        where: { binId: { in: binIds } },
        data: { binId: null },
      });
      await tx.salesOrderReservation.deleteMany({ where: { binId: { in: binIds } } });
      await tx.binCount.deleteMany({ where: { binId: { in: binIds } } });
    }

    await tx.stockLot.deleteMany({ where: { warehouseId: wh.id } });
    await tx.stockLedger.deleteMany({ where: { warehouseId: wh.id } });

    const cleared = await tx.bin.updateMany({
      where: { warehouseId: wh.id },
      data: {
        qty: 0,
        reservedQty: 0,
        occupied: 0,
        productId: null,
        variantId: null,
        batch: null,
      },
    });
    console.log(`  ✓ cleared ${cleared.count} bin(s), removed ledger/lots`);
  });
}

async function main() {
  console.log(
    apply
      ? "Clearing Cold Storage 1 & 2…\n"
      : "DRY RUN — Cold Storage 1 & 2 cleanup\n"
  );

  for (const code of WAREHOUSE_CODES) {
    await clearWarehouse(code);
  }

  if (apply) {
    await recomputeCountersFromBins();
    console.log("\nDone.");
  } else {
    console.log("\nRe-run with --apply to commit.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
