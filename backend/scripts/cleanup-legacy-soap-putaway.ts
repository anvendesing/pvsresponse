#!/usr/bin/env tsx
/** Remove putaway rules still pointing at retired standalone SOAP-PROC-* products. */
import { PrismaClient } from "@prisma/client";
import { SOAP_PROC_PRODUCT_SKU } from "../src/lib/soap-semi.js";

const db = new PrismaClient();

async function main() {
  const parent = await db.product.findUnique({
    where: { sku: SOAP_PROC_PRODUCT_SKU },
    select: { id: true },
  });
  if (!parent) throw new Error(`${SOAP_PROC_PRODUCT_SKU} parent not found`);

  const legacy = await db.product.findMany({
    where: {
      sku: { startsWith: `${SOAP_PROC_PRODUCT_SKU}-` },
      id: { not: parent.id },
    },
    select: { id: true, sku: true },
  });

  let removed = 0;
  for (const p of legacy) {
    const r = await db.putawayRule.deleteMany({ where: { productId: p.id } });
    removed += r.count;
    if (r.count > 0) console.log(`  ✓ ${p.sku}: ${r.count} rule(s) deleted`);
  }

  console.log(`\nDone — removed ${removed} stale putaway rule(s) for ${legacy.length} legacy product(s).`);
  console.log(`Correct rules: ${SOAP_PROC_PRODUCT_SKU} parent + variantId.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
