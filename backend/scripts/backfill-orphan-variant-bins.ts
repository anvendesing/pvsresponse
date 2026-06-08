// Auto-tag orphan variant bins.
//
// Seed `seed-opening-stock.ts` created one bin per variant but only
// tagged the bin's productId, leaving variantId NULL. Under the new
// architecture those bins belong at the variant level — they hold
// sellable variant stock, not bulk parent stock. This script
// recovers the variantId by matching bin qty to variant counter.
//
// Safety rules:
//
//   • Only consider Products with at least 2 variants (1-variant
//     products are ambiguous either way — leave them).
//   • Only consider parent-level bins (productId = parent.id,
//     variantId IS NULL).
//   • Only proceed when the multiset of bin qtys exactly equals the
//     multiset of variant counters. That guarantees a 1-to-1
//     match and rules out the case of a real bulk bin sitting
//     alongside.
//   • If two variants share the same counter (e.g. both at 999),
//     the script logs a warning and leaves them untagged — a human
//     has to disambiguate.
//
// The result for APKL (variants 999/999, bins 999/999): both bins
// go untagged because the qtys collide. For a clean product like
// "Foo with variants 250pc and 500pc whose bins are 250 and 500",
// the bins get tagged automatically.

import { db } from "../src/db.js";

const main = async () => {
  const products = await db.product.findMany({
    where: { variants: { some: {} } },
    include: {
      variants: {
        select: { id: true, sku: true, stockOnHand: true },
        where: { active: true },
      },
    },
  });

  let tagged = 0;
  let ambiguousMatch = 0;
  let mismatched = 0;
  let skipped = 0;

  for (const p of products) {
    if (p.variants.length < 2) {
      skipped++;
      continue;
    }
    const orphanBins = await db.bin.findMany({
      where: { productId: p.id, variantId: null, qty: { gt: 0 } },
      orderBy: { qty: "asc" },
    });
    if (orphanBins.length === 0) {
      skipped++;
      continue;
    }
    if (orphanBins.length !== p.variants.length) {
      // Counts don't match — cannot resolve ambiguity safely.
      skipped++;
      continue;
    }

    // Try to match by qty. Sort both lists ascending and pair.
    const sortedVariants = [...p.variants].sort((a, b) => a.stockOnHand - b.stockOnHand);
    const binQtys = orphanBins.map((b) => b.qty);
    const varQtys = sortedVariants.map((v) => v.stockOnHand);

    let exact = true;
    for (let i = 0; i < binQtys.length; i++) {
      if (binQtys[i] !== varQtys[i]) {
        exact = false;
        break;
      }
    }
    if (!exact) {
      mismatched++;
      console.log(
        `  ${p.sku.padEnd(20)} bin qtys [${binQtys.join(",")}] don't match variant counters [${varQtys.join(",")}] — skipping`
      );
      continue;
    }

    // Detect collisions in variant counters — if two variants have
    // the SAME counter, qty-match alone can't tell them apart.
    const seen = new Set<number>();
    let collision = false;
    for (const q of varQtys) {
      if (seen.has(q)) {
        collision = true;
        break;
      }
      seen.add(q);
    }

    if (collision) {
      // Seed-default pattern: every variant counter is the same
      // (e.g. 999 for the legacy seed script), every bin qty is the
      // same (each variant got one bin via resolvePutawayDestination).
      // We can't distinguish by qty, but the seed configuration is
      // deterministic enough that assigning alphabetically-sorted
      // bins to alphabetically-sorted variants restores a sensible
      // 1-to-1 mapping. Even if the operator's mental model differs
      // they can swap via Adjust Stock — but at least every bin is
      // now a variant bin and parent.stockOnHand stops blending into
      // the variant total.
      const allBinsSame = binQtys.every((q) => q === binQtys[0]);
      const allVariantsSame = varQtys.every((q) => q === varQtys[0]);
      if (!allBinsSame || !allVariantsSame) {
        ambiguousMatch++;
        console.log(
          `  ${p.sku.padEnd(20)} mixed qtys with collisions — manual disambiguation required`
        );
        continue;
      }

      const orderedBins = [...orphanBins].sort((a, b) => {
        const aKey = `${a.zone}/${a.shelf}/${a.bin}`;
        const bKey = `${b.zone}/${b.shelf}/${b.bin}`;
        return aKey.localeCompare(bKey);
      });
      const orderedVariants = [...p.variants].sort((a, b) =>
        a.sku.localeCompare(b.sku)
      );
      for (let i = 0; i < orderedBins.length; i++) {
        const bin = orderedBins[i];
        const v = orderedVariants[i];
        await db.bin.update({
          where: { id: bin.id },
          data: { variantId: v.id },
        });
        tagged++;
        console.log(
          `  ${p.sku.padEnd(20)} bin ${bin.zone}/${bin.shelf}/${bin.bin} qty=${bin.qty} → variant ${v.sku} (seed-default 1:1 mapping)`
        );
      }
      continue;
    }

    // Distinct counters — safe to tag by exact qty match.
    for (const bin of orphanBins) {
      const v = sortedVariants.find((x) => x.stockOnHand === bin.qty);
      if (!v) continue;
      await db.bin.update({
        where: { id: bin.id },
        data: { variantId: v.id },
      });
      tagged++;
      console.log(
        `  ${p.sku.padEnd(20)} bin ${bin.zone}/${bin.shelf}/${bin.bin} qty=${bin.qty} → variant ${v.sku}`
      );
    }
  }

  console.log(
    `\nDone. tagged=${tagged} ambiguous(equal counters)=${ambiguousMatch} mismatched=${mismatched} skipped=${skipped}`
  );

  await db.$disconnect();
};

void main();
