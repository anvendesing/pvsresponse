#!/usr/bin/env tsx
/**
 * Post-migrate configuration after `prisma migrate deploy` on VPS.
 * Idempotent — safe to re-run on every deploy.
 *
 *   npm run ops:post-migrate-config            (dev — tsx)
 *   npm run ops:post-migrate-config:dist       (container)
 *   npm run ops:post-migrate-config:dist -- --skip-lots
 *
 * VPS:
 *   docker compose exec backend npm run ops:post-migrate-config:dist
 */
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const isCompiled = import.meta.url.endsWith(".js");
const ext = isCompiled ? ".js" : ".ts";
const backendRoot = join(__dir, "..");

const skipLots = process.argv.includes("--skip-lots");

const steps = [
  `02-production-lines${ext}`,
  `05-configure-vacuum-stock-room${ext}`,
  `06-configure-oil-extraction${ext}`,
  `09-configure-mill-machines${ext}`,
  `10-configure-snacks-pack-line${ext}`,
];
if (!skipLots) {
  steps.push(`07-backfill-lots-from-bins${ext}`);
}

for (const step of steps) {
  const script = join(__dir, step);
  console.log(`\n=== ${step} ===\n`);

  const r = isCompiled
    ? spawnSync("node", [script], {
        stdio: "inherit",
        cwd: backendRoot,
        shell: false,
        env: process.env,
      })
    : spawnSync("npx", ["tsx", script], {
        stdio: "inherit",
        cwd: backendRoot,
        shell: true,
        env: process.env,
      });

  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log("\n=== Post-migrate configuration complete ===\n");
