// Make a transaction-consistent snapshot of dev.db without stopping
// the running dev server. SQLite's VACUUM INTO is an online operation
// and produces a single defragmented file safe to ship to the VPS.
//
// Usage:  npx tsx scripts/snapshot-db.ts <dest-path>
import { PrismaClient } from "@prisma/client";
import { existsSync, unlinkSync, statSync } from "node:fs";
import { resolve } from "node:path";

const dest = resolve(process.argv[2] ?? "../dev.db.snapshot");

if (existsSync(dest)) unlinkSync(dest);

const db = new PrismaClient();
try {
  await db.$executeRawUnsafe(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  const s = statSync(dest);
  console.log(`Snapshot written: ${dest} (${(s.size / 1_048_576).toFixed(2)} MB)`);
} finally {
  await db.$disconnect();
}
