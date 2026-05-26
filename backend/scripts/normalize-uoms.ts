// Normalize all free-text uom strings in the database (Product.uom and
// BomItem.uom) to canonical UoM codes from src/lib/uom.ts.
//
// Maps "Kg" -> "kg", "Ltr" -> "L", "Mtr" -> "m", "Nos"/"Pcs" -> "pc"
// and similar legacy variants. Idempotent.
//
// Run with: npx tsx scripts/normalize-uoms.ts
import { PrismaClient } from "@prisma/client";
import { normalizeUomCode } from "../src/lib/uom";

const db = new PrismaClient();

async function normalizeProducts() {
  const all = await db.product.findMany({ select: { id: true, sku: true, uom: true } });
  const stats = new Map<string, number>();
  let unmapped = 0;
  for (const p of all) {
    const canonical = normalizeUomCode(p.uom);
    if (!canonical) {
      console.warn(`  ! ${p.sku}: cannot normalize uom=${JSON.stringify(p.uom)} - leaving as-is`);
      unmapped++;
      continue;
    }
    if (canonical !== p.uom) {
      await db.product.update({
        where: { id: p.id },
        data: { uom: canonical },
      });
      const key = `${p.uom} -> ${canonical}`;
      stats.set(key, (stats.get(key) ?? 0) + 1);
    }
  }
  console.log("Product.uom normalization:");
  for (const [k, v] of [...stats.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }
  if (unmapped) console.log(`  unmapped (left as-is): ${unmapped}`);
}

async function normalizeBomItems() {
  const all = await db.bomItem.findMany({ select: { id: true, uom: true } });
  const stats = new Map<string, number>();
  let unmapped = 0;
  for (const it of all) {
    const canonical = normalizeUomCode(it.uom);
    if (!canonical) {
      console.warn(
        `  ! BomItem ${it.id}: cannot normalize uom=${JSON.stringify(it.uom)} - leaving as-is`
      );
      unmapped++;
      continue;
    }
    if (canonical !== it.uom) {
      await db.bomItem.update({
        where: { id: it.id },
        data: { uom: canonical },
      });
      const key = `${it.uom} -> ${canonical}`;
      stats.set(key, (stats.get(key) ?? 0) + 1);
    }
  }
  console.log("BomItem.uom normalization:");
  for (const [k, v] of [...stats.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }
  if (unmapped) console.log(`  unmapped (left as-is): ${unmapped}`);
}

async function main() {
  await normalizeProducts();
  await normalizeBomItems();
  console.log("Done.");
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e);
    return db.$disconnect().then(() => process.exit(1));
  });
