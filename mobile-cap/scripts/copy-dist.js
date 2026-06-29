#!/usr/bin/env node
// Copies pvsecommerce/dist → mobile-cap/www (the Capacitor webDir).
// Runs cross-platform without a POSIX shell.

const { cpSync, rmSync, existsSync, mkdirSync } = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const src = path.resolve(root, "../pvsecommerce/dist");
const dst = path.resolve(root, "www");

if (!existsSync(src)) {
  console.error(`[copy-dist] Source not found: ${src}`);
  console.error("  Run 'npm run build:web' first.");
  process.exit(1);
}

if (existsSync(dst)) {
  rmSync(dst, { recursive: true, force: true });
}
mkdirSync(dst, { recursive: true });

cpSync(src, dst, { recursive: true });
console.log(`[copy-dist] Copied ${src} → ${dst}`);
