/**
 * Assign Product.categoryId from legacy free-text category + name.
 * Run after seed-product-categories.ts.
 *
 * Run: npx tsx scripts/backfill-product-category-ids.ts
 */
import { bucketCategorySlug } from "../src/lib/product-categories.js";
import { db } from "../src/db.js";

type LegacyRow = { id: string; name: string };
type CatRow = { id: string; slug: string };

async function main() {
  const cats = await db.$queryRaw<CatRow[]>`SELECT id, slug FROM ProductCategory`;
  const bySlug = new Map(cats.map((c) => [c.slug, c.id]));

  const rows = await db.$queryRaw<LegacyRow[]>`
    SELECT id, name FROM Product
  `;

  let updated = 0;
  let already = 0;
  for (const row of rows) {
    const slug = bucketCategorySlug(null, row.name);
    const categoryId = bySlug.get(slug);
    if (!categoryId) {
      console.warn(`No category for slug ${slug}, product ${row.id}`);
      continue;
    }
    const current = await db.$queryRaw<{ categoryId: string | null }[]>`
      SELECT categoryId FROM Product WHERE id = ${row.id} LIMIT 1
    `;
    if (current[0]?.categoryId === categoryId) {
      already++;
      continue;
    }
    await db.$executeRaw`
      UPDATE Product SET categoryId = ${categoryId}, updatedAt = ${new Date().toISOString()}
      WHERE id = ${row.id}
    `;
    updated++;
  }
  console.log(`[backfill-product-category-ids] updated=${updated} unchanged=${already}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
