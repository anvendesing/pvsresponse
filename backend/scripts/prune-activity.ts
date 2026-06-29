// Prune old CustomerActivity rows.
//
// Usage:
//   npx tsx scripts/prune-activity.ts
//
// Environment:
//   ACTIVITY_RETENTION_DAYS  — how many days to keep (default 90)
//
// Run this daily via cron, systemd timer, or call it from your
// existing scheduled-job harness.

import { db } from "../src/db.js";

const RETENTION_DAYS = parseInt(process.env["ACTIVITY_RETENTION_DAYS"] ?? "90", 10);

async function main() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  console.log(`[prune-activity] Deleting rows older than ${cutoff.toISOString()} (${RETENTION_DAYS}-day window)…`);
  const { count } = await db.customerActivity.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  console.log(`[prune-activity] Deleted ${count} row(s).`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error("[prune-activity] Failed:", err);
  process.exit(1);
});
