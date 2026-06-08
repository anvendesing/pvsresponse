// One-shot backfill: tag legacy bins with the variantId implied by
// their stock-ledger history.
//
// Background: previously the MO-output and byproduct flows tagged
// the receiving bin with productId only, even when the BOM was
// variant-scoped. The bin physically held variant stock, but the
// `variantId` column was NULL — so the new variant-aware
// AdjustStockModal, ATP and InventoryLocations couldn't see those
// bins as "this variant's bins" and conflated them with bulk parent
// bins.
//
// Forward-going flows now tag the bin (manufacturing.ts main +
// byproduct, transfers drop, /inventory/adjust). This script tidies
// up the historical bins so the variant-aware UI is correct
// immediately, without requiring a fresh production run on each
// SKU.
//
// Tagging rule:
//   • Only consider bins where productId IS NOT NULL AND variantId IS NULL.
//   • Look at every StockLedger row that touched the bin AND has a
//     non-null variantId.
//   • If those rows all reference the SAME variantId, tag the bin
//     with that variant. (Single-variant bin — safe.)
//   • If the bin has rows for two or more different variants, leave
//     it alone — it's a multi-variant bin and the operator must
//     reorganise it before tagging makes sense.
//   • If the bin has zero variant-scoped ledger rows, leave it alone
//     — it's a genuine bulk-parent bin.

import { db } from "../src/db.js";

const main = async () => {
  const candidates = await db.bin.findMany({
    where: { productId: { not: null }, variantId: null },
    select: {
      id: true,
      warehouseId: true,
      zone: true,
      shelf: true,
      bin: true,
      qty: true,
      productId: true,
      product: { select: { sku: true } },
    },
  });

  console.log(`${candidates.length} parent-only bin(s) under inspection…\n`);

  let tagged = 0;
  let skippedMulti = 0;
  let skippedNoVariantHistory = 0;

  for (const b of candidates) {
    const binLabel = `${b.zone}/${b.shelf}/${b.bin}`;
    // The StockLedger.bin column is the bin label string, not the id,
    // and is scoped to a warehouse — match on (warehouseId, label).
    const variantRows = await db.stockLedger.findMany({
      where: {
        warehouseId: b.warehouseId,
        bin: binLabel,
        productId: b.productId!,
        variantId: { not: null },
      },
      select: { variantId: true },
    });

    if (variantRows.length === 0) {
      skippedNoVariantHistory++;
      continue;
    }

    const distinct = Array.from(
      new Set(variantRows.map((r) => r.variantId).filter((v): v is string => Boolean(v)))
    );
    if (distinct.length > 1) {
      skippedMulti++;
      console.log(
        `  SKIP multi-variant ${b.product?.sku ?? b.productId} ${binLabel}  variants=[${distinct.join(", ")}]`
      );
      continue;
    }

    const variantId = distinct[0];
    const variant = await db.productVariant.findUnique({
      where: { id: variantId },
      select: { sku: true },
    });
    await db.bin.update({
      where: { id: b.id },
      data: { variantId },
    });
    tagged++;
    console.log(
      `  TAG  ${b.product?.sku ?? b.productId} ${binLabel} qty=${b.qty}  → variant ${variant?.sku ?? variantId}`
    );
  }

  console.log(
    `\nDone. tagged=${tagged}  skipped(multi-variant)=${skippedMulti}  skipped(no variant history)=${skippedNoVariantHistory}`
  );

  await db.$disconnect();
};

void main();
