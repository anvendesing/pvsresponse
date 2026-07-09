import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const barcodes = [
  'B1300','B1301','SM1007','SM1008','DH348','DH349','RC183','RC184',
  'CH261','DH350','SM1004','SM935','SM1002','SM1003','B1302',
];

const variants = await db.productVariant.findMany({
  where: { barcode: { in: barcodes } },
  select: { productId: true, sku: true, barcode: true },
});
const productIds = [...new Set(variants.map(v => v.productId))];

for (const pid of productIds) {
  const p = await db.product.findUnique({
    where: { id: pid },
    select: { sku: true, gstRate: true, variants: { select: { sku: true, barcode: true, gstRate: true } } },
  });
  console.log(`\n${p?.sku} parentGst=${p?.gstRate}%`);
  for (const v of p?.variants ?? []) {
    console.log(`  ${v.sku.padEnd(24)} barcode=${v.barcode ?? '-'} gst=${v.gstRate}%`);
  }
}
await db.$disconnect();
