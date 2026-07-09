#!/usr/bin/env tsx
/**
 * Merge duplicate Jowar (White) products into Jonnalu (white)/ Jowar.
 *
 * Moves:
 *   JWHF-1KG-01  →  parent JWJF (Jonnalu flour)
 *   JWHR-1KG-01  →  parent JWJR (Jonnalu ravva)
 *
 * Then deletes empty parents JWHF and JWHR, and renames JWWH (whole grain)
 * plus raw/semi supply SKUs from "Jowar (White)" to Jonnalu naming.
 *
 * Usage:
 *   npx tsx scripts/merge-jowar-white-into-jonnalu.ts           # dry run
 *   npx tsx scripts/merge-jowar-white-into-jonnalu.ts --apply     # apply
 */
import { db } from "../src/db.js";

const apply = process.argv.includes("--apply");

const MOVES = [
  { variantSku: "JWHF-1KG-01", fromParentSku: "JWHF", toParentSku: "JWJF" },
  { variantSku: "JWHR-1KG-01", fromParentSku: "JWHR", toParentSku: "JWJR" },
] as const;

const REMOVE_PARENTS: Record<string, string> = {
  JWHF: "JWJF",
  JWHR: "JWJR",
};

const RENAMES: Record<string, string> = {
  JWWH: "Jonnalu (white)/ Jowar",
  RJWWH: "Raw Jonnalu (white)/ Jowar",
  SJWWH: "Semi Jonnalu (white)/ Jowar",
  "JWWH-SEMI": "Semi Jonnalu (white)/ Jowar (milled)",
};

async function repointVariantProductId(variantId: string, newProductId: string) {
  const updates = [
    db.productVariant.update({ where: { id: variantId }, data: { productId: newProductId } }),
    db.bin.updateMany({ where: { variantId }, data: { productId: newProductId } }),
    db.vendorProduct.updateMany({ where: { variantId }, data: { productId: newProductId } }),
    db.stockLot.updateMany({ where: { variantId }, data: { productId: newProductId } }),
    db.priceListItem.updateMany({ where: { variantId }, data: { productId: newProductId } }),
    db.stockLedger.updateMany({ where: { variantId }, data: { productId: newProductId } }),
    db.invoiceItem.updateMany({ where: { variantId }, data: { productId: newProductId } }),
    db.quoteItem.updateMany({ where: { variantId }, data: { productId: newProductId } }),
    db.salesOrderItem.updateMany({ where: { variantId }, data: { productId: newProductId } }),
    db.pickListItem.updateMany({ where: { variantId }, data: { productId: newProductId } }),
    db.packingSlipItem.updateMany({ where: { variantId }, data: { productId: newProductId } }),
    db.customerReturnItem.updateMany({ where: { variantId }, data: { productId: newProductId } }),
    db.creditNoteItem.updateMany({ where: { variantId }, data: { productId: newProductId } }),
    db.transferOrderItem.updateMany({ where: { variantId }, data: { productId: newProductId } }),
    db.enquiryItem.updateMany({ where: { variantId }, data: { productId: newProductId } }),
    db.stockRule.updateMany({ where: { variantId }, data: { productId: newProductId } }),
    db.putawayRule.updateMany({ where: { variantId }, data: { productId: newProductId } }),
  ];
  await db.$transaction(updates);
}

async function deleteEmptyParent(
  productId: string,
  sku: string,
  dryRun = false,
  reassignToProductId?: string
) {
  const variants = await db.productVariant.count({ where: { productId } });
  if (variants > 0) {
    if (dryRun) {
      console.log(`  [dry] delete parent ${sku} (after ${variants} variant(s) moved)`);
      return;
    }
    throw new Error(`${sku} still has ${variants} variant(s) — aborting delete`);
  }

  const stockedBins = await db.bin.count({ where: { productId, qty: { gt: 0 } } });
  if (stockedBins > 0) {
    throw new Error(`${sku} has ${stockedBins} stocked bin(s) — aborting delete`);
  }

  const bomCount = await db.bom.count({ where: { productId } });
  const bomItemCount = await db.bomItem.count({ where: { productId } });
  const bomByproductCount = await db.bomByproduct.count({ where: { productId } });

  if ((bomCount > 0 || bomItemCount > 0 || bomByproductCount > 0) && !reassignToProductId) {
    throw new Error(
      `${sku} referenced by ${bomCount} BOM(s), ${bomItemCount} BOM line(s), ${bomByproductCount} byproduct(s)`
    );
  }

  if (apply && reassignToProductId) {
    if (bomCount > 0) {
      await db.bom.updateMany({ where: { productId }, data: { productId: reassignToProductId } });
      console.log(`    ✓ reassigned ${bomCount} BOM(s) from ${sku}`);
    }
    if (bomItemCount > 0) {
      await db.bomItem.updateMany({ where: { productId }, data: { productId: reassignToProductId } });
      console.log(`    ✓ reassigned ${bomItemCount} BOM line(s) from ${sku}`);
    }
    if (bomByproductCount > 0) {
      await db.bomByproduct.updateMany({ where: { productId }, data: { productId: reassignToProductId } });
      console.log(`    ✓ reassigned ${bomByproductCount} byproduct(s) from ${sku}`);
    }
  } else if (dryRun && (bomCount || bomItemCount || bomByproductCount)) {
    console.log(
      `    [dry] reassign from ${sku}: ${bomCount} BOM(s), ${bomItemCount} line(s), ${bomByproductCount} byproduct(s)`
    );
  }

  const blockers = await Promise.all([
    db.stockLedger.count({ where: { productId } }),
    db.invoiceItem.count({ where: { productId } }),
    db.salesOrderItem.count({ where: { productId } }),
    db.bom.count({ where: { productId } }),
    db.bomItem.count({ where: { productId } }),
    db.bomByproduct.count({ where: { productId } }),
  ]);
  const [ledger, invoices, orders, boms, bomItems, byproducts] = blockers;
  if (ledger + invoices + orders + boms + bomItems + byproducts > 0) {
    throw new Error(
      `${sku} blocked: ledger=${ledger}, invoiceItems=${invoices}, salesOrders=${orders}, boms=${boms}, bomItems=${bomItems}, byproducts=${byproducts}`
    );
  }

  if (!apply) {
    console.log(`  [dry] delete parent ${sku}`);
    return;
  }

  await db.$transaction([
    db.putawayRule.deleteMany({ where: { productId } }),
    db.stockRule.deleteMany({ where: { productId } }),
    db.bin.deleteMany({ where: { productId } }),
    db.productConcernLink.deleteMany({ where: { productId } }),
    db.product.delete({ where: { id: productId } }),
  ]);
  console.log(`  ✓ deleted parent ${sku}`);
}

