/**
 * Lists products with no usable image (no imageUrl or file missing on disk).
 * Writes CSV to backend/output/products-without-images.csv
 *
 * Run: npx tsx scripts/export-products-without-images.ts
 */
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { db } from "../src/db.js";

const uploadsRoot = join(process.cwd(), "uploads");

function fileExists(imageUrl: string | null | undefined): boolean {
  if (!imageUrl?.trim()) return false;
  const rel = imageUrl.replace(/^\/uploads\//, "");
  return existsSync(join(uploadsRoot, rel));
}

async function main() {
  const products = await db.product.findMany({
    select: {
      id: true,
      sku: true,
      name: true,
      category: { select: { name: true, slug: true } },
      type: true,
      state: true,
      imageUrl: true,
    },
    orderBy: { sku: "asc" },
  });

  const missing = products.filter((p) => !fileExists(p.imageUrl));

  const header = "sku,name,category,type,state,imageUrl,reason";
  const rows = missing.map((p) => {
    const reason = !p.imageUrl?.trim()
      ? "no_image_url"
      : "file_missing";
    const esc = (s: string) =>
      s.includes(",") || s.includes('"')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    return [
      esc(p.sku),
      esc(p.name),
      esc(p.category?.name ?? ""),
      esc(p.type),
      esc(p.state),
      esc(p.imageUrl ?? ""),
      reason,
    ].join(",");
  });

  const csv = [header, ...rows].join("\n");
  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "products-without-images.csv");
  writeFileSync(outPath, csv, "utf8");

  console.log(`Total products: ${products.length}`);
  console.log(`Without image: ${missing.length}`);
  console.log(`Written: ${outPath}`);
  console.log("\nFirst 20:");
  for (const p of missing.slice(0, 20)) {
    console.log(`  ${p.sku}  ${p.name}`);
  }
  if (missing.length > 20) console.log(`  ... and ${missing.length - 20} more in CSV`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
