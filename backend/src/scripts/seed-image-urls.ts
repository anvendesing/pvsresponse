/**
 * One-time idempotent script that sets Product.imageUrl for every product
 * whose SKU is in the IMAGE_URL_SEED map (derived from the Excel image
 * master and committed alongside the product photos in uploads/products/).
 *
 * Safe to re-run: it only updates rows where imageUrl IS NULL, so any
 * manually-set URLs (e.g. from a future admin upload UI) are preserved.
 *
 * Run manually:   npx tsx src/scripts/seed-image-urls.ts
 * Called by:      docker-entrypoint.sh on every container boot (fast no-op
 *                 once all products already have an imageUrl).
 */

import { IMAGE_URL_SEED } from "./image-url-seed-data.js";
import { db } from "../db.js";

async function main() {
  const entries = Object.entries(IMAGE_URL_SEED);
  let updated = 0;
  let skipped = 0;

  for (const [sku, imageUrl] of entries) {
    const result = await db.product.updateMany({
      where: { sku, imageUrl: null },
      data: { imageUrl },
    });
    if (result.count > 0) updated++;
    else skipped++;
  }

  console.log(
    `[seed-image-urls] ${updated} products updated, ${skipped} already had imageUrl`
  );
}

main()
  .catch((e) => {
    console.error("[seed-image-urls] Failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
