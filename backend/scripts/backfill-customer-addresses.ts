/**
 * Move legacy full-address blobs from Customer.city into structured fields.
 *
 *   npm run db:backfill-customer-addresses:dev
 *   npm run db:backfill-customer-addresses:dev -- --dry-run
 */

import { PrismaClient } from "@prisma/client";
import { parseLegacyCustomerCity } from "../src/lib/customer-address.js";

const dryRun = process.argv.includes("--dry-run");
const db = new PrismaClient();

async function main() {
  const rows = await db.customer.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      city: true,
      addressLine: true,
      state: true,
      pincode: true,
    },
  });

  let migrated = 0;
  let pinExtracted = 0;
  let skipped = 0;

  for (const c of rows) {
    const hasStructured =
      !!c.addressLine?.trim() && !!c.pincode?.trim() && !!c.city?.trim();
    if (hasStructured) {
      skipped += 1;
      continue;
    }

    // Legacy import: full address in city, new columns empty.
    const legacyCity = c.city?.trim();
    if (!legacyCity && !c.addressLine?.trim()) {
      skipped += 1;
      continue;
    }

    const parsed = parseLegacyCustomerCity(legacyCity ?? c.addressLine);

    const data = {
      addressLine: c.addressLine?.trim() || parsed.addressLine,
      city: parsed.city ?? c.city,
      state: c.state?.trim() || parsed.state,
      pincode: c.pincode?.trim() || parsed.pincode,
    };

    if (!data.addressLine && !data.pincode) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(
        `[DRY RUN] ${c.code} ${c.name}`,
        `→ pin ${data.pincode ?? "MISSING"}, city ${data.city ?? "—"}`
      );
    } else {
      await db.customer.update({ where: { id: c.id }, data });
    }
    migrated += 1;
    if (data.pincode) pinExtracted += 1;
  }

  console.log(
    dryRun ? "[DRY RUN] " : "",
    `${migrated} customer(s) migrated, ${pinExtracted} with pincode, ${skipped} skipped`
  );
  console.log("Review customers missing pincode in Settings → Customers before dispatch.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
