/**
 * Assign price lists by customer code pattern:
 *   - Non CUST-#### codes → Dealer
 *   - CUST-#### codes are left unchanged (new ones get Retail at create time)
 *
 * Usage:
 *   npx tsx scripts/backfill-customer-price-lists.ts --dry-run
 *   npx tsx scripts/backfill-customer-price-lists.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import {
  getDealerPriceListId,
  isSystemAllocatedCustomerCode,
} from "../src/lib/customer-defaults.js";

const db = new PrismaClient();
const dryRun = !process.argv.includes("--apply");

async function main() {
  const dealerId = await getDealerPriceListId();
  if (!dealerId) {
    throw new Error("DEALER price list not found — run price list import/seed first.");
  }

  const customers = await db.customer.findMany({
    select: { id: true, code: true, priceListId: true, name: true },
    orderBy: { code: "asc" },
  });

  const targets = customers.filter((c) => !isSystemAllocatedCustomerCode(c.code));
  console.log(
    dryRun ? "[dry-run]" : "[apply]",
    `${targets.length} customer(s) with non CUST-#### codes → Dealer`
  );

  let updated = 0;
  let skipped = 0;
  for (const c of targets) {
    if (c.priceListId === dealerId) {
      skipped++;
      continue;
    }
    console.log(`  ${c.code} · ${c.name}`);
    if (!dryRun) {
      await db.customer.update({
        where: { id: c.id },
        data: { priceListId: dealerId },
      });
    }
    updated++;
  }

  console.log(
    dryRun
      ? `Would update ${updated}, already Dealer ${skipped}`
      : `Updated ${updated}, already Dealer ${skipped}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
