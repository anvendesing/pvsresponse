#!/usr/bin/env tsx
/**
 * Run full site operational setup (warehouses + production lines).
 *
 *   npm run ops:site-setup
 *   npm run ops:site-setup -- --dry-run
 *
 * VPS (from repo root on server, or inside backend container):
 *   cd backend && npx tsx ops-scripts/run-all.ts
 *   docker compose exec backend npx tsx ops-scripts/01-warehouses.ts
 */

import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dir, "..");
const dry = process.argv.includes("--dry-run");
const extra = dry ? ["--dry-run"] : [];

const steps = ["01-warehouses.ts", "02-production-lines.ts", "03-putaway-fg.ts"];

for (const step of steps) {
  const script = join(__dir, step);
  console.log(`\n=== ${step} ===\n`);
  const r = spawnSync("npx", ["tsx", script, ...extra], {
    stdio: "inherit",
    cwd: backendRoot,
    shell: true,
    env: process.env,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log("\n=== Site setup complete ===\n");
