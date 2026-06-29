// Backfill image variants for existing flat-file uploads.
//
// Walks /uploads/products/, /uploads/categories/, /uploads/concerns/ and
// for each flat file (e.g. I97.jpg) that doesn't already have responsive
// variants, runs the Sharp pipeline to generate thumb/medium/large WebP+JPEG.
//
// Then updates the DB record's imageUrl to the new directory path.
//
// Idempotent: skips any entity folder that already contains thumb.webp.
//
// Usage:
//   npx tsx scripts/backfill-image-variants.ts
//   npx tsx scripts/backfill-image-variants.ts --dry-run

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../src/db.js";
import { processImage } from "../src/lib/image-pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.join(__dirname, "..", "uploads");
const DRY_RUN = process.argv.includes("--dry-run");

interface BackfillItem {
  entityId: string;
  subDir: string;
  filePath: string;
  updateDb: (entityId: string, newBaseUrl: string) => Promise<void>;
}

async function collectItems(): Promise<BackfillItem[]> {
  const items: BackfillItem[] = [];

  // Products: flat files like /uploads/products/I97.jpg
  const productsDir = path.join(UPLOADS_ROOT, "products");
  if (fs.existsSync(productsDir)) {
    for (const fname of fs.readdirSync(productsDir)) {
      const fpath = path.join(productsDir, fname);
      if (!fs.statSync(fpath).isFile()) continue;
      if (!/\.(jpg|jpeg|png|webp)$/i.test(fname)) continue;
      const entityId = path.basename(fname, path.extname(fname));
      // Skip if variants already generated
      const variantDir = path.join(productsDir, entityId);
      if (fs.existsSync(path.join(variantDir, "thumb.webp"))) {
        console.log(`  SKIP products/${entityId} (already backfilled)`);
        continue;
      }
      items.push({
        entityId,
        subDir: "products",
        filePath: fpath,
        updateDb: async (id, baseUrl) => {
          await db.product
            .update({ where: { id }, data: { imageUrl: baseUrl } })
            .catch(() => {
              // Product may not exist or may match by SKU in old data
            });
        },
      });
    }
  }

  // Categories
  const catDir = path.join(UPLOADS_ROOT, "categories");
  if (fs.existsSync(catDir)) {
    for (const fname of fs.readdirSync(catDir)) {
      const fpath = path.join(catDir, fname);
      if (!fs.statSync(fpath).isFile()) continue;
      if (!/\.(jpg|jpeg|png|webp)$/i.test(fname)) continue;
      const entityId = path.basename(fname, path.extname(fname));
      const variantDir = path.join(catDir, entityId);
      if (fs.existsSync(path.join(variantDir, "thumb.webp"))) {
        console.log(`  SKIP categories/${entityId} (already backfilled)`);
        continue;
      }
      items.push({
        entityId,
        subDir: "categories",
        filePath: fpath,
        updateDb: async (id, baseUrl) => {
          await db.productCategory
            .update({ where: { id }, data: { imageUrl: baseUrl } })
            .catch(() => {});
        },
      });
    }
  }

  // Concerns
  const conDir = path.join(UPLOADS_ROOT, "concerns");
  if (fs.existsSync(conDir)) {
    for (const fname of fs.readdirSync(conDir)) {
      const fpath = path.join(conDir, fname);
      if (!fs.statSync(fpath).isFile()) continue;
      if (!/\.(jpg|jpeg|png|webp)$/i.test(fname)) continue;
      const entityId = path.basename(fname, path.extname(fname));
      const variantDir = path.join(conDir, entityId);
      if (fs.existsSync(path.join(variantDir, "thumb.webp"))) {
        console.log(`  SKIP concerns/${entityId} (already backfilled)`);
        continue;
      }
      items.push({
        entityId,
        subDir: "concerns",
        filePath: fpath,
        updateDb: async (id, baseUrl) => {
          await db.productConcern
            .update({ where: { id }, data: { imageUrl: baseUrl } })
            .catch(() => {});
        },
      });
    }
  }

  return items;
}

async function main() {
  console.log(`\nBackfill image variants${DRY_RUN ? " (dry-run)" : ""}\n`);

  const items = await collectItems();
  if (items.length === 0) {
    console.log("No flat-file images to backfill.");
    await db.$disconnect();
    return;
  }
  console.log(`Found ${items.length} image(s) to backfill.\n`);

  let ok = 0;
  let fail = 0;
  for (const item of items) {
    try {
      const buf = fs.readFileSync(item.filePath);
      console.log(`  Processing ${item.subDir}/${item.entityId} (${(buf.length / 1024).toFixed(0)} KB)...`);
      if (!DRY_RUN) {
        const { baseUrl } = await processImage(buf, item.entityId, item.subDir, UPLOADS_ROOT);
        await item.updateDb(item.entityId, baseUrl);
        console.log(`    → ${baseUrl} ✓`);
      } else {
        console.log(`    → [dry-run] would generate /uploads/${item.subDir}/${item.entityId}/thumb|medium|large.{webp,jpg}`);
      }
      ok++;
    } catch (err) {
      console.error(`    ✗ Failed: ${(err as Error).message}`);
      fail++;
    }
  }

  console.log(`\nBackfill complete: ${ok} succeeded, ${fail} failed.`);
  if (!DRY_RUN && ok > 0) {
    console.log("Run `npm run db:sync-stock` or restart the backend to refresh catalog cache.");
  }

  await db.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
