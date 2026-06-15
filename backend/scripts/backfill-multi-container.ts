// Multi-container packing backfill.
//
// Run AFTER `prisma db push` (or migrate deploy) when rolling the
// multi-container packing feature into an existing deployment. The
// script is idempotent — safe to run repeatedly. It does three things:
//
//   1. Seed the default ContainerType catalogue (BOX-S/M/L, BAG-S/L,
//      CARTON, SACK-25/50) if the table is empty.
//   2. Backfill ProductVariant.weightKg by parsing the variant's size
//      string ("500 ml" -> 0.46 kg, "5 kg" -> 5, ...). Only rows
//      where weightKg is still null are touched, so admin overrides
//      stick.
//   3. For every historical PackingSlip that was already packed/
//      invoiced before this rollout AND has no containers yet, create
//      a single auto-sealed container ("01") of the first active
//      ContainerType and allocate every line into it. This is what
//      keeps the per-item container reports rendering for old slips
//      instead of showing "no container info".
//
// Usage:
//   npm run db:backfill-multi-container                # apply changes
//   npm run db:backfill-multi-container -- --dry-run   # preview only
//
// Output is grouped by step with counts so an operator can paste the
// log into a deployment ticket.

import { PrismaClient } from "@prisma/client";
import { ensureDefaultContainerTypes } from "../src/lib/container-types-seed.js";
import { parseSizeToKg } from "../src/lib/variant-weight.js";
import {
  ensureAutoBundleContainer,
  recomputePackingSlipWeight,
} from "../src/lib/packing-containers.js";

const db = new PrismaClient();

const isDryRun = process.argv.includes("--dry-run");

const log = (msg: string) => {
  const prefix = isDryRun ? "[dry-run]" : "[apply]   ";
  // eslint-disable-next-line no-console
  console.log(`${prefix} ${msg}`);
};

async function seedContainerTypes() {
  const before = await db.containerType.count();
  if (isDryRun) {
    log(`Step 1: container types — ${before} rows present.`);
    return;
  }
  await ensureDefaultContainerTypes(db);
  const after = await db.containerType.count();
  log(`Step 1: container types — ${before} → ${after} rows.`);
}

async function backfillVariantWeights() {
  const variants = await db.productVariant.findMany({
    where: { weightKg: null },
    select: { id: true, sku: true, size: true },
  });
  let updated = 0;
  let skipped = 0;
  for (const v of variants) {
    const kg = parseSizeToKg(v.size);
    if (kg == null || kg <= 0) {
      skipped += 1;
      continue;
    }
    if (!isDryRun) {
      await db.productVariant.update({
        where: { id: v.id },
        data: { weightKg: Math.round(kg * 1000) / 1000 },
      });
    }
    updated += 1;
  }
  log(
    `Step 2: variant weights — ${updated} updated, ${skipped} left null (no parseable size).`
  );
}

async function backfillHistoricalContainers() {
  const slips = await db.packingSlip.findMany({
    where: {
      status: { in: ["packed", "invoiced"] },
      containers: { none: {} },
    },
    select: { id: true, packingSlipNo: true },
  });
  if (slips.length === 0) {
    log(`Step 3: historical slips — none need backfill.`);
    return;
  }
  // Make sure step 1 ran in apply mode before we try to attach a type.
  if (!isDryRun) await ensureDefaultContainerTypes(db);
  let created = 0;
  for (const s of slips) {
    if (isDryRun) {
      log(`  would create C01 for ${s.packingSlipNo}`);
      created += 1;
      continue;
    }
    await ensureAutoBundleContainer(db, s.id, null);
    await recomputePackingSlipWeight(db, s.id);
    created += 1;
  }
  log(`Step 3: historical slips — ${created} backfilled.`);
}

async function main() {
  log(`Starting multi-container backfill${isDryRun ? " (dry run)" : ""}.`);
  await seedContainerTypes();
  await backfillVariantWeights();
  await backfillHistoricalContainers();
  log(`Done.`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
