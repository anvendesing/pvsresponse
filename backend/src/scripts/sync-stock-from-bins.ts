/**
 * DEPRECATED — DO NOT RUN.
 *
 * This script summed every bin under a productId (regardless of
 * variantId) into the parent counter, then redistributed the total
 * across variants. Under the variant-tagged-bin model, that
 * conflates two separate inventory levels:
 *
 *   • parent.stockOnHand → bulk-only bins (variantId IS NULL)
 *   • variant.stockOnHand → per-variant bins (variantId = X)
 *
 * Running this script after variant-aware tagging will re-introduce
 * the "parent = sum of variants" drift that the Stock breakdown UI
 * exposed (e.g. APKL parent reading 1998 kg = 999 + 999 from its two
 * variant bins). If you need to reconcile counters with bins, use:
 *
 *   • scripts/backfill-orphan-variant-bins.ts — tag legacy untagged
 *     bins to their owning variant.
 *   • scripts/backfill-parent-bulk-counter.ts — recompute the parent
 *     counter from variantId=NULL bins only.
 *
 * The body below is left in place as a reference; the entry point
 * is now a no-op.
 */

import { db } from "../db.js";

async function legacyMain_DO_NOT_USE() {
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

async function main() {
  console.error(
    "sync-stock-from-bins is DEPRECATED and now a no-op. See the file header for the variant-aware replacements."
  );
  void legacyMain_DO_NOT_USE; // keep referenced so TS doesn't strip the body
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
