/**
 * Idempotent seed of default storefront product categories.
 * Run: npx tsx scripts/seed-product-categories.ts
 */
import { DEFAULT_PRODUCT_CATEGORIES } from "../src/lib/product-categories.js";
import { LEGACY_CATEGORY_SLUG_MAP } from "../src/lib/category-slug-map.js";
import { db } from "../src/db.js";

async function main() {
  let created = 0;
  let updated = 0;
  for (const c of DEFAULT_PRODUCT_CATEGORIES) {
    const legacySlug = Object.entries(LEGACY_CATEGORY_SLUG_MAP).find(([, v]) => v === c.slug)?.[0];
    const existing =
      (await db.productCategory.findUnique({ where: { slug: c.slug } })) ??
      (legacySlug ? await db.productCategory.findUnique({ where: { slug: legacySlug } }) : null);

    if (existing) {
      await db.productCategory.update({
        where: { id: existing.id },
        data: {
          slug: c.slug,
          name: c.name,
          sortOrder: c.sortOrder,
          active: true,
        },
      });
      updated++;
      continue;
    }

    await db.productCategory.create({
      data: {
        slug: c.slug,
        name: c.name,
        sortOrder: c.sortOrder,
        active: true,
      },
    });
    created++;
  }
  console.log(`[seed-product-categories] created=${created} updated=${updated}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
