/**
 * Delete all stock rules (min-qty triggers).
 *
 *   npx tsx scripts/clear-stock-rules.ts
 *   npx tsx scripts/clear-stock-rules.ts --dry-run
 */

import { db } from "../src/db.js";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const count = await db.stockRule.count();
  console.log(`Found ${count} stock rule(s).`);
  if (count === 0) return;
  if (dryRun) {
    console.log("Dry run — no rows deleted.");
    return;
  }
  const deleted = await db.stockRule.deleteMany({});
  console.log(`Deleted ${deleted.count} stock rule(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
