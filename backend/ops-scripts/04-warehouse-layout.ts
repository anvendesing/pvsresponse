#!/usr/bin/env tsx
/**
 * Ensure Farm Shop (WH-FARM zone A) and Stock Room (STR zones A–D) match
 * the canonical layout files. Prunes legacy zones, then re-seeds bins.
 *
 *   npm run ops:warehouse-layout            (dev — tsx source)
 *   npm run ops:warehouse-layout:dist       (container — compiled JS)
 *
 * VPS (after git pull + rebuild):
 *   docker compose exec backend npm run ops:warehouse-layout:dist
 *
 * Or from the VPS host:
 *   bash scripts/vps-update.sh warehouse-layout
 */

import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dir, "..");
const isCompiled = import.meta.url.endsWith(".js");

const dry = process.argv.includes("--dry-run");
const extra = dry ? ["--dry-run"] : [];

function runNpm(script: string) {
  console.log(`\n=== npm run ${script} ===\n`);
  const r = spawnSync("npm", ["run", script, ...extra], {
    stdio: "inherit",
    cwd: backendRoot,
    shell: true,
    env: process.env,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Uses db:sync-warehouse-layout (prune + farm shop seed + stock room seed).
runNpm(isCompiled ? "db:sync-warehouse-layout" : "db:sync-warehouse-layout:dev");

console.log("\n=== Warehouse layout sync complete ===\n");
