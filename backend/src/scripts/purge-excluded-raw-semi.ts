#!/usr/bin/env tsx
/**
 * Remove auto-generated raw/semi products for flour, oils, snacks, and soap lines.
 *
 *   npm run db:purge-excluded-raw-semi:dev
 *   npm run db:purge-excluded-raw-semi:dev -- --dry-run
 */
import { PrismaClient } from "@prisma/client";
import { shouldPurgeRawSemiProduct } from "../lib/raw-semi-exclusions.js";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

async function deleteBom(bomId: string) {
  const moCount = await db.productionOrder.count({ where: { bomId } });
  if (moCount > 0) {
    throw new Error(`BOM has ${moCount} production order(s)`);
  }
  await db.stockRule.deleteMany({ where: { bomId } });
  await db.bomOperationLine.deleteMany({ where: { bomOperation: { bomId } } });
  await db.bomOperation.deleteMany({ where: { bomId } });
  await db.bomItem.deleteMany({ where: { bomId } });
  await db.bomByproduct.deleteMany({ where: { bomId } });
  await db.bom.delete({ where: { id: bomId } });
}

async function purgeProduct(productId: string, sku: string) {
  const [
    stockedBins,
    ledger,
    stockLots,
    poItems,
    bomItemsAsComponent,
    bomByproductsAsOutput,
  ] = await Promise.all([
    db.bin.count({ where: { productId, qty: { gt: 0 } } }),
    db.stockLedger.count({ where: { productId } }),
    db.stockLot.count({ where: { productId } }),
    db.purchaseOrderItem.count({ where: { productId } }),
    db.bomItem.count({ where: { productId } }),
    db.bomByproduct.count({ where: { productId } }),
  ]);

  const blockers: string[] = [];
  if (stockedBins > 0) blockers.push(`${stockedBins} stocked bin(s)`);
  if (ledger > 0) blockers.push(`${ledger} ledger row(s)`);
  if (stockLots > 0) blockers.push(`${stockLots} stock lot(s)`);
  if (poItems > 0) blockers.push(`${poItems} PO line(s)`);
  if (bomItemsAsComponent > 0) blockers.push(`${bomItemsAsComponent} BOM component row(s)`);
  if (bomByproductsAsOutput > 0) blockers.push(`${bomByproductsAsOutput} BOM byproduct row(s)`);

  if (blockers.length > 0) {
    throw new Error(blockers.join(", "));
  }

  if (dryRun) {
    const boms = await db.bom.count({ where: { productId } });
    console.log(`  [dry] delete ${sku} (${boms} BOM(s))`);
    return;
  }

  await db.putawayRule.deleteMany({ where: { productId } });
  await db.stockRule.deleteMany({ where: { productId } });
  await db.vendorProduct.deleteMany({ where: { productId } });
  await db.bin.updateMany({
    where: { productId },
    data: { productId: null, variantId: null, qty: 0 },
  });

  const boms = await db.bom.findMany({ where: { productId }, select: { id: true } });
  for (const bom of boms) await deleteBom(bom.id);

  await db.product.delete({ where: { id: productId } });
  console.log(`  ✓ deleted ${sku}`);
}

async function main() {
  console.log(dryRun ? "DRY RUN — purge excluded raw/semi\n" : "Purging excluded raw/semi products…\n");

  const allProducts = await db.product.findMany({
    select: {
      id: true,
      sku: true,
      name: true,
      type: true,
      tags: true,
      category: { select: { slug: true } },
    },
  });

  const sourceBySku = new Map(
    allProducts.map((p) => [
      p.sku.trim().toUpperCase(),
      {
        sku: p.sku,
        name: p.name,
        type: p.type,
        categorySlug: p.category?.slug ?? null,
      },
    ])
  );

  const candidates = allProducts.filter((p) =>
    shouldPurgeRawSemiProduct(
      {
        sku: p.sku,
        name: p.name,
        type: p.type,
        tags: p.tags,
        categorySlug: p.category?.slug ?? null,
      },
      sourceBySku
    )
  );

  console.log(`Candidates: ${candidates.length}\n`);

  let deleted = 0;
  let skipped = 0;

  for (const p of candidates.sort((a, b) => a.sku.localeCompare(b.sku))) {
    try {
      await purgeProduct(p.id, p.sku);
      deleted += 1;
    } catch (e) {
      skipped += 1;
      console.warn(`  ⚠ skip ${p.sku}: ${(e as Error).message}`);
    }
  }

  console.log(`\n${dryRun ? "[DRY RUN] " : ""}Done: ${deleted} purged, ${skipped} skipped.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
