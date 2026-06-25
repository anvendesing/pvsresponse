#!/usr/bin/env tsx
/**
 * Remove legacy test seed stock (qty 999) and stuck orphan bins.
 *
 * Typical leftovers from db:reset-test-env:
 *   • Bins still holding qty 999 (often STR zone D overflow slots)
 *   • Variant counters stuck at 999 with no matching bin
 *   • Zone D bins in STR — not in the official layout (reserved / empty)
 *
 * After cleanup, recomputes variant + parent stockOnHand from remaining bins.
 *
 *   npx tsx scripts/clear-legacy-999-stock.ts           # dry run
 *   npx tsx scripts/clear-legacy-999-stock.ts --apply
 */
import { db } from "../src/db.js";
import { STOCK_ROOM_WAREHOUSE_CODE } from "../src/lib/stock-room-layout.js";

const apply = process.argv.includes("--apply");
const LEGACY_QTY = 999;

async function clearLegacy999Bins(): Promise<number> {
  const bins = await db.bin.findMany({
    where: { qty: LEGACY_QTY },
    select: {
      id: true,
      zone: true,
      shelf: true,
      bin: true,
      warehouse: { select: { code: true } },
      product: { select: { sku: true } },
      variant: { select: { sku: true } },
    },
  });
  if (bins.length === 0) return 0;

  console.log(`\nBins with qty=${LEGACY_QTY}: ${bins.length}`);
  for (const b of bins.slice(0, 8)) {
    console.log(
      `  ${b.warehouse.code} ${b.zone}/${b.shelf}/${b.bin} · ${b.variant?.sku ?? b.product?.sku ?? "—"}`
    );
  }
  if (bins.length > 8) console.log(`  … and ${bins.length - 8} more`);

  if (!apply) return bins.length;

  const cleared = await db.bin.updateMany({
    where: { qty: LEGACY_QTY },
    data: {
      qty: 0,
      reservedQty: 0,
      occupied: 0,
      productId: null,
      variantId: null,
    },
  });
  console.log(`  ✓ cleared ${cleared.count} bin(s)`);
  return cleared.count;
}

async function deleteStuckStrZoneDBins(): Promise<number> {
  const str = await db.warehouse.findUnique({
    where: { code: STOCK_ROOM_WAREHOUSE_CODE },
    select: { id: true },
  });
  if (!str) return 0;

  const bins = await db.bin.findMany({
    where: { warehouseId: str.id, zone: "D" },
    select: {
      id: true,
      shelf: true,
      bin: true,
      qty: true,
      reservedQty: true,
      product: { select: { sku: true } },
      variant: { select: { sku: true } },
    },
  });
  if (bins.length === 0) return 0;

  console.log(`\nSTR zone D bins (not in official layout): ${bins.length}`);
  for (const b of bins.slice(0, 8)) {
    console.log(
      `  D/${b.shelf}/${b.bin} qty=${b.qty} · ${b.variant?.sku ?? b.product?.sku ?? "empty"}`
    );
  }
  if (bins.length > 8) console.log(`  … and ${bins.length - 8} more`);

  if (!apply) return bins.length;

  const binIds = bins.map((b) => b.id);
  await db.$transaction(async (tx) => {
    const stockRules = await tx.stockRule.findMany({
      where: {
        OR: [
          { monitorBinId: { in: binIds } },
          { sourceBinId: { in: binIds } },
          { toBinId: { in: binIds } },
        ],
      },
      select: { id: true },
    });
    if (stockRules.length > 0) {
      await tx.stockRule.deleteMany({
        where: { id: { in: stockRules.map((r) => r.id) } },
      });
      console.log(`  ✓ removed ${stockRules.length} stock rule(s) on zone D bins`);
    }

    await tx.putawayRule.updateMany({
      where: { toBinId: { in: binIds } },
      data: { toBinId: null },
    });
    await tx.salesOrderReservation.deleteMany({ where: { binId: { in: binIds } } });
    await tx.binCount.deleteMany({ where: { binId: { in: binIds } } });

    const deleted = await tx.bin.deleteMany({ where: { id: { in: binIds } } });
    console.log(`  ✓ deleted ${deleted.count} zone D bin(s)`);
  });
  return bins.length;
}

