#!/usr/bin/env tsx
/**
 * Repair MO-2026-2267 stock: bulk SOIL issue was taken from variant bin.
 * Run once: npx tsx scripts/fix-mo-2267-stock-split.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const REF = "MO-2026-2267";
const CORR = `${REF}-stock-split-fix`;

async function main() {
  const existing = await db.stockLedger.findFirst({ where: { ref: CORR } });
  if (existing) {
    console.log("Already repaired (ledger ref", CORR, ")");
    return;
  }

  const variant = await db.productVariant.findFirst({
    where: { sku: "SOIL-1L-PL-03" },
    include: { product: true },
  });
  if (!variant) throw new Error("Variant not found");

  const variantBin = await db.bin.findFirst({
    where: {
      variantId: variant.id,
      warehouse: { code: "WH-PROD-OIL" },
      zone: "A",
      shelf: "S70",
      bin: "06",
    },
    include: { warehouse: true },
  });
  if (!variantBin) throw new Error("Variant bin not found");

  const bulkBin = await db.bin.findFirst({
    where: {
      productId: variant.productId,
      variantId: null,
      qty: { gte: 100 },
    },
    include: { warehouse: true },
    orderBy: { qty: "desc" },
  });
  if (!bulkBin) throw new Error("No bulk SOIL bin with qty >= 100");

  console.log("Variant bin before:", variantBin.qty, variantBin.warehouse.code);
  console.log("Bulk bin before:", bulkBin.qty, bulkBin.warehouse.code, `${bulkBin.zone}/${bulkBin.shelf}/${bulkBin.bin}`);

  await db.$transaction(async (tx) => {
    const vAfter = await tx.bin.update({
      where: { id: variantBin.id },
      data: { qty: { increment: 100 } },
    });
    const bAfter = await tx.bin.update({
      where: { id: bulkBin.id },
      data: { qty: { decrement: 100 } },
    });

    await tx.stockLedger.create({
      data: {
        productId: variant.productId,
        variantId: variant.id,
        warehouseId: variantBin.warehouseId,
        bin: `${variantBin.zone}/${variantBin.shelf}/${variantBin.bin}`,
        txnType: "Adjust",
        ref: CORR,
        qty: 100,
        balance: vAfter.qty,
        date: new Date(),
      },
    });
    await tx.stockLedger.create({
      data: {
        productId: variant.productId,
        variantId: null,
        warehouseId: bulkBin.warehouseId,
        bin: `${bulkBin.zone}/${bulkBin.shelf}/${bulkBin.bin}`,
        txnType: "Adjust",
        ref: CORR,
        qty: -100,
        balance: bAfter.qty,
        date: new Date(),
      },
    });
  });

  console.log("Done. Variant bin should be +100; bulk bin -100.");
  console.log("Note: parent/variant stockOnHand were already correct from MO issue/complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
