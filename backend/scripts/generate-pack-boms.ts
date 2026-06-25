#!/usr/bin/env tsx
/**
 * Generate packaging BOMs: parent bulk → retail variants.
 *
 *   • Oils                  → WC-OIL-FILL (Oil Room → Stock Room)
 *   • Flours / atta / ravva → WC-STR-PACK-MANUAL (bulk transferred to Stock Room)
 *   • Grains & millets      → WC-VACUUM-MAIN (Stock Room zone A)
 *   • Snacks                → LINE-SNACKS-PACK (Snacks Room → Stock Room)
 *
 * Batch: 1 L / 1 kg parent → N variant units (e.g. 500 ml bottle from 1 L bulk → 2 pc).
 *
 *   npm run db:generate-pack-boms:dev -- --apply
 */
import { generatePackBomsForCatalog } from "../src/lib/generate-pack-boms.js";

const apply = process.argv.includes("--apply");
const all = process.argv.includes("--all");
const force = process.argv.includes("--force");

async function run() {
  if (!apply) {
    console.log("DRY RUN — pass --apply to write BOMs\n");
  }

  const results = await generatePackBomsForCatalog({
    force,
    dryRun: !apply,
    routedCategoriesOnly: !all,
    categorySlugs: all ? undefined : ["oils", "grains", "millets", "snacks", "spices"],
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let oil = 0;
  let manual = 0;
  let vacuum = 0;
  let snacks = 0;

  for (const r of results) {
    created += r.created.length;
    updated += r.updated.length;
    skipped += r.skipped.length;
    for (const row of [...r.created, ...r.updated]) {
      if (row.line === "oil") oil++;
      if (row.line === "manual") manual++;
      if (row.line === "vacuum") vacuum++;
      if (row.line === "snacks") snacks++;
    }
    if (r.created.length === 0 && r.updated.length === 0 && r.skipped.length === 0) {
      continue;
    }
    console.log(`\n${r.productSku}`);
    for (const c of r.created) {
      console.log(`  + ${c.variantSku.padEnd(28)} ${c.batch.padEnd(36)} [${c.line ?? "—"}]`);
    }
    for (const u of r.updated) {
      console.log(`  ~ ${u.variantSku.padEnd(28)} ${u.batch.padEnd(36)} [${u.line ?? "—"}]`);
    }
    for (const s of r.skipped) {
      console.log(`  skip ${s.variantSku} — ${s.reason}`);
    }
  }

  console.log(
    `\n=== ${apply ? "APPLIED" : "DRY-RUN"}: ${results.length} product(s) ===`
  );
  console.log(`Created: ${created}  Updated: ${updated}  Skipped: ${skipped}`);
  console.log(`Lines — oil: ${oil}  manual: ${manual}  vacuum: ${vacuum}  snacks: ${snacks}`);

  if (!apply) {
    console.log("\nRe-run with --apply to write.");
  }
}

run()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    const { db } = await import("../src/db.js");
    await db.$disconnect();
  });
