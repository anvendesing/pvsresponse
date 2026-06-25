#!/usr/bin/env tsx
/**
 * Hard-delete specific raw/semi shadow products (and linked DBOM test rows).
 *
 *   npx tsx scripts/purge-listed-raw-semi.ts --dry-run
 *   npx tsx scripts/purge-listed-raw-semi.ts --apply
 */
import { db } from "../src/db.js";

const apply = process.argv.includes("--apply");

/** Explicit SKUs from catalog cleanup request. */
const EXPLICIT_SKUS = [
  "DBOM-PARENT",
  "DBOM-PARENT-585bafcc",
  "RAPKL",
  "RASHW",
  "RBHMP",
  "RBLYG",
  "RBPSC",
  "RBRAR",
  "RBRCK",
  "RCHDL",
  "RCHPW",
  "RCLPW",
  "RCOAL",
  "RCOFP",
  "RCRPK",
  "RCTPK",
  "RCWPD",
  "RDDPD",
  "RDHNP",
  "RFPCK",
  "RGCHP",
  "RGGDL",
  "RGGPK",
  "RGPKL",
  "RHGDL",
  "RHGMS",
  "RHHBP",
  "RIAUM",
  "RIKUM",
  "RIMPM",
  "RJERP",
  "RJJSP",
  "RJNPT",
  "RKKKR",
  "RKNDP",
  "RKRPD",
  "RKWDP",
  "RLEJG",
  "RLMST",
  "RLPKL",
  "RMGPK",
  "RMGPW",
  "RMGSP",
  "RMLAD",
  "RMLIM",
  "RMMDM",
  "RMMFP",
  "RMMIM",
  "RMMLD",
  "RMMLT",
  "RMMPD",
  "RMMPS",
  "RMMRK",
  "RMNPT",
  "RMSPD",
  "RNDWP",
  "RNLKR",
  "RNVKR",
  "RODTS",
  "RPHPW",
  "RPJAC",
  "RPJAG",
  "RPPPD",
  "RSAND",
  "RSBPW",
  "RSBWR",
  "RSCPD",
  "RSJPP",
  "RSNPN",
  "RSRMP",
  "RTMPK",
  "RTPDR",
  "RTRFC",
  "RTRMP",
  "RVNKR",
  "RWGRP",
] as const;

function semiSkuForRaw(rawSku: string): string {
  const base = rawSku.trim().toUpperCase();
  return base.startsWith("R") ? `S${base.slice(1)}` : `S${base}`;
}

function parseSourceSku(tags: string | null | undefined): string | null {
  if (!tags) return null;
  const m = tags.match(/(?:^|,)\s*source-sku:([^,\s]+)/i);
  return m?.[1]?.trim().toUpperCase() ?? null;
}

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

async function stripBomReferences(productId: string, sku: string) {
  const [items, byproducts, ownedBoms] = await Promise.all([
    db.bomItem.findMany({
      where: { productId },
      select: { id: true, bom: { select: { revision: true, product: { select: { sku: true } } } } },
    }),
    db.bomByproduct.findMany({
      where: { productId },
      select: { id: true, bom: { select: { revision: true } } },
    }),
    db.bom.findMany({ where: { productId }, select: { id: true, revision: true } }),
  ]);

  if (items.length === 0 && byproducts.length === 0 && ownedBoms.length === 0) return;

  if (!apply) {
    if (items.length > 0) {
      console.log(
        `  [dry] ${sku}: remove ${items.length} BOM component row(s) from ${[
          ...new Set(items.map((i) => i.bom.product.sku)),
        ].join(", ")}`
      );
    }
    if (byproducts.length > 0) {
      console.log(`  [dry] ${sku}: remove ${byproducts.length} BOM byproduct row(s)`);
    }
    if (ownedBoms.length > 0) {
      console.log(`  [dry] ${sku}: delete ${ownedBoms.length} owned BOM(s)`);
    }
    return;
  }

  if (items.length > 0) {
    await db.bomItem.deleteMany({ where: { productId } });
    console.log(`  ✓ removed ${items.length} BOM component row(s) for ${sku}`);
  }
  if (byproducts.length > 0) {
    await db.bomByproduct.deleteMany({ where: { productId } });
    console.log(`  ✓ removed ${byproducts.length} BOM byproduct row(s) for ${sku}`);
  }
  for (const bom of ownedBoms) {
    await deleteBom(bom.id);
    console.log(`  ✓ deleted owned BOM ${bom.revision} for ${sku}`);
  }
}

