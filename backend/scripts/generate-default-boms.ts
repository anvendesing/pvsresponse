// Bulk-generate default packaging BOMs for every product with variants.
//
// For each variant that does not already have an active variant-scoped
// BOM, creates a one-line BOM:
//
//   outputQty = 1                       (1 variant unit per batch)
//   items[0] = parent product, qty = variant.packSize, uom = parent.uom
//
// This mirrors the `POST /products/:id/generate-default-boms` endpoint
// but runs across the entire catalog in one pass. Idempotent: variants
// that already have an active BOM are skipped.
//
// Usage:
//   npx tsx scripts/generate-default-boms.ts          # dry run (default)
//   npx tsx scripts/generate-default-boms.ts --apply  # write BOMs
//
// Always reports created and skipped counts so the operator knows
// whether a re-run created anything new.

import { db } from "../src/db.js";

const apply = process.argv.includes("--apply");

interface Created { productSku: string; variantSku: string; consumed: string; }
interface Skipped { productSku: string; variantSku: string; reason: string; }

async function run() {
  const products = await db.product.findMany({
    select: {
      id: true,
      sku: true,
      uom: true,
      variants: {
        where: { active: true },
        select: { id: true, sku: true, packSize: true, uom: true },
      },
    },
    orderBy: { sku: "asc" },
  });

  const created: Created[] = [];
  const skipped: Skipped[] = [];

  for (const p of products) {
    if (p.variants.length === 0) continue;
    for (const v of p.variants) {
      const existing = await db.bom.findFirst({
        where: { productId: p.id, variantId: v.id, active: true },
        select: { id: true },
      });
      if (existing) {
        skipped.push({
          productSku: p.sku,
          variantSku: v.sku,
          reason: `active BOM ${existing.id} already exists`,
        });
        continue;
      }
      const packSize = v.packSize && v.packSize > 0 ? v.packSize : 1;
      const consumed = `${packSize} ${p.uom} of ${p.sku}`;
      if (apply) {
        await db.bom.create({
          data: {
            productId: p.id,
            variantId: v.id,
            revision: "Rev-1.0 (auto)",
            outputQty: 1,
            active: true,
            items: {
              create: [
                { productId: p.id, qty: packSize, uom: p.uom, scrapPct: 0 },
              ],
            },
          },
        });
      }
      created.push({ productSku: p.sku, variantSku: v.sku, consumed });
    }
  }

  const mode = apply ? "APPLY" : "DRY-RUN";
  console.log(`\n=== ${mode}: default packaging BOM generation ===`);
  console.log(`Would create: ${created.length}`);
  console.log(`Skipped:      ${skipped.length} (already had an active BOM)`);

  if (created.length > 0) {
    console.log(`\n${apply ? "Created" : "Would create"} BOMs:`);
    for (const c of created) {
      console.log(`  ${c.productSku.padEnd(8)}  ${c.variantSku.padEnd(28)}  consumes ${c.consumed}`);
    }
  }
  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to write.");
  }
}

run()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
