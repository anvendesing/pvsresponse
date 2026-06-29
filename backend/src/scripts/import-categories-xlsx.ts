/**
 * Import category names/order and product→category mappings from
 * categories-and-products.xlsx (repo root).
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/import-categories-xlsx.ts
 *   npx tsx src/scripts/import-categories-xlsx.ts ../categories-and-products.xlsx
 */
import { existsSync } from "fs";
import ExcelJS from "exceljs";
import { db } from "../db.js";
import { DEFAULT_PRODUCT_CATEGORIES } from "../lib/product-categories.js";
import { LEGACY_CATEGORY_SLUG_MAP } from "../lib/category-slug-map.js";

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

interface CategoryRow {
  slug: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

async function readCategories(wb: ExcelJS.Workbook): Promise<CategoryRow[]> {
  const sheet = wb.getWorksheet("Categories");
  if (!sheet) throw new Error("Sheet 'Categories' not found.");

  const rows: CategoryRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const name = String(row.getCell(2).value ?? "").trim();
    const slug = String(row.getCell(3).value ?? "").trim().toLowerCase();
    const sortOrder = Number(row.getCell(5).value ?? 0) || 0;
    const activeRaw = row.getCell(6).value;
    const active =
      activeRaw === false || activeRaw === "false" || activeRaw === 0 ? false : true;
    if (!slug || !name) continue;
    rows.push({ slug, name, sortOrder, active });
  }
  return rows.sort((a, b) => a.sortOrder - b.sortOrder);
}

async function readProductMappings(wb: ExcelJS.Workbook): Promise<Map<string, string>> {
  const sheet = wb.getWorksheet("Category Items");
  if (!sheet) throw new Error("Sheet 'Category Items' not found.");

  const byName = new Map<string, string>();
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const name = String(row.getCell(7).value ?? "").trim();
    const slug = String(row.getCell(3).value ?? "").trim().toLowerCase();
    if (!name || !slug) continue;
    byName.set(norm(name), slug);
  }
  return byName;
}

async function migrateCategorySlugs() {
  // Rename legacy short slugs → canonical xlsx slugs in place (preserves ids + imageUrl).
  for (const [legacySlug, newSlug] of Object.entries(LEGACY_CATEGORY_SLUG_MAP)) {
    const existing = await db.productCategory.findUnique({ where: { slug: legacySlug } });
    if (!existing) continue;

    const targetExists = await db.productCategory.findUnique({ where: { slug: newSlug } });
    if (targetExists && targetExists.id !== existing.id) {
      // Merge: move products to target, deactivate legacy row.
      await db.product.updateMany({
        where: { categoryId: existing.id },
        data: { categoryId: targetExists.id },
      });
      await db.productCategory.update({
        where: { id: existing.id },
        data: { active: false },
      });
      continue;
    }

    await db.productCategory.update({
      where: { id: existing.id },
      data: { slug: newSlug },
    });
  }
}

async function upsertCategories(rows: CategoryRow[]) {
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const existing = await db.productCategory.findUnique({ where: { slug: row.slug } });
    if (existing) {
      await db.productCategory.update({
        where: { id: existing.id },
        data: {
          name: row.name,
          sortOrder: row.sortOrder,
          active: row.active,
        },
      });
      updated++;
      continue;
    }

    // Seed any category missing from DB (fresh installs).
    const def = DEFAULT_PRODUCT_CATEGORIES.find((c) => c.slug === row.slug);
    await db.productCategory.create({
      data: {
        slug: row.slug,
        name: row.name,
        sortOrder: row.sortOrder,
        active: row.active,
      },
    });
    created++;
    if (!def) {
      console.warn(`[import-categories] Created category not in DEFAULT_PRODUCT_CATEGORIES: ${row.slug}`);
    }
  }
  return { created, updated };
}

async function assignProducts(byName: Map<string, string>) {
  const categories = await db.productCategory.findMany({
    select: { id: true, slug: true },
  });
  const bySlug = new Map(categories.map((c) => [c.slug, c.id]));

  const products = await db.product.findMany({
    select: { id: true, name: true, sku: true, categoryId: true },
  });
  const byNormName = new Map<string, string>();
  for (const p of products) byNormName.set(norm(p.name), p.id);

  let linked = 0;
  let unchanged = 0;
  let missingProduct = 0;
  let missingCategory = 0;
  const unmatchedNames = new Set<string>();

  for (const [nName, slug] of byName) {
    const productId = byNormName.get(nName);
    if (!productId) {
      missingProduct++;
      unmatchedNames.add(nName);
      continue;
    }
    const categoryId = bySlug.get(slug);
    if (!categoryId) {
      missingCategory++;
      continue;
    }
    const product = products.find((p) => p.id === productId)!;
    if (product.categoryId === categoryId) {
      unchanged++;
      continue;
    }
    await db.product.update({
      where: { id: productId },
      data: { categoryId },
    });
    linked++;
  }

  return { linked, unchanged, missingProduct, missingCategory, unmatchedNames };
}

async function deactivateLegacyCategories() {
  for (const legacySlug of Object.keys(LEGACY_CATEGORY_SLUG_MAP)) {
    await db.productCategory.updateMany({
      where: { slug: legacySlug },
      data: { active: false },
    });
  }
}

async function main() {
  const candidates = [
    process.argv[2],
    "./data/categories-and-products.xlsx",
    "../categories-and-products.xlsx",
  ].filter((p): p is string => Boolean(p));
  const file = candidates.find((p) => existsSync(p)) ?? "../categories-and-products.xlsx";
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);

  const categoryRows = await readCategories(wb);
  const productMap = await readProductMappings(wb);

  console.log(`[import-categories] ${categoryRows.length} categories, ${productMap.size} product mappings`);

  await migrateCategorySlugs();
  const { created, updated } = await upsertCategories(categoryRows);
  console.log(`[import-categories] categories created=${created} updated=${updated}`);

  const assign = await assignProducts(productMap);
  console.log(
    `[import-categories] products linked=${assign.linked} unchanged=${assign.unchanged} ` +
      `missingProduct=${assign.missingProduct} missingCategory=${assign.missingCategory}`
  );
  if (assign.unmatchedNames.size > 0 && assign.unmatchedNames.size <= 20) {
    console.log("[import-categories] Unmatched xlsx product names:", [...assign.unmatchedNames].slice(0, 20));
  } else if (assign.unmatchedNames.size > 20) {
    console.log(`[import-categories] ${assign.unmatchedNames.size} xlsx product names had no DB match`);
  }

  await deactivateLegacyCategories();
  console.log("[import-categories] Done.");
}

main()
  .catch((e) => {
    console.error("[import-categories] Failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