async function deleteTestZoneBins(): Promise<number> {
  const bins = await db.bin.findMany({
    where: { zone: "TEST" },
    select: { id: true, shelf: true, bin: true, warehouse: { select: { code: true } }, qty: true },
  });
  if (bins.length === 0) return 0;

  console.log(`\nTEST zone bins: ${bins.length}`);
  if (!apply) return bins.length;

  const binIds = bins.map((b) => b.id);
  await db.$transaction(async (tx) => {
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
    await tx.salesOrderReservation.deleteMany({ where: { binId: { in: binIds } } });
    await tx.binCount.deleteMany({ where: { binId: { in: binIds } } });
    const deleted = await tx.bin.deleteMany({ where: { id: { in: binIds } } });
    console.log(`  ✓ deleted ${deleted.count} TEST zone bin(s)`);
  });
  return bins.length;
}

async function recomputeCountersFromBins(): Promise<{ variants: number; products: number }> {
  let variantsUpdated = 0;
  let productsUpdated = 0;

  const variants = await db.productVariant.findMany({
    select: { id: true, sku: true, stockOnHand: true },
  });

  for (const v of variants) {
    const agg = await db.bin.aggregate({
      where: { variantId: v.id },
      _sum: { qty: true },
    });
    const binTotal = Math.round(agg._sum.qty ?? 0);
    if (binTotal === v.stockOnHand) continue;

    if (apply) {
      await db.productVariant.update({
        where: { id: v.id },
        data: { stockOnHand: binTotal },
      });
    }
    if (variantsUpdated < 12 || v.stockOnHand === LEGACY_QTY) {
      console.log(`  variant ${v.sku.padEnd(28)} ${v.stockOnHand} → ${binTotal}`);
    }
    variantsUpdated++;
  }
  if (variantsUpdated > 12) {
    console.log(`  … ${variantsUpdated} variant counter(s) adjusted`);
  }

  const products = await db.product.findMany({
    select: {
      id: true,
      sku: true,
      stockOnHand: true,
      _count: { select: { variants: true } },
    },
  });

  for (const p of products) {
    const hasVariants = p._count.variants > 0;
    const agg = await db.bin.aggregate({
      where: hasVariants
        ? { productId: p.id, variantId: null }
        : { productId: p.id },
      _sum: { qty: true },
    });
    const binTotal = Math.round(agg._sum.qty ?? 0);
    if (binTotal === p.stockOnHand) continue;

    if (apply) {
      await db.product.update({
        where: { id: p.id },
        data: { stockOnHand: binTotal },
      });
    }
    if (productsUpdated < 12 || p.stockOnHand === LEGACY_QTY) {
      console.log(`  product ${p.sku.padEnd(28)} ${p.stockOnHand} → ${binTotal}`);
    }
    productsUpdated++;
  }
  if (productsUpdated > 12) {
    console.log(`  … ${productsUpdated} product counter(s) adjusted`);
  }

  return { variants: variantsUpdated, products: productsUpdated };
}

async function clearTestOpenLedger(): Promise<number> {
  const count = await db.stockLedger.count({
    where: { ref: { startsWith: "TEST-OPEN-" } },
  });
  if (count === 0) return 0;
  console.log(`\nTEST-OPEN ledger rows: ${count}`);
  if (apply) {
    const removed = await db.stockLedger.deleteMany({
      where: { ref: { startsWith: "TEST-OPEN-" } },
    });
    console.log(`  ✓ deleted ${removed.count} ledger row(s)`);
  }
  return count;
}

async function main() {
  console.log(apply ? "Clearing legacy 999 stock…\n" : "DRY RUN — legacy 999 stock cleanup\n");

  const before = {
    bins999: await db.bin.count({ where: { qty: LEGACY_QTY } }),
    variants999: await db.productVariant.count({ where: { stockOnHand: LEGACY_QTY } }),
    products999: await db.product.count({ where: { stockOnHand: LEGACY_QTY } }),
    zoneD: await db.bin.count({
      where: { zone: "D", warehouse: { code: STOCK_ROOM_WAREHOUSE_CODE } },
    }),
  };
  console.log("Before:", before);

  await clearLegacy999Bins();
  await deleteStuckStrZoneDBins();
  await deleteTestZoneBins();
  await clearTestOpenLedger();

  console.log("\nRecomputing stockOnHand from remaining bins…");
  const recompute = await recomputeCountersFromBins();

  const after = {
    bins999: await db.bin.count({ where: { qty: LEGACY_QTY } }),
    variants999: await db.productVariant.count({ where: { stockOnHand: LEGACY_QTY } }),
    products999: await db.product.count({ where: { stockOnHand: LEGACY_QTY } }),
    zoneD: await db.bin.count({
      where: { zone: "D", warehouse: { code: STOCK_ROOM_WAREHOUSE_CODE } },
    }),
  };
  console.log("\nAfter:", after);
  console.log(
    `\nCounters to adjust: variants=${recompute.variants} products=${recompute.products}` +
      (apply ? "" : "\nRe-run with --apply to commit.")
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