async function main() {
  console.log(apply ? "\n[apply] Merging Jowar (White) into Jonnalu\n" : "\n[dry-run] Preview only\n");

  for (const move of MOVES) {
    const [variant, fromParent, toParent] = await Promise.all([
      db.productVariant.findUnique({
        where: { sku: move.variantSku },
        select: { id: true, sku: true, productId: true, barcode: true, stockOnHand: true },
      }),
      db.product.findUnique({ where: { sku: move.fromParentSku }, select: { id: true, sku: true, name: true } }),
      db.product.findUnique({
        where: { sku: move.toParentSku },
        select: { id: true, sku: true, name: true, variants: { select: { sku: true } } },
      }),
    ]);

    if (!variant) {
      console.log(`  · ${move.variantSku} not found — skip move`);
      continue;
    }
    if (!fromParent) {
      if (toParent && variant.productId === toParent.id) {
        console.log(`  · ${move.variantSku} already under ${move.toParentSku} — skip move`);
        continue;
      }
      throw new Error(`Source parent not found: ${move.fromParentSku}`);
    }
    if (!toParent) throw new Error(`Target parent not found: ${move.toParentSku}`);
    if (variant.productId !== fromParent.id) {
      if (variant.productId === toParent.id) {
        console.log(`  · ${move.variantSku} already under ${move.toParentSku} — skip move`);
        continue;
      }
      throw new Error(`${move.variantSku} is under unexpected parent ${variant.productId}`);
    }

    console.log(
      `  → ${move.variantSku} (${variant.barcode ?? "no barcode"}, stock ${variant.stockOnHand})`
    );
    console.log(`      ${fromParent.sku} — ${fromParent.name}`);
    console.log(`    ⇒ ${toParent.sku} — ${toParent.name} (existing variants: ${toParent.variants.map((v) => v.sku).join(", ") || "none"})`);

    if (apply) {
      await repointVariantProductId(variant.id, toParent.id);
      console.log(`    ✓ moved ${move.variantSku}`);
    }
  }

  console.log("");
  for (const sku of Object.keys(REMOVE_PARENTS)) {
    const parent = await db.product.findUnique({
      where: { sku },
      select: { id: true, sku: true, name: true, _count: { select: { variants: true } } },
    });
    if (!parent) {
      console.log(`  · ${sku} already removed`);
      continue;
    }
    const targetSku = REMOVE_PARENTS[sku]!;
    const target = await db.product.findUnique({ where: { sku: targetSku }, select: { id: true } });
    if (!target) throw new Error(`BOM reassignment target not found: ${targetSku}`);

    console.log(`  remove ${parent.sku} — ${parent.name} (${parent._count.variants} variant(s) left)`);
    await deleteEmptyParent(parent.id, parent.sku, !apply, target.id);
  }

  console.log("\nRename remaining Jowar (White) labels:");
  for (const [sku, newName] of Object.entries(RENAMES)) {
    const row = await db.product.findUnique({ where: { sku }, select: { id: true, sku: true, name: true } });
    if (!row) {
      console.log(`  · ${sku} not found — skip`);
      continue;
    }
    if (row.name === newName) {
      console.log(`  · ${sku} already "${newName}"`);
      continue;
    }
    console.log(`  ${row.sku}: "${row.name}" → "${newName}"`);
    if (apply) {
      await db.product.update({ where: { id: row.id }, data: { name: newName } });
      console.log("    ✓ renamed");
    }
  }

  if (!apply) {
    console.log("\nRun with --apply to execute.\n");
  } else {
    console.log("\nDone.\n");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
