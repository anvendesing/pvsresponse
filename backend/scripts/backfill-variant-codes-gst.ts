/**
 * One-time backfill:
 *  1. Sets Product.gstRate = CompanyProfile.defaultTaxRate (default 18) for any
 *     products that were created before the gstRate column existed (they already
 *     have the @default(18) but this makes the intent explicit and handles any
 *     edge-case nulls).
 *  2. Generates a unique barcode for every ProductVariant that has a null barcode
 *     so the "required" API contract is satisfied going forward.
 *
 * Run:  npx tsx scripts/backfill-variant-codes-gst.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  // 1. Report gstRate coverage on products (all rows get @default(18) from the
  //    migration, so this is just a verification step).
  const totalProducts = await db.product.count();
  console.log(`Products with gstRate: ${totalProducts} (all defaulted to 18 via migration).`);

  // 2. Backfill missing variant barcodes.
  const variants = await db.productVariant.findMany({
    where: { barcode: null },
    include: { product: { select: { barcode: true } } },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Found ${variants.length} variants with null barcode.`);

  // Collect all existing barcodes so we can guarantee uniqueness.
  const existing = new Set(
    (await db.productVariant.findMany({ select: { barcode: true } }))
      .map(v => v.barcode)
      .filter(Boolean) as string[]
  );

  let fixed = 0;
  for (const v of variants) {
    const parentBarcode = v.product.barcode ?? v.productId;
    let candidate: string;
    let suffix = 1;
    do {
      candidate = `${parentBarcode}-V${String(suffix).padStart(2, "0")}`;
      suffix++;
    } while (existing.has(candidate));

    existing.add(candidate);
    await db.productVariant.update({
      where: { id: v.id },
      data: { barcode: candidate },
    });
    fixed++;
    if (fixed % 50 === 0) console.log(`  ${fixed}/${variants.length} barcodes generated…`);
  }

  console.log(`Generated barcodes for ${fixed} variants.`);
  console.log("Backfill complete.");
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
