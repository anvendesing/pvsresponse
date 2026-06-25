/**
 * sync-mfg.mjs
 *
 * Copies the Vite build output (erp-portal/dist/) into the manufacturing
 * Capacitor wrapper (mobile-mfg/www/).
 *
 * Run via: npm run build:mfg
 * Or standalone: node scripts/sync-mfg.mjs
 *
 * Mirrors sync-mobile.mjs (warehouse).
 */

import { cpSync, existsSync, rmSync, statSync, readdirSync } from "fs";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const src = resolve(root, "dist");
const dest = resolve(root, "..", "mobile-mfg", "www");

if (!existsSync(src)) {
  console.error(`ERROR: dist/ not found at ${src}`);
  console.error("Run 'npm run build' first, or use 'npm run build:mfg' to do both.");
  process.exit(1);
}

const EXCLUDE = new Set([
  "screenshots",
  "brochure",
]);

console.log(`Syncing  ${src}`);
console.log(`      -> ${dest}`);
console.log(`Excluding: ${[...EXCLUDE].join(", ")}`);

rmSync(dest, { recursive: true, force: true });

cpSync(src, dest, {
  recursive: true,
  filter: (sourcePath) => {
    const name = basename(sourcePath);
    if (EXCLUDE.has(name)) return false;
    return true;
  },
});

const sumSize = (p) => {
  let total = 0;
  for (const entry of readdirSync(p, { withFileTypes: true })) {
    const f = resolve(p, entry.name);
    total += entry.isDirectory() ? sumSize(f) : statSync(f).size;
  }
  return total;
};
const bytes = sumSize(dest);
console.log(`Done — mobile-mfg/www updated (${(bytes / 1024 / 1024).toFixed(2)} MB).`);
console.log("Next: cd ../mobile-mfg && npm run build:android");
