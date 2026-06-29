// Make a transaction-consistent snapshot of the local SQLite database.
// Uses sqlite3 VACUUM INTO when available; otherwise copies the file (stop
// the dev server first for a cold copy).
//
// Usage:  npx tsx scripts/snapshot-db.ts <dest-path>
// Env:    DATABASE_URL (default file:./dev.db); falls back to prisma/dev.db
import { existsSync, unlinkSync, statSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, "..");

function resolveSourceDb(): string {
  const raw = process.env.DATABASE_URL ?? "file:./dev.db";
  const fromEnv = raw.replace(/^file:/, "");
  const candidates = [
    resolve(backendRoot, fromEnv),
    resolve(backendRoot, "dev.db"),
    resolve(backendRoot, "prisma/dev.db"),
  ];
  for (const p of candidates) {
    if (existsSync(p) && statSync(p).size > 1024) return p;
  }
  throw new Error(
    `No SQLite database found. Tried:\n  ${candidates.join("\n  ")}\n` +
      "Start the backend once or set DATABASE_URL in backend/.env"
  );
}

const dest = resolve(process.argv[2] ?? resolve(backendRoot, "../dev.db.snapshot"));
const source = resolveSourceDb();

if (existsSync(dest)) unlinkSync(dest);

let usedVacuum = false;
try {
  execSync(`sqlite3 "${source.replace(/"/g, '""')}" "VACUUM INTO '${dest.replace(/'/g, "''")}'"`, {
    stdio: "pipe",
  });
  usedVacuum = true;
} catch {
  console.warn("[snapshot-db] sqlite3 VACUUM INTO unavailable — copying file (stop dev server for consistency).");
  copyFileSync(source, dest);
}

const s = statSync(dest);
console.log(
  `[snapshot-db] ${usedVacuum ? "Snapshot" : "Copy"}: ${source} → ${dest} (${(s.size / 1_048_576).toFixed(2)} MB)`
);
