/**
 * Idempotent seed of default storefront product categories.
 * Run: npx tsx scripts/seed-product-categories.ts
 */
import { randomBytes } from "crypto";
import { DEFAULT_PRODUCT_CATEGORIES } from "../src/lib/product-categories.js";
import { db } from "../src/db.js";

const cuid = () => "c" + randomBytes(12).toString("hex").slice(0, 24);

async function main() {
  let created = 0;
  let skipped = 0;
  for (const c of DEFAULT_PRODUCT_CATEGORIES) {
    const existing = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM ProductCategory WHERE slug = ${c.slug} LIMIT 1
    `;
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    const id = cuid();
    const now = new Date().toISOString();
    await db.$executeRaw`
      INSERT INTO ProductCategory (id, slug, name, sortOrder, active, createdAt, updatedAt)
      VALUES (${id}, ${c.slug}, ${c.name}, ${c.sortOrder}, 1, ${now}, ${now})
    `;
    created++;
  }
  console.log(`[seed-product-categories] created=${created} skipped=${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
