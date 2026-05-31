/**
 * Bulk-reconcile Product.stockOnHand from actual bin quantities,
 * then redistribute the corrected total proportionally among variants.
 *
 * Products with NO bins (counter-only) are skipped.
 * Variants of a product with bins are rescaled so:
 *   sum(variant.stockOnHand) == product.stockOnHand (= bin total)
 *
 * If all variants currently show 0 the total is split evenly.
 *
 * Safe to re-run: already-correct products/variants are no-ops.
 *
 * Run:  npx tsx src/scripts/sync-stock-from-bins.ts
 */

import { db } from "../db.js";

async function main() {
  const productsWithBins = await db.bin.groupBy({
    by: ["productId"],
    where: { productId: { not: null } },
    _sum: { qty: true },
  });

  if (productsWithBins.length === 0) {
    console.log("No products with bins found. Nothing to sync.");
    return;
  }

  const defaultWh = await db.warehouse.findFirst({
    orderBy: { code: "asc" },
    select: { id: true, code: true },
  });
  if (!defaultWh) {
    console.error("No warehouses found — cannot create ledger entries.");
    process.exit(1);
  }

  const year = new Date().getUTCFullYear();
  let productSynced = 0;
  let productSkipped = 0;
  let variantSynced = 0;

  for (const row of productsWithBins) {
    if (!row.productId) continue;
    const binTotal = row._sum.qty ?? 0;

    const product = await db.product.findUnique({
      where: { id: row.productId },
      select: {
        id: true, sku: true, name: true, stockOnHand: true,
        variants: { select: { id: true, sku: true, stockOnHand: true } },
      },
    });
    if (!product) continue;

    // ── Step 1: sync parent counter ──────────────────────────────
    if (product.stockOnHand !== binTotal) {
      const delta = binTotal - product.stockOnHand;
      const ref = `SYNC-${year}-${Date.now().toString().slice(-6)}`;
      await db.$transaction([
        db.product.update({ where: { id: product.id }, data: { stockOnHand: binTotal } }),
        db.stockLedger.create({
          data: {
            productId: product.id,
            warehouseId: defaultWh.id,
            txnType: "Adjust",
            ref,
            qty: delta,
            balance: binTotal,
          },
        }),
      ]);
      console.log(
        `  ✓ PRODUCT  ${product.sku.padEnd(20)}  counter: ${product.stockOnHand} → ${binTotal}  (Δ ${delta > 0 ? "+" : ""}${delta})`
      );
      productSynced++;
    } else {
      productSkipped++;
    }

    // ── Step 2: redistribute among variants ──────────────────────
    const variants = product.variants;
    if (variants.length === 0) continue;

    const varSum = variants.reduce((s, v) => s + v.stockOnHand, 0);
    if (varSum === binTotal) continue; // already in sync

    // Proportional redistribution:
    //   If all variants are 0, split evenly.
    //   Otherwise scale each variant by (binTotal / varSum).
    let assigned = 0;
    const newQtys: { id: string; sku: string; before: number; after: number }[] = [];

    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      let newQty: number;
      if (i === variants.length - 1) {
        // Last variant gets the remainder to avoid rounding drift
        newQty = Math.max(0, binTotal - assigned);
      } else if (varSum === 0) {
        newQty = Math.round(binTotal / variants.length);
      } else {
        newQty = Math.round((v.stockOnHand / varSum) * binTotal);
      }
      assigned += newQty;
      newQtys.push({ id: v.id, sku: v.sku, before: v.stockOnHand, after: newQty });
    }

    for (const vq of newQtys) {
      if (vq.before === vq.after) continue;
      const delta = vq.after - vq.before;
      const ref = `ADJ-V-${year}-${Date.now().toString().slice(-6)}`;
      await db.$transaction([
        db.productVariant.update({ where: { id: vq.id }, data: { stockOnHand: vq.after } }),
        db.stockLedger.create({
          data: {
            productId: product.id,
            warehouseId: defaultWh.id,
            txnType: "Adjust",
            ref,
            qty: delta,
            balance: vq.after,
          },
        }),
      ]);
      console.log(
        `       VARIANT  ${vq.sku.padEnd(20)}  counter: ${vq.before} → ${vq.after}  (Δ ${delta > 0 ? "+" : ""}${delta})`
      );
      variantSynced++;
    }
  }

  console.log(
    `\nDone. Products synced: ${productSynced}  already correct: ${productSkipped}  Variants adjusted: ${variantSynced}`
  );
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
