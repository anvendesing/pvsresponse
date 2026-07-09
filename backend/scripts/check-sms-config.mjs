import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const checkSkus = [
  'BSOP-CUT-TRIM-01','BSOP-MUL-100G-03','CAOL-AMU-200ML-06','CAOL-AMU-200ML-07',
  'CAOL-AMU-200ML-08','CAOL-AMU-500ML-04','COIL-200ML-PL-10','CTPK-300G-01',
  'FGRN-1KG-01','MROL-CIT-15ML-01','NGOL-200ML-GL-09','NLAD-GIN-200G-05',
  'NLAD-GIN-500G-02','RCSC-1KG-01','SOAP-PROC-BAB-100G-08','SOAP-PROC-COW-100G-01',
  'SOAP-PROC-JAS-100G-02','SOAP-PROC-NEE-100G-04','SOAP-PROC-NEE-100G-05',
  'SOAP-PROC-PAN-100G-06','SOAP-PROC-VET-100G-07',
];

// Use raw SQL to avoid field-name guessing issues
const rows = await db.$queryRaw`
  SELECT
    coalesce(v.sku, p.sku) AS sku,
    p.sku AS product_sku,
    p.name,
    p."ecommerceEnabled" AS product_ecommerce,
    v.sku AS variant_sku,
    v."ecommerceEnabled" AS variant_ecommerce,
    CASE WHEN v.id IS NULL THEN 'product' ELSE 'variant' END AS kind
  FROM "Product" p
  LEFT JOIN "ProductVariant" v ON v."productId" = p.id AND v.sku = ANY(${checkSkus})
  WHERE p.sku = ANY(${checkSkus}) OR v.sku = ANY(${checkSkus})
  ORDER BY coalesce(v.sku, p.sku)
`;

console.log('\n=== Provided SKUs — ecommerceEnabled status ===');
const found = new Set();
for (const r of rows) {
  found.add(r.sku);
  const enabled = r.product_ecommerce || r.variant_ecommerce;
  const productFlag = r.product_ecommerce ? 'product=YES' : 'product=no ';
  const variantFlag = r.kind === 'variant' ? (r.variant_ecommerce ? 'variant=YES' : 'variant=no ') : '           ';
  console.log(`${enabled ? '⚠' : '✓'} ${String(r.sku).padEnd(28)} ${productFlag} ${variantFlag}  → ${enabled ? 'STOREFRONT ACTIVE' : 'disabled'}`);
}
for (const sku of checkSkus) {
  if (!found.has(sku)) console.log(`? ${String(sku).padEnd(28)} NOT FOUND IN DB`);
}

// All storefront-enabled
const allEnabled = await db.$queryRaw`
  SELECT
    coalesce(v.sku, p.sku) AS sku,
    p.sku AS product_sku,
    p.name,
    p."ecommerceEnabled" AS product_ecommerce,
    v.sku AS variant_sku,
    v."ecommerceEnabled" AS variant_ecommerce,
    CASE WHEN v.id IS NULL THEN 'product' ELSE 'variant' END AS kind
  FROM "Product" p
  LEFT JOIN "ProductVariant" v ON v."productId" = p.id
  WHERE p."ecommerceEnabled" = true OR v."ecommerceEnabled" = true
  ORDER BY p.sku, v.sku
`;

// Group by product
const byProduct = {};
for (const r of allEnabled) {
  const key = r.product_sku;
  if (!byProduct[key]) byProduct[key] = { name: r.name, productEnabled: r.product_ecommerce, variants: [] };
  if (r.kind === 'variant') byProduct[key].variants.push({ sku: r.variant_sku, enabled: r.variant_ecommerce });
}

console.log('\n=== All storefront-ENABLED products ===');
const products = Object.entries(byProduct);
if (products.length === 0) {
  console.log('  (none)');
} else {
  for (const [pSku, info] of products) {
    const pFlag = info.productEnabled ? '[P✓]' : '[P○]';
    console.log(`${pFlag} ${pSku} — ${info.name}`);
    for (const v of info.variants) {
      console.log(`      ${v.enabled ? '✓' : '○'} ${v.sku}`);
    }
  }
}

const productCount = Object.keys(byProduct).length;
const variantCount = allEnabled.filter(r => r.kind === 'variant' && r.variant_ecommerce).length;
const productOnlyCount = allEnabled.filter(r => r.product_ecommerce).length;
console.log(`\nSummary: ${productCount} products involved, ${productOnlyCount} with product.ecommerceEnabled=true, ${variantCount} variants with ecommerceEnabled=true`);
await db.$disconnect();
