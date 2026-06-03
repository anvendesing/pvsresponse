#!/usr/bin/env tsx
/**
 * Run full site operational setup (warehouses + production lines).
 *
 *   npm run ops:site-setup            (dev — tsx source)
 *   npm run ops:site-setup:dist       (container — compiled JS)
 *   npm run ops:site-setup -- --dry-run
 *
 * VPS (inside backend container after docker compose up):
 *   docker compose exec backend npm run ops:site-setup:dist
 */

import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));

// Detect whether we are running as compiled JS (dist/) or raw TS (source).
// When compiled, import.meta.url ends with ".js" and the individual step
// scripts must also be invoked as .js via plain `node`.
const isCompiled = import.meta.url.endsWith(".js");
const ext = isCompiled ? ".js" : ".ts";

// backendRoot is one level up from either ops-scripts/ (source) or
// dist/ops-scripts/ (compiled) — still the /app directory in the container.
const backendRoot = join(__dir, "..");

const dry = process.argv.includes("--dry-run");
const extra = dry ? ["--dry-run"] : [];

const steps = [
  `01-warehouses${ext}`,
  `02-production-lines${ext}`,
  `03-putaway-fg${ext}`,
];

for (const step of steps) {
  const script = join(__dir, step);
  console.log(`\n=== ${step} ===\n`);

  const r = isCompiled
    ? spawnSync("node", [script, ...extra], {
        stdio: "inherit",
        cwd: backendRoot,
        shell: false,
        env: process.env,
      })
    : spawnSync("npx", ["tsx", script, ...extra], {
        stdio: "inherit",
        cwd: backendRoot,
        shell: true,
        env: process.env,
      });

  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log("\n=== Site setup complete ===\n");
