#!/usr/bin/env tsx
/**
 * Create a raw-material Product for every active catalog product whose UOM is kg.
 *
 * Naming:
 *   SKU  → R{originalSku}     e.g. FRPL → RFRPL
 *   Name → Raw {originalName} e.g. "Fine Rice" → "Raw Fine Rice"
 *
 * Skips products that are already type=raw, already named "Raw …", or whose
 * R-prefixed SKU already exists.
 *
 *   npm run db:backfill-raw-kg-products:dev
 *   npm run db:backfill-raw-kg-products:dev -- --dry-run
 *
 * VPS:
 *   docker compose exec backend npm run db:backfill-raw-kg-products
 */

import { PrismaClient } from "@prisma/client";
import { normalizeUomCode } from "../lib/uom.js";
import { shouldSkipRawShadowFromFinished } from "../lib/raw-semi-exclusions.js";

const dryRun = process.argv.includes("--dry-run");
const db = new PrismaClient();

function rawSku(sourceSku: string): string {
  const sku = sourceSku.trim().toUpperCase();
  return sku.startsWith("R") ? sku : `R${sku}`;
}

function rawName(sourceName: string): string {
  const name = sourceName.trim();
  if (/^raw\b/i.test(name)) return name;
  return `Raw ${name}`;
}

function rawBarcode(sourceBarcode: string, taken: Set<string>): string {
  const base = sourceBarcode.trim().toUpperCase();
  const candidates = [`R${base}`, `R-${base}`, `R.${base}`];
  for (const c of candidates) {
    if (c && !taken.has(c)) return c;
  }
  let i = 2;
  while (taken.has(`R${base}${i}`)) i += 1;
  return `R${base}${i}`;
}

function isRawName(name: string): boolean {
  return /^raw\b/i.test(name.trim());
}

async function main() {
  const products = await db.product.findMany({
    include: {
      variants: { select: { id: true } },
      category: { select: { slug: true } },
    },
  });

  const skuSet = new Set(products.map((p) => p.sku.toUpperCase()));
  const barcodeSet = new Set(
    products.map((p) => p.barcode.toUpperCase()).filter(Boolean)
  );

  let created = 0;
  let skipped = 0;

  for (const p of products) {
    if (normalizeUomCode(p.uom) !== "kg") {
      skipped += 1;
      continue;
    }
    if (p.type === "raw") {
      skipped += 1;
      continue;
    }
    if (isRawName(p.name)) {
      skipped += 1;
      continue;
    }
    if (
      shouldSkipRawShadowFromFinished({
        sku: p.sku,
        name: p.name,
        type: p.type,
        categorySlug: p.category?.slug ?? null,
      })
    ) {
      skipped += 1;
      continue;
    }

    const sku = rawSku(p.sku);
    if (skuSet.has(sku)) {
      console.log(`  skip ${p.sku} — raw SKU ${sku} already exists`);
      skipped += 1;
      continue;
    }

    const name = rawName(p.name);
    const barcode = rawBarcode(p.barcode, barcodeSet);

    const data = {
      sku,
      name,
      type: "raw",
      uom: "kg",
      barcode,
      state: p.state === "discontinued" ? "active" : p.state,
      categoryId: p.categoryId,
      hsn: p.hsn,
      gstRate: p.gstRate,
      costPrice: p.costPrice,
      sellingPrice: p.sellingPrice,
      reorderLevel: p.reorderLevel,
      stockOnHand: 0,
      batchTracked: p.batchTracked,
      weightKg: p.weightKg,
      description: p.description,
      ingredients: p.ingredients,
      tags: [p.tags, `source-sku:${p.sku}`].filter(Boolean).join(", "),
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
    `\n${dryRun ? "[DRY RUN] " : ""}Done: ${created} raw product(s) ${dryRun ? "planned" : "created"}, ${skipped} skipped.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
