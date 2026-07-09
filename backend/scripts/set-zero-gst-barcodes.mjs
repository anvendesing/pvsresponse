import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const variantBarcodes = [
  'B1300', 'B1301', 'B1302',
  'SM1007', 'SM1008', 'SM1002', 'SM1003', 'SM1004', 'SM935',
  'DH348', 'DH349', 'DH350',
  'RC183', 'RC184',
  'CH261',
];

/** Parents where every variant is in the zero-GST list (see patch-zero-gst-barcodes.sql). */
const parentSkusAllZero = [
  'BK01', 'BK02', 'SMFT', 'BKSL', 'DPJG', 'LEJG', 'KWDP', 'RCSL', 'SESL',
];

const vResult = await db.productVariant.updateMany({
  where: { barcode: { in: variantBarcodes } },
  data: { gstRate: 0 },
});

const pResult = await db.product.updateMany({
  where: { sku: { in: parentSkusAllZero } },
  data: { gstRate: 0 },
});

console.log(`Updated ${vResult.count} variants, ${pResult.count} parent products.`);

const rows = await db.productVariant.findMany({
  where: { barcode: { in: variantBarcodes } },
  select: {
    barcode: true, sku: true, gstRate: true,
    product: { select: { sku: true, gstRate: true } },
  },
  orderBy: { barcode: 'asc' },
});

console.log('\n=== After patch ===');
for (const r of rows) {
  const ok = r.gstRate === 0;
  console.log(`${ok ? '✓' : '✗'} ${r.barcode}  ${r.sku.padEnd(22)} variant=${r.gstRate}%  parent ${r.product.sku}=${r.product.gstRate}%`);
}

const bad = rows.filter((r) => r.gstRate !== 0);
if (bad.length) {
  console.error(`\n${bad.length} variant(s) still not 0%`);
  process.exit(1);
}
console.log(`\nAll ${rows.length} variants set to 0% GST.`);
await db.$disconnect();
