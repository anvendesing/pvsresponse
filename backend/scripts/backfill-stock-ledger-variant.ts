/**
 * One-off backfill: for every Production-type ledger row whose
 * referenced production order ran against a variant-scoped BOM, copy
 * the BOM's variantId onto the ledger row. Same idea for by-product
 * rows. Idempotent.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const pendingProduction = await db.stockLedger.findMany({
    where: { txnType: "Production", variantId: null },
  });
  console.log(`scanning ${pendingProduction.length} production ledger rows…`);
  let updated = 0;
  for (const row of pendingProduction) {
    const po = await db.productionOrder.findUnique({
      where: { orderNo: row.ref },
      include: { bom: { include: { byproducts: true } } },
    });
    if (!po) continue;

    // Main finished good row: productId matches BOM's product. Use BOM
    // variant (could be null for product-level BOMs).
    if (row.productId === po.bom.productId && po.bom.variantId) {
      await db.stockLedger.update({
        where: { id: row.id },
        data: { variantId: po.bom.variantId },
      });
      updated++;
      continue;
    }

    // By-product row: productId matches a BomByproduct entry; copy its
    // variantId if set.
    const bp = po.bom.byproducts.find((b) => b.productId === row.productId);
    if (bp?.variantId) {
      await db.stockLedger.update({
        where: { id: row.id },
        data: { variantId: bp.variantId },
      });
      updated++;
    }
  }
  console.log(`updated ${updated} rows.`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
