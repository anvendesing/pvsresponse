/**
 * Import concerns + product mappings from shop-by-concerns-mapping.xlsx
 *
 * Usage (from repo root):
 *   cd backend && npx tsx src/scripts/import-concerns-xlsx.ts ../shop-by-concerns-mapping.xlsx
 */
import ExcelJS from "exceljs";
import { db } from "../db.js";

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

async function main() {
  const file = process.argv[2] ?? "../shop-by-concerns-mapping.xlsx";
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);

  const concernSheet = wb.getWorksheet("Concerns");
  const mapSheet = wb.getWorksheet("Product-Concern Mapping");
  if (!concernSheet || !mapSheet) {
    throw new Error("Workbook must contain sheets 'Concerns' and 'Product-Concern Mapping'.");
  }

  const concernBySlug = new Map<string, string>();

  for (let r = 2; r <= concernSheet.rowCount; r++) {
    const row = concernSheet.getRow(r);
    const name = String(row.getCell(2).value ?? "").trim();
    const slug = String(row.getCell(3).value ?? "").trim().toLowerCase();
    if (!slug || !name) continue;
    const description = String(row.getCell(4).value ?? "").trim() || null;
    const icon = String(row.getCell(5).value ?? "").trim() || null;
    const sortOrder = Number(row.getCell(7).value ?? 0) || 0;
    const active = row.getCell(8).value !== false;

    const saved = await db.productConcern.upsert({
      where: { slug },
      create: { slug, name, description, icon, sortOrder, active },
      update: { name, description, icon, sortOrder, active },
    });
    concernBySlug.set(slug, saved.id);
  }

  const products = await db.product.findMany({
    select: { id: true, name: true, sku: true, barcode: true },
  });
  const byNormName = new Map<string, string>();
  const bySku = new Map<string, string>();
  for (const p of products) {
    byNormName.set(norm(p.name), p.id);
    bySku.set(norm(p.sku), p.id);
    if (p.barcode) bySku.set(norm(p.barcode), p.id);
  }

  let linked = 0;
  let missing = 0;
  const missingNames = new Set<string>();

  for (let r = 2; r <= mapSheet.rowCount; r++) {
    const row = mapSheet.getRow(r);
    const slug = String(row.getCell(3).value ?? "").trim().toLowerCase();
    const productName = String(row.getCell(7).value ?? "").trim();
    const variantSkus = String(row.getCell(11).value ?? "").trim();
    const concernId = concernBySlug.get(slug);
    if (!concernId || !productName) continue;

    let productId = byNormName.get(norm(productName));
    if (!productId && variantSkus) {
      for (const part of variantSkus.split(/[,;]/)) {
        const sku = part.trim();
        if (!sku) continue;
        productId = bySku.get(norm(sku));
        if (productId) break;
      }
    }
    if (!productId) {
      missing++;
      missingNames.add(productName);
      continue;
    }

    await db.productConcernLink.upsert({
      where: { productId_concernId: { productId, concernId } },
      create: { productId, concernId },
      update: {},
    });
    linked++;
  }

  console.log(`Concerns upserted: ${concernBySlug.size}`);
  console.log(`Product-concern links: ${linked}`);
  console.log(`Unmatched product names: ${missing}`);
  if (missingNames.size > 0) {
    console.log("Sample unmatched:", [...missingNames].slice(0, 15).join(", "));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
