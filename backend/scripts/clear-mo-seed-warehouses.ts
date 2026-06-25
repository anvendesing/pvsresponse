#!/usr/bin/env tsx
/**
 * Remove godown-MO seed layout (≈627 products × 1234 qty, ~627–628 bin slots).
 * Clears stock/ledger and deletes the seed bin records (not just zeroes qty).
 *
 * Matches warehouses with ~620–660 total bins, ~620–660 stocked bins, or ≥500 @ qty 1234.
 *
 *   npx tsx scripts/clear-mo-seed-warehouses.ts --dry-run
 *   npx tsx scripts/clear-mo-seed-warehouses.ts --apply
 */
import { db } from "../src/db.js";

const apply = process.argv.includes("--apply");

async function findSeedWarehouses() {
  const warehouses = await db.warehouse.findMany({
    where: { active: true },
    orderBy: { code: "asc" },
    include: { _count: { select: { bins: true } } },
  });

  const matches: Array<{ id: string; code: string; name: string; bins: number; stocked: number; qty1234: number }> = [];

  for (const wh of warehouses) {
    const stocked = await db.bin.count({
      where: {
        warehouseId: wh.id,
        OR: [{ qty: { gt: 0 } }, { productId: { not: null } }],
      },
    });
    const qty1234 = await db.bin.count({ where: { warehouseId: wh.id, qty: 1234 } });

    const seedBinCount = wh._count.bins >= 620 && wh._count.bins <= 660;
    const seedStocked = stocked >= 620 && stocked <= 660;
    const seedQty = qty1234 >= 500;

    if (seedBinCount || seedStocked || seedQty) {
      matches.push({
        id: wh.id,
        code: wh.code,
        name: wh.name,
        bins: wh._count.bins,
        stocked,
        qty1234,
      });
    }
  }
  return matches;
}

async function recomputeCountersFromBins(): Promise<void> {
  console.log("\nRecomputing stockOnHand from remaining bins…");
  let vCount = 0;
  let pCount = 0;

  for (const v of await db.productVariant.findMany({ select: { id: true, sku: true, stockOnHand: true } })) {
    const binTotal = Math.round(
      (await db.bin.aggregate({ where: { variantId: v.id }, _sum: { qty: true } }))._sum.qty ?? 0
    );
    if (binTotal !== v.stockOnHand) {
      if (apply) {
        await db.productVariant.update({ where: { id: v.id }, data: { stockOnHand: binTotal } });
      }
      vCount++;
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
      if (apply) {
        await db.product.update({ where: { id: p.id }, data: { stockOnHand: binTotal } });
      }
      pCount++;
    }
  }
  console.log(`  ${vCount} variant(s), ${pCount} product(s) adjusted`);
}

async function clearWarehouse(wh: { id: string; code: string; name: string; bins: number; stocked: number; qty1234: number }) {
  const ledger = await db.stockLedger.count({ where: { warehouseId: wh.id } });
  const qtySum = (
    await db.bin.aggregate({ where: { warehouseId: wh.id }, _sum: { qty: true } })
  )._sum.qty;

  console.log(
    `\n${wh.code} (${wh.name}): ${wh.bins} bin(s), stocked=${wh.stocked}, qty1234=${wh.qty1234}, ledger=${ledger}, qtySum=${qtySum ?? 0}`
  );

  if (!apply) return;

  const binIds = (
    await db.bin.findMany({ where: { warehouseId: wh.id }, select: { id: true } })
  ).map((b) => b.id);

  await db.$transaction(async (tx) => {
    if (binIds.length > 0) {
      const putawayRules = await tx.putawayRule.findMany({
        where: { toBinId: { in: binIds } },
        select: { id: true },
      });
      if (putawayRules.length > 0) {
        await tx.putawayRule.deleteMany({
          where: { id: { in: putawayRules.map((r) => r.id) } },
        });
      }

      await tx.stockRule.deleteMany({
        where: {
          OR: [
            { monitorBinId: { in: binIds } },
            { sourceBinId: { in: binIds } },
            { toBinId: { in: binIds } },
          ],
        },
      });
      await tx.pickListItem.updateMany({
        where: { binId: { in: binIds } },
        data: { binId: null },
      });
      await tx.transferOrderItem.updateMany({
        where: { fromBinId: { in: binIds } },
        data: { fromBinId: null },
      });
      await tx.transferOrderItem.updateMany({
        where: { toBinId: { in: binIds } },
        data: { toBinId: null },
      });
      await tx.salesOrderReservation.deleteMany({ where: { binId: { in: binIds } } });
      await tx.binCount.deleteMany({ where: { binId: { in: binIds } } });
    }

    await tx.stockLot.deleteMany({ where: { warehouseId: wh.id } });
    await tx.stockLedger.deleteMany({ where: { warehouseId: wh.id } });

    const deleted = await tx.bin.deleteMany({ where: { warehouseId: wh.id } });
    console.log(`  ✓ deleted ${deleted.count} bin(s)`);
  });
}

async function main() {
  const matches = await findSeedWarehouses();
  console.log(
    apply
      ? `Removing MO seed bins from ${matches.length} warehouse(s)…\n`
      : `DRY RUN — ${matches.length} warehouse(s) with MO seed bin layout\n`
  );

  if (matches.length === 0) {
    console.log("Nothing to clear.");
    return;
  }

  for (const wh of matches) {
    await clearWarehouse(wh);
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