async function purgeProduct(productId: string, sku: string) {
  await stripBomReferences(productId, sku);

  const [
    stockedBins,
    ledger,
    stockLots,
    poItems,
    invoiceItems,
    quoteItems,
    salesOrderItems,
    transferItems,
    variants,
  ] = await Promise.all([
    db.bin.count({ where: { productId, qty: { gt: 0 } } }),
    db.stockLedger.count({ where: { productId } }),
    db.stockLot.count({ where: { productId } }),
    db.purchaseOrderItem.count({ where: { productId } }),
    db.invoiceItem.count({ where: { productId } }),
    db.quoteItem.count({ where: { productId } }),
    db.salesOrderItem.count({ where: { productId } }),
    db.transferOrderItem.count({ where: { productId } }),
    db.productVariant.count({ where: { productId } }),
  ]);

  const blockers: string[] = [];
  if (stockedBins > 0) blockers.push(`${stockedBins} stocked bin(s)`);
  if (ledger > 0) blockers.push(`${ledger} ledger row(s)`);
  if (stockLots > 0) blockers.push(`${stockLots} stock lot(s)`);
  if (poItems > 0) blockers.push(`${poItems} PO line(s)`);
  if (invoiceItems > 0) blockers.push(`${invoiceItems} invoice line(s)`);
  if (quoteItems > 0) blockers.push(`${quoteItems} quote line(s)`);
  if (salesOrderItems > 0) blockers.push(`${salesOrderItems} sales order line(s)`);
  if (transferItems > 0) blockers.push(`${transferItems} transfer line(s)`);

  if (blockers.length > 0) {
    throw new Error(blockers.join(", "));
  }

  const boms = await db.bom.findMany({ where: { productId }, select: { id: true, revision: true } });

  if (!apply) {
    console.log(
      `  [dry] ${sku}: ${variants} variant(s), ${boms.length} BOM(s), delete product`
    );
    return;
  }

  await db.putawayRule.deleteMany({ where: { productId } });
  await db.stockRule.deleteMany({ where: { productId } });
  await db.vendorProduct.deleteMany({ where: { productId } });
  await db.bin.updateMany({
    where: { productId },
    data: { productId: null, variantId: null, qty: 0, reservedQty: 0, occupied: 0 },
  });

  for (const bom of boms) {
    await deleteBom(bom.id);
  }

  await db.productVariant.deleteMany({ where: { productId } });
  await db.product.delete({ where: { id: productId } });
  console.log(`  ✓ deleted ${sku}`);
}

async function collectTargets() {
  const explicit = await db.product.findMany({
    where: { sku: { in: [...EXPLICIT_SKUS] } },
    select: { id: true, sku: true, type: true, tags: true },
  });

  const byId = new Map(explicit.map((p) => [p.id, p]));

  // Semi rows derived from listed raw SKUs (S{base} or tagged source-sku).
  const semiSkus = EXPLICIT_SKUS.filter((s) => s.startsWith("R")).map(semiSkuForRaw);
  const semisBySku = await db.product.findMany({
    where: {
      type: "semi",
      OR: [{ sku: { in: semiSkus } }, { tags: { contains: "semi-from-raw" } }],
    },
    select: { id: true, sku: true, type: true, tags: true },
  });

  for (const p of semisBySku) {
    const source = parseSourceSku(p.tags);
    if (p.sku && semiSkus.includes(p.sku.toUpperCase())) {
      byId.set(p.id, p);
      continue;
    }
    if (source && EXPLICIT_SKUS.includes(source as (typeof EXPLICIT_SKUS)[number])) {
      byId.set(p.id, p);
    }
  }

  return [...byId.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

async function main() {
  const targets = await collectTargets();
  const missing = EXPLICIT_SKUS.filter((s) => !targets.some((p) => p.sku === s));

  console.log(
    apply
      ? `Deleting ${targets.length} raw/semi product(s)…\n`
      : `DRY RUN — ${targets.length} raw/semi product(s)\n`
  );

  if (missing.length > 0) {
    console.log(`Not in DB (${missing.length}): ${missing.join(", ")}\n`);
  }

  if (targets.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let deleted = 0;
  let skipped = 0;

  for (const p of targets) {
    try {
      await purgeProduct(p.id, p.sku);
      deleted++;
    } catch (e) {
      skipped++;
      console.warn(`  ⚠ skip ${p.sku}: ${(e as Error).message}`);
    }
  }

  console.log(`\nDone. ${apply ? "deleted" : "would delete"}=${deleted} skipped=${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
