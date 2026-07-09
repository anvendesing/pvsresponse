import { PrismaClient } from '@prisma/client';
import {
  fetchStorefrontCatalogProducts,
  flattenStorefrontCatalog,
} from '../src/lib/storefront-catalog.ts';

const db = new PrismaClient();
const products = await fetchStorefrontCatalogProducts();
const flat = flattenStorefrontCatalog(products);

console.log(`Total catalog rows (variants): ${flat.length}`);
console.log(`Parent products: ${products.length}`);

const oilSlugs = ['oils', 'oil-seeds', 'oil_seeds', 'oil-seed'];
const oils = flat.filter((r) =>
  oilSlugs.some((s) => r.categorySlug?.includes(s) || r.categoryName?.toLowerCase().includes('oil'))
);
console.log(`\nOil / oil-seed category rows: ${oils.length}`);

const byCat = new Map();
for (const r of flat) {
  const k = r.categoryName ?? '?';
  byCat.set(k, (byCat.get(k) ?? 0) + 1);
}
const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log('\nTop categories by variant count:');
for (const [name, n] of top) console.log(`  ${n.toString().padStart(4)}  ${name}`);

await db.$disconnect();
