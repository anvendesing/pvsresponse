#!/usr/bin/env tsx
/**
 * Create a semi-finished Product for every active raw catalog product.
 *
 * Naming:
 *   SKU  → S{rest} when raw SKU starts with R…     e.g. RAJWN → SAJWN
 *        → SEMI-… when raw SKU starts with RAW-…  e.g. RAW-SOAP-OIL → SEMI-SOAP-OIL
 *   Name → Semi … (strips leading "Raw " when present)
 *
 * Skips test parents, existing semi SKU, or names already starting with Semi.
 *
 *   npm run db:backfill-semi-raw-products:dev
 *   npm run db:backfill-semi-raw-products:dev -- --dry-run
 *
 * VPS:
 *   docker compose exec backend npm run db:backfill-semi-raw-products
 */

import { PrismaClient } from "@prisma/client";
import { shouldSkipSemiShadowFromRaw } from "../lib/raw-semi-exclusions.js";

const dryRun = process.argv.includes("--dry-run");
const db = new PrismaClient();

/** Derive semi SKU from raw material SKU. */
export function semiSkuFromRaw(rawSku: string): string {
  const sku = rawSku.trim().toUpperCase();
  if (sku.startsWith("RAW-")) {
    return `SEMI-${sku.slice(4)}`;
  }
  if (sku.startsWith("R") && sku.length > 1) {
    return `S${sku.slice(1)}`;
  }
  return `S${sku}`;
}

function semiName(rawName: string): string {
  const name = rawName.trim();
  if (/^semi\b/i.test(name)) return name;
  if (/^raw\b/i.test(name)) {
    return `Semi ${name.replace(/^raw\s+/i, "")}`;
  }
  return `Semi ${name}`;
}

function semiBarcode(sourceBarcode: string, taken: Set<string>): string {
  const base = sourceBarcode.trim().toUpperCase();
  const candidates = [`S${base}`, `S-${base}`, `S.${base}`];
  for (const c of candidates) {
    if (c && !taken.has(c)) return c;
  }
  let i = 2;
  while (taken.has(`S${base}${i}`)) i += 1;
  return `S${base}${i}`;
}

function isTestSku(sku: string): boolean {
  return /^DBOM-/i.test(sku);
}

async function main() {
  const products = await db.product.findMany({
    where: { type: "raw", state: { not: "discontinued" } },
    include: { category: { select: { slug: true } } },
    orderBy: { sku: "asc" },
  });

  const skuSet = new Set(products.map((p) => p.sku.toUpperCase()));
  const allProducts = await db.product.findMany({ select: { sku: true, barcode: true } });
  for (const p of allProducts) skuSet.add(p.sku.toUpperCase());
  const barcodeSet = new Set(
    allProducts.map((p) => p.barcode.toUpperCase()).filter(Boolean)
  );

  let created = 0;
  let skipped = 0;

  for (const p of products) {
    if (isTestSku(p.sku)) {
      skipped += 1;
      continue;
    }
    if (/^semi\b/i.test(p.name.trim())) {
      skipped += 1;
      continue;
    }
    if (
      shouldSkipSemiShadowFromRaw({
        sku: p.sku,
        name: p.name,
        type: p.type,
        categorySlug: p.category?.slug ?? null,
      })
    ) {
      skipped += 1;
      continue;
    }

    const sku = semiSkuFromRaw(p.sku);
    if (skuSet.has(sku)) {
      console.log(`  skip ${p.sku} — semi SKU ${sku} already exists`);
      skipped += 1;
      continue;
    }

    const name = semiName(p.name);
    const barcode = semiBarcode(p.barcode, barcodeSet);

    const data = {
      sku,
      name,
      type: "semi",
      uom: p.uom,
      barcode,
      state: p.state === "blocked" ? "active" : p.state,
      categoryId: p.categoryId,
      hsn: p.hsn,
      gstRate: p.gstRate,
      costPrice: p.costPrice,
      sellingPrice: p.sellingPrice,
      reorderLevel: 0,
      stockOnHand: 0,
      batchTracked: p.batchTracked,
      weightKg: p.weightKg,
      description: p.description,
      ingredients: p.ingredients,
      tags: [p.tags, `source-sku:${p.sku}`, "semi-from-raw"].filter(Boolean).join(", "),
      imageHint: p.imageHint,
      imageUrl: p.imageUrl,
      ecommerceEnabled: false,
      priceListEnabled: false,
    };

    if (dryRun) {
      console.log(`[DRY RUN] Would create ${sku} ← ${p.sku} ("${name}")`);
    } else {
      await db.product.create({ data });
      skuSet.add(sku);
      barcodeSet.add(barcode.toUpperCase());
      console.log(`  created ${sku} ← ${p.sku}`);
    }
    created += 1;
  }

  console.log(
    `\n${dryRun ? "[DRY RUN] " : ""}Done: ${created} semi product(s) ${dryRun ? "planned" : "created"}, ${skipped} skipped.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
