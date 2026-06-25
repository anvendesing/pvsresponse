#!/usr/bin/env tsx
/**
 * Ensure Snacks Room packing line exists.
 *
 *   npm run db:configure-snacks-pack-line:dev
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const FACILITY_CODES = ["FAC-SNACKS", "WC-SNACKS"];
const PACK_LINE = "LINE-SNACKS-PACK";

async function main() {
  const fac = await db.productionFacility.findFirst({
    where: { code: { in: FACILITY_CODES } },
  });
  if (!fac) {
    console.log("SKIP: Snacks Room facility not found.");
    return;
  }

  await db.productionLine.upsert({
    where: { code: PACK_LINE },
    create: {
      code: PACK_LINE,
      name: "Packing Line",
      facilityId: fac.id,
      active: true,
    },
    update: {
      name: "Packing Line",
      facilityId: fac.id,
      active: true,
    },
  });
  console.log(`✓ ${fac.code} / ${PACK_LINE}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
