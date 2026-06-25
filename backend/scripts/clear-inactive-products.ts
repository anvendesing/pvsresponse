#!/usr/bin/env tsx
/**
 * Hard-delete products with state = inactive after clearing safe dependents.
 *
 *   npx tsx scripts/clear-inactive-products.ts          # dry run
 *   npx tsx scripts/clear-inactive-products.ts --apply  # delete
 */
import { db } from "../src/db.js";

const apply = process.argv.includes("--apply");

async function deleteBom(bomId: string) {
  const moCount = await db.productionOrder.count({ where: { bomId } });
  if (moCount > 0) {
    throw new Error(`BOM ${bomId} has ${moCount} production order(s)`);
  }
  await db.stockRule.deleteMany({ where: { bomId } });
  await db.bomOperationLine.deleteMany({ where: { bomOperation: { bomId } } });
  await db.bomOperation.deleteMany({ where: { bomId } });
  await db.bomItem.deleteMany({ where: { bomId } });
  await db.bomByproduct.deleteMany({ where: { bomId } });
  await db.bom.delete({ where: { id: bomId } });
}

async function assertDeletable(productId: string, sku: string) {
  const [
    bins,
    ledger,
    stockLots,
    poItems,
    invoiceItems,
    quoteItems,
    salesOrderItems,
    transferItems,
    bomItemsAsComponent,
    bomByproductsAsOutput,
  ] = await Promise.all([
    db.bin.count({ where: { productId, qty: { gt: 0 } } }),
    db.stockLedger.count({ where: { productId } }),
    db.stockLot.count({ where: { productId } }),
    db.purchaseOrderItem.count({ where: { productId } }),
    db.invoiceItem.count({ where: { productId } }),
    db.quoteItem.count({ where: { productId } }),
    db.salesOrderItem.count({ where: { productId } }),
    db.transferOrderItem.count({ where: { productId } }),
    db.bomItem.count({ where: { productId } }),
    db.bomByproduct.count({ where: { productId } }),
  ]);

  const blockers: string[] = [];
  if (bins > 0) blockers.push(`${bins} stocked bin(s)`);
  if (ledger > 0) blockers.push(`${ledger} ledger row(s)`);
  if (stockLots > 0) blockers.push(`${stockLots} stock lot(s)`);
  if (poItems > 0) blockers.push(`${poItems} PO line(s)`);
  if (invoiceItems > 0) blockers.push(`${invoiceItems} invoice line(s)`);
  if (quoteItems > 0) blockers.push(`${quoteItems} quote line(s)`);
  if (salesOrderItems > 0) blockers.push(`${salesOrderItems} sales order line(s)`);
  if (transferItems > 0) blockers.push(`${transferItems} transfer line(s)`);
  if (bomItemsAsComponent > 0) blockers.push(`${bomItemsAsComponent} BOM component row(s)`);
  if (bomByproductsAsOutput > 0) blockers.push(`${bomByproductsAsOutput} BOM byproduct row(s)`);

  if (blockers.length > 0) {
    throw new Error(`${sku}: ${blockers.join(", ")}`);
  }
}

async function clearProduct(productId: string, sku: string) {
  await assertDeletable(productId, sku);

  const boms = await db.bom.findMany({
    where: { productId },
    select: { id: true, revision: true },
  });

  if (!apply) {
    console.log(
      `  [dry] ${sku}: delete ${boms.length} BOM(s), putaway/stock rules, product row`
    );
    return;
  }

  await db.putawayRule.deleteMany({ where: { productId } });
  await db.stockRule.deleteMany({ where: { productId } });
  await db.bin.deleteMany({ where: { productId, qty: 0 } });

  for (const bom of boms) {
    await deleteBom(bom.id);
    console.log(`    ✓ deleted BOM ${bom.revision}`);
  }

  await db.product.delete({ where: { id: productId } });
  console.log(`  ✓ deleted ${sku}`);
}

async function main() {
  const inactive = await db.product.findMany({
    where: { state: "inactive" },
    select: { id: true, sku: true },
    orderBy: { sku: "asc" },
  });

  console.log(
    apply
      ? `Deleting ${inactive.length} inactive product(s)…\n`
      : `DRY RUN — ${inactive.length} inactive product(s)\n`
  );

  if (inactive.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let deleted = 0;
  let skipped = 0;

  for (const p of inactive) {
    try {
      await clearProduct(p.id, p.sku);
      deleted++;
    } catch (e) {
      skipped++;
      console.warn(`  ⚠ skip ${p.sku}: ${(e as Error).message}`);
    }
  }

  console.log(
    `\nDone. ${apply ? "deleted" : "would delete"}=${deleted} skipped=${skipped}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
