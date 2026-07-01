/**
 * Bulk upload product images by barcode.
 *
 * Place your photos in a folder named by barcode:
 *   images-by-barcode/
 *     8901234567890.jpg
 *     8901234567891.jpg
 *     8901234567892.png
 *     ...
 *
 * Supported formats: jpg, jpeg, png, webp
 *
 * Usage:
 *   npx tsx scripts/bulk-upload-images-by-barcode.ts --dry-run
 *   npx tsx scripts/bulk-upload-images-by-barcode.ts --apply
 *   npx tsx scripts/bulk-upload-images-by-barcode.ts --apply --dir "D:/my-photos"
 *   npx tsx scripts/bulk-upload-images-by-barcode.ts --apply --api "http://217.216.78.119:4000/v1"
 *
 * Options:
 *   --dry-run   (default) Match files to DB products without uploading
 *   --apply     Actually upload the images
 *   --dir       Path to folder of barcode-named images (default: ./images-by-barcode)
 *   --api       Backend base URL (default: http://localhost:4000/v1)
 *   --user      Admin username (default: admin)
 *   --pass      Admin password (will prompt if omitted)
 *
 * On success, the backend generates 7 variants per product automatically:
 *   original.jpg  (archival, max 3000px)
 *   large.webp / large.jpg    (1200px - desktop hero)
 *   medium.webp / medium.jpg  (600px  - cards)
 *   thumb.webp / thumb.jpg    (300px  - grid / search)
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import * as path from "path";
import * as readline from "readline";
import { PrismaClient } from "@prisma/client";

const SUPPORTED = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--apply");
const DIR_IDX = args.indexOf("--dir");
const API_IDX = args.indexOf("--api");
const USER_IDX = args.indexOf("--user");
const PASS_IDX = args.indexOf("--pass");

const IMG_DIR = DIR_IDX >= 0 ? args[DIR_IDX + 1]! : path.join(process.cwd(), "images-by-barcode");
const API_BASE = API_IDX >= 0 ? args[API_IDX + 1]! : "http://localhost:4000/v1";
const ADMIN_USER = USER_IDX >= 0 ? args[USER_IDX + 1]! : "admin";
let ADMIN_PASS = PASS_IDX >= 0 ? args[PASS_IDX + 1]! : "";

const db = new PrismaClient();

// ── Helpers ────────────────────────────────────────────────────────────────────

function promptPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    process.stderr.write(prompt);
    rl.question("", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Login failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { token: string };
  return data.token;
}

async function lookupByBarcode(barcode: string): Promise<{ id: string; name: string; sku: string } | null> {
  // Direct DB lookup — fastest, no HTTP hop needed
  const product = await db.product.findFirst({
    where: { barcode: { equals: barcode, mode: "insensitive" } },
    select: { id: true, name: true, sku: true },
  });
  return product ?? null;
}

async function uploadImage(token: string, productId: string, filePath: string): Promise<void> {
  const buf = readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";

  // Use native FormData + Blob (available in Node 18+)
  const form = new FormData();
  form.append("image", new Blob([buf], { type: mime }), path.basename(filePath));

  const res = await fetch(`${API_BASE}/products/${productId}/image`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upload failed (${res.status}): ${body}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(DRY_RUN ? "\n[dry-run] No images will be uploaded.\n" : "\n[apply] Images will be uploaded.\n");
  console.log(`  Image folder : ${IMG_DIR}`);
  console.log(`  API base     : ${API_BASE}`);
  console.log();

  if (!existsSync(IMG_DIR)) {
    console.error(`ERROR: Image folder not found: ${IMG_DIR}`);
    console.error(`Create the folder and place barcode-named images inside it.`);
    process.exit(1);
  }

  // Collect image files
  const files = readdirSync(IMG_DIR)
    .filter((f) => SUPPORTED.has(path.extname(f).toLowerCase()))
    .map((f) => ({ file: f, barcode: path.basename(f, path.extname(f)), filePath: path.join(IMG_DIR, f) }));

  console.log(`Found ${files.length} image file(s) in folder.\n`);
  if (files.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // Login (only needed for --apply)
  let token = "";
  if (!DRY_RUN) {
    if (!ADMIN_PASS) {
      ADMIN_PASS = await promptPassword(`Password for "${ADMIN_USER}": `);
    }
    console.log("\nLogging in...");
    token = await login(ADMIN_USER, ADMIN_PASS);
    console.log("  Logged in OK.\n");
  }

  // Match each file to a product
  let matched = 0, notFound = 0, uploaded = 0, failed = 0, skipped = 0;
  const notFoundList: string[] = [];
  const failedList: string[] = [];

  for (const { file, barcode, filePath } of files) {
    const product = await lookupByBarcode(barcode);

    if (!product) {
      notFound++;
      notFoundList.push(barcode);
      console.log(`  ✗ NOT FOUND  ${file}`);
      continue;
    }

    matched++;
    const label = `${product.sku} — ${product.name}`;

    if (DRY_RUN) {
      console.log(`  ✓ MATCH      ${file}  →  ${label}`);
      skipped++;
      continue;
    }

    try {
      process.stdout.write(`  ↑ UPLOADING  ${file}  →  ${label} ... `);
      await uploadImage(token, product.id, filePath);
      console.log("done");
      uploaded++;
    } catch (e) {
      console.log("FAILED");
      console.error(`     ${(e as Error).message}`);
      failed++;
      failedList.push(`${barcode} (${label}): ${(e as Error).message}`);
    }
  }

  console.log("\n─────────────────────────────────────────────────────────");
  console.log(`  Files found   : ${files.length}`);
  console.log(`  Matched in DB : ${matched}`);
  console.log(`  Not in DB     : ${notFound}`);
  if (DRY_RUN) {
    console.log(`  Would upload  : ${matched}`);
    console.log("\n  Run with --apply to upload.");
  } else {
    console.log(`  Uploaded OK   : ${uploaded}`);
    console.log(`  Failed        : ${failed}`);
  }

  if (notFoundList.length) {
    console.log(`\n  Unmatched barcodes: ${notFoundList.join(", ")}`);
  }
  if (failedList.length) {
    console.log("\n  Upload failures:");
    failedList.forEach((f) => console.log(`    - ${f}`));
  }
  console.log("─────────────────────────────────────────────────────────\n");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
