/**
 * Idempotent seed: ensure canonical storefront category slugs exist.
 * Renames legacy short slugs (grains → grains-pulses-flours) in place.
 *
 * Run on every deploy (docker entrypoint) — no xlsx required.
 */
import { db } from "../db.js";
import { DEFAULT_PRODUCT_CATEGORIES } from "../lib/product-categories.js";
import { LEGACY_CATEGORY_SLUG_MAP } from "../lib/category-slug-map.js";

async function migrateLegacySlugs() {
  let renamed = 0;
  let merged = 0;
  for (const [legacySlug, newSlug] of Object.entries(LEGACY_CATEGORY_SLUG_MAP)) {
    const existing = await db.productCategory.findUnique({ where: { slug: legacySlug } });
    if (!existing) continue;

    const target = await db.productCategory.findUnique({ where: { slug: newSlug } });
    if (target && target.id !== existing.id) {
      await db.product.updateMany({
        where: { categoryId: existing.id },
        data: { categoryId: target.id },
      });
      await db.productCategory.update({
        where: { id: existing.id },
        data: { active: false },
      });
      merged++;
      continue;
    }

    await db.productCategory.update({
      where: { id: existing.id },
      data: { slug: newSlug },
    });
    renamed++;
  }
  return { renamed, merged };
}

async function upsertDefaults() {
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
  return { created, updated };
}

async function deactivateLegacyRows() {
  const slugs = Object.keys(LEGACY_CATEGORY_SLUG_MAP);
  const r = await db.productCategory.updateMany({
    where: { slug: { in: slugs } },
    data: { active: false },
  });
  return r.count;
}

async function main() {
  const { renamed, merged } = await migrateLegacySlugs();
  const { created, updated } = await upsertDefaults();
  const deactivated = await deactivateLegacyRows();
  console.log(
    `[seed-product-categories] renamed=${renamed} merged=${merged} ` +
      `created=${created} updated=${updated} deactivatedLegacy=${deactivated}`
  );
}

main()
  .catch((e) => {
    console.error("[seed-product-categories] Failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
