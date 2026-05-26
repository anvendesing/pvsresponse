// Stock reconciliation - the auditable replacement for the now-removed
// fix-negative-stock.ts (which silently clamped negative stockOnHand to 0,
// losing the variance).
//
// What this does
// --------------
// 1. For every parent Product, recomputes stockOnHand from the SUM of its
//    Bin.qty across all warehouses. If the recomputed value differs from
//    the stored one, writes a StockLedger entry of type "Adjust" capturing
//    the delta (positive or negative) and updates Product.stockOnHand.
//
// 2. For variant products, Bins don't currently disaggregate by variant
//    (Bin.variantId doesn't exist) so per-variant stock can't be derived
//    from bins. We refuse to touch ProductVariant.stockOnHand here -
//    operators must run a physical recount via Inventory > Adjustments
//    when variant counts drift. This script flags variants whose stock is
//    negative or whose parent product disagrees with the sum of variant
//    stocks, but leaves the values alone.
//
// 3. Idempotent: a clean run with no drift prints "No reconciliation
//    needed" and writes no ledger entries.
//
// Why this is correct
// -------------------
// - StockOnHand should never be silently mutated. Every change is a stock
//   movement and belongs in the ledger so a finance audit can trace it.
// - Bins are the operational source of truth for parent products (you can
//   walk the warehouse and count them). Reconciliation against bins is
//   therefore allowed to be authoritative.
// - Variants need a physical recount because bins don't carry variant.
//   Until Bin.variantId is added (separate schema change), the script
//   only reports variance and flags negatives.
//
// Usage:  npx tsx scripts/reconcile-stock.ts [--apply]
//
// By default this runs in DRY-RUN mode and only prints what would change.
// Pass `--apply` to actually write the ledger entries and update products.

import { db } from "../src/db.js";

interface Drift {
  productId: string;
  sku: string;
  name: string;
  storedStock: number;
  binTotal: number;
  delta: number; // binTotal - storedStock (positive => increase, negative => decrease)
}

interface VariantFlag {
  variantId: string;
  parentSku: string;
  variantSku: string;
  storedStock: number;
}

async function reconcile(apply: boolean) {
  const products = await db.product.findMany({
    select: {
      id: true,
      sku: true,
      name: true,
      stockOnHand: true,
      variants: {
        select: { id: true, sku: true, stockOnHand: true },
      },
    },
    orderBy: { sku: "asc" },
  });

  const wh = await db.warehouse.findFirst();
  if (!wh) {
    console.error("No warehouse found - cannot write ledger entries.");
    process.exit(1);
  }

  // Aggregate bins per product in one query.
  const binAgg = await db.bin.groupBy({
    by: ["productId"],
    _sum: { qty: true },
    where: { productId: { not: null } },
  });
  const binByProduct = new Map<string, number>(
    binAgg
      .filter((r): r is typeof r & { productId: string } => r.productId !== null)
      .map((r) => [r.productId, r._sum.qty ?? 0])
  );

  const drift: Drift[] = [];
  const negativeVariants: VariantFlag[] = [];
  const variantSumMismatch: {
    parentSku: string;
    parentStock: number;
    variantSum: number;
  }[] = [];

  for (const p of products) {
    const binTotal = binByProduct.get(p.id) ?? 0;
    if (binTotal !== p.stockOnHand) {
      drift.push({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        storedStock: p.stockOnHand,
        binTotal,
        delta: binTotal - p.stockOnHand,
      });
    }
    for (const v of p.variants) {
      if (v.stockOnHand < 0) {
        negativeVariants.push({
          variantId: v.id,
          parentSku: p.sku,
          variantSku: v.sku,
          storedStock: v.stockOnHand,
        });
      }
    }
    if (p.variants.length > 0) {
      const variantSum = p.variants.reduce((s, v) => s + v.stockOnHand, 0);
      if (variantSum !== p.stockOnHand) {
        variantSumMismatch.push({
          parentSku: p.sku,
          parentStock: p.stockOnHand,
          variantSum,
        });
      }
    }
  }

  // ----- Report -----
  console.log(`Mode: ${apply ? "APPLY (writes will be made)" : "DRY-RUN"}\n`);

  if (drift.length === 0) {
    console.log("Parent stockOnHand is consistent with bin totals.");
  } else {
    console.log(`Parent stockOnHand drift (vs bin totals): ${drift.length} product(s)`);
    for (const d of drift) {
      const arrow = d.delta > 0 ? "+" : "";
      console.log(
        `  ${d.sku.padEnd(28)} ${d.name.padEnd(28)} stored=${String(d.storedStock).padStart(5)}  bins=${String(
          d.binTotal
        ).padStart(5)}  delta=${arrow}${d.delta}`
      );
    }
  }

  if (negativeVariants.length > 0) {
    console.log(`\nVariants with negative stockOnHand: ${negativeVariants.length}`);
    for (const v of negativeVariants) {
      console.log(
        `  ${v.parentSku.padEnd(8)} / ${v.variantSku.padEnd(28)}  stock=${v.storedStock}`
      );
    }
    console.log(
      "  -> requires a physical recount via Inventory > Adjustments. This script will not touch variant counts."
    );
  } else {
    console.log("\nNo variants with negative stockOnHand.");
  }

  if (variantSumMismatch.length > 0) {
    console.log(
      `\nParent stock != sum(variants): ${variantSumMismatch.length} product(s) (informational)`
    );
    for (const m of variantSumMismatch) {
      console.log(
        `  ${m.parentSku.padEnd(8)} parent=${m.parentStock} variantSum=${m.variantSum}`
      );
    }
  }

  // ----- Apply -----
  if (!apply) {
    console.log(`\n(dry run) re-run with --apply to commit ${drift.length} adjustment(s).`);
    return;
  }
  if (drift.length === 0) {
    console.log("\nNo reconciliation needed.");
    return;
  }
  console.log("\nWriting StockLedger entries and updating Product.stockOnHand...\n");
  const ref = `RECOUNT-${new Date().toISOString().slice(0, 10)}`;
  for (const d of drift) {
    await db.$transaction([
      db.stockLedger.create({
        data: {
          productId: d.productId,
          warehouseId: wh.id,
          txnType: "Adjust",
          qty: d.delta,
          balance: d.binTotal,
          ref,
        },
      }),
      db.product.update({
        where: { id: d.productId },
        data: { stockOnHand: d.binTotal },
      }),
    ]);
    console.log(`  ${d.sku.padEnd(28)} adjusted by ${d.delta > 0 ? "+" : ""}${d.delta} -> ${d.binTotal}`);
  }
  console.log(
    `\nDone. ${drift.length} StockLedger 'Adjust' entries written with ref='${ref}'.`
  );
}

const apply = process.argv.includes("--apply");
reconcile(apply)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
