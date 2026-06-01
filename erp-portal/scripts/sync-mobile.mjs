/**
 * sync-mobile.mjs
 *
 * Copies the Vite build output (erp-portal/dist/) into the Capacitor
 * wrapper's web-asset directory (mobile-erp/www/).
 *
 * Run via: npm run build:mobile
 * Or standalone: node scripts/sync-mobile.mjs
 *
 * Works cross-platform (Node 18+, no shell cp/rsync dependency).
 */

import { cpSync, existsSync, rmSync, statSync, readdirSync } from "fs";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const src = resolve(root, "dist");
const dest = resolve(root, "..", "mobile-erp", "www");

if (!existsSync(src)) {
  console.error(`ERROR: dist/ not found at ${src}`);
  console.error("Run 'npm run build' first, or use 'npm run build:mobile' to do both.");
  process.exit(1);
}

// Folders/files from public/ that are NOT needed by the warehouse APK
// (marketing screenshots, brochure decks, etc.). Excluding them shaves
// several megabytes off the APK assets/.
const EXCLUDE = new Set([
  "screenshots", // desktop ERP marketing screenshots, ~2.9 MB
  "brochure", // brochure microsite, not used by /m/*
]);

console.log(`Syncing  ${src}`);
console.log(`      -> ${dest}`);
console.log(`Excluding: ${[...EXCLUDE].join(", ")}`);

// Clear destination so deleted files don't linger
rmSync(dest, { recursive: true, force: true });

cpSync(src, dest, {
  recursive: true,
  filter: (sourcePath) => {
    const name = basename(sourcePath);
    if (EXCLUDE.has(name)) return false;
    return true;
  },
});

// Report final size
const sumSize = (p) => {
  let total = 0;
  for (const entry of readdirSync(p, { withFileTypes: true })) {
    const f = resolve(p, entry.name);
    total += entry.isDirectory() ? sumSize(f) : statSync(f).size;
  }
  return total;
};
const bytes = sumSize(dest);
console.log(`Done — mobile-erp/www updated (${(bytes / 1024 / 1024).toFixed(2)} MB).`);
console.log("Next: cd ../mobile-erp && npm run build:android");
