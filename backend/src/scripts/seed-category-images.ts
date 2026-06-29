/**
 * One-time idempotent script that sets ProductCategory.imageUrl for every
 * category whose slug matches a shipped tile image in
 * `backend/uploads/categories/category_<slug>.png`.
 *
 * The storefront used to render those PNGs directly from
 * `pvsecommerce/public/images/`, so the ERP settings page never showed a
 * tile (the DB column was null). This script wires the existing tile
 * artwork into the DB so:
 *   - Settings → Categories shows each category's image, and
 *   - Admins can replace any image from the Settings UI (POST
 *     /categories/:id/image), which already overwrites imageUrl.
 *
 * Safe to re-run: only updates rows where imageUrl IS NULL, so any custom
 * upload is preserved.
 *
 * Run manually:   npx tsx src/scripts/seed-category-images.ts
 */

import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { db } from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const categoriesDir = join(__dirname, "..", "..", "uploads", "categories");

async function main() {
  let files: string[];
  try {
    files = readdirSync(categoriesDir);
  } catch {
    console.log(`[seed-category-images] No uploads/categories directory at ${categoriesDir}.`);
    return;
  }

  // Build slug → relative URL map from filenames like category_<slug>.png.
  const bySlug = new Map<string, string>();
  for (const f of files) {
    const m = f.match(/^category_([a-z0-9-]+)\.(png|jpg|jpeg|webp)$/i);
    if (!m) continue;
    bySlug.set(m[1].toLowerCase(), `/uploads/categories/${f}`);
  }

  if (bySlug.size === 0) {
    console.log("[seed-category-images] No category_<slug>.* tiles found, nothing to do.");
    return;
  }

  let updated = 0;
  let skipped = 0;
  let missing = 0;
  for (const [slug, imageUrl] of bySlug) {
    const result = await db.productCategory.updateMany({
      where: { slug, imageUrl: null },
      data: { imageUrl },
    });
    if (result.count > 0) updated += result.count;
    else {
      const existing = await db.productCategory.findUnique({ where: { slug } });
      if (!existing) missing++;
      else skipped++;
    }
  }

  console.log(
    `[seed-category-images] ${updated} updated, ${skipped} already had an imageUrl, ${missing} slug(s) had no matching category row.`
  );
}

main()
  .catch((e) => {
    console.error("[seed-category-images] Failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
