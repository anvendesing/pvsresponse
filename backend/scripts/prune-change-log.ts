// Prune old ChangeLog rows to prevent unbounded table growth.
//
// ChangeLog is only needed for mobile sync deltas going back to a client's
// last pull. 30 days is a safe default for any offline device to catch up.
//
// Schedule alongside prune-activity.ts (same daily cron job):
//   0 3 * * *  cd /opt/pvs/backend && node dist/scripts/prune-change-log.js
//
// Env overrides:
//   CHANGELOG_RETENTION_DAYS  (default: 30)

import { db } from "../src/db.js";

const RETAIN_DAYS = parseInt(process.env["CHANGELOG_RETENTION_DAYS"] ?? "30", 10);

async function main() {
  const cutoff = new Date(Date.now() - RETAIN_DAYS * 86_400_000);
  const { count } = await db.changeLog.deleteMany({
    where: { serverTime: { lt: cutoff } },
  });
  console.log(
    `[prune-change-log] Deleted ${count} ChangeLog rows older than ${RETAIN_DAYS} days ` +
      `(cutoff: ${cutoff.toISOString()}).`
  );
  await db.$disconnect();
}

main().catch((err) => {
  console.error("[prune-change-log] Error:", err);
  process.exit(1);
});
