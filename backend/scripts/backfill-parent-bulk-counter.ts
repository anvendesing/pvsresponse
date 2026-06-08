// Reset Product.stockOnHand for products WITH variants to its
// architectural value: the sum of bulk-only bins (variantId IS NULL).
//
// Why
// ---
// A legacy sync script — `src/scripts/sync-stock-from-bins.ts` —
// used to set parent.stockOnHand = Σ (all bins under productId)
// regardless of whether those bins actually held bulk parent stock
// or sellable variant stock. That left the Products / Stock breakdown
// panel showing parent counters that exactly matched the variant
// roll-up (e.g. APKL parent = 1998 kg = 999 (300g) + 999 (500g)
// — the variant sum, not the bulk).
//
// Going forward every flow that touches a counter (adjust, MO,
// transfer, dispatch, etc.) routes by level and never sums variant
// bins into the parent counter. This script makes the historic
// parent counters consistent with that rule:
//
//   For each Product with variants:
//     parent.stockOnHand = Σ bins where productId = parent.id
//                                   AND variantId IS NULL
//
// Products without variants are untouched — their parent counter
// already represents all of their physical inventory.
//
// Variants are NOT modified here. Their counters were already in a
// reasonable state (legacy seed values or set by sales / MO flows).

import { db } from "../src/db.js";

const main = async () => {
  const productsWithVariants = await db.product.findMany({
    where: { variants: { some: {} } },
    select: {
      id: true,
      sku: true,
      name: true,
      uom: true,
      stockOnHand: true,
      _count: { select: { variants: true } },
    },
    orderBy: { sku: "asc" },
  });

  console.log(
    `${productsWithVariants.length} parent product(s) have variants — recomputing bulk counter from variantId=NULL bins.\n`
  );

  let unchanged = 0;
  let resetToZero = 0;
  let updated = 0;

  for (const p of productsWithVariants) {
    const agg = await db.bin.aggregate({
      where: { productId: p.id, variantId: null },
      _sum: { qty: true },
    });
    const bulkOnly = Math.round(agg._sum.qty ?? 0);
    if (bulkOnly === p.stockOnHand) {
      unchanged++;
      continue;
    }
    await db.product.update({
      where: { id: p.id },
      data: { stockOnHand: bulkOnly },
    });
    if (bulkOnly === 0) resetToZero++;
    else updated++;
    console.log(
      `  ${p.sku.padEnd(20)} ${p._count.variants} variant(s)  parent counter ${p.stockOnHand} → ${bulkOnly} ${p.uom}`
    );
  }

  console.log(
    `\nDone. updated=${updated}  reset-to-zero (no bulk bins)=${resetToZero}  unchanged=${unchanged}`
  );

  await db.$disconnect();
};

void main();
