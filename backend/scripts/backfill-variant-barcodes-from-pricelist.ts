// Backfill ProductVariant.barcode from the MRP price list Code No column (OS/RC/CH…).
// SKUs are left unchanged — only the scannable barcode field is updated.
//
// Usage:
//   npm run db:backfill-variant-barcodes
//   npm run db:backfill-variant-barcodes -- --dry-run
//   npm run db:backfill-variant-barcodes -- --mrp "path/to/MRP.xlsx" --dealer "path/to/DEALER.xlsx"

import { PrismaClient } from "@prisma/client";
import { buildSkuBarcodeMap } from "./import-pricelists.js";

const db = new PrismaClient();

const DEFAULT_MRP =
  "C:/Users/Sharath/Downloads/New261124/test140525/MRP PRICE LIST MARCH 2026.xlsx";
const DEFAULT_DEALER =
  "C:/Users/Sharath/Downloads/New261124/test140525/DEALERS PRICE LIST MARCH 2026..xlsx";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const mrpIdx = args.indexOf("--mrp");
const dealerIdx = args.indexOf("--dealer");
const mrpPath = mrpIdx >= 0 ? args[mrpIdx + 1] : DEFAULT_MRP;
const dealerPath = dealerIdx >= 0 ? args[dealerIdx + 1] : DEFAULT_DEALER;

const main = async () => {
  console.log(dryRun ? "DRY RUN — no DB writes" : "LIVE — updating variant barcodes");
  console.log(`MRP:    ${mrpPath}`);
  console.log(`Dealer: ${dealerPath}`);

  const skuToBarcode = buildSkuBarcodeMap(mrpPath, dealerPath);
  console.log(`Price list: ${skuToBarcode.size} variant SKUs mapped to Code No barcodes`);

  const variants = await db.productVariant.findMany({
    select: { id: true, sku: true, barcode: true },
    orderBy: { sku: "asc" },
  });
  console.log(`Database: ${variants.length} variants`);

  const barcodeOwners = new Map<string, string>();
  for (const v of variants) {
    if (v.barcode?.trim()) barcodeOwners.set(v.barcode.trim().toUpperCase(), v.sku);
  }

  let updated = 0;
  let unchanged = 0;
  let unmatched = 0;
  const conflicts: string[] = [];
  const unmatchedSkus: string[] = [];

  for (const v of variants) {
    const next = skuToBarcode.get(v.sku);
    if (!next) {
      unmatched++;
      unmatchedSkus.push(v.sku);
      continue;
    }
    const normalized = next.trim();
    if (v.barcode === normalized) {
      unchanged++;
      continue;
    }
    const owner = barcodeOwners.get(normalized.toUpperCase());
    if (owner && owner !== v.sku) {
      conflicts.push(`${normalized}: ${v.sku} vs existing owner ${owner}`);
      continue;
    }
    if (!dryRun) {
      await db.productVariant.update({
        where: { id: v.id },
        data: { barcode: normalized },
      });
      if (v.barcode?.trim()) {
        barcodeOwners.delete(v.barcode.trim().toUpperCase());
      }
      barcodeOwners.set(normalized.toUpperCase(), v.sku);
    }
    updated++;
    if (updated <= 10) {
      console.log(`  ${v.sku}: ${v.barcode ?? "(none)"} → ${normalized}`);
    }
  }

  if (updated > 10) console.log(`  … and ${updated - 10} more`);

  console.log("\nSummary:");
  console.log(`  updated:   ${updated}`);
  console.log(`  unchanged: ${unchanged}`);
  console.log(`  unmatched: ${unmatched}`);
  console.log(`  conflicts: ${conflicts.length}`);

  if (unmatchedSkus.length > 0 && unmatchedSkus.length <= 20) {
    console.log("\nUnmatched SKUs:");
    for (const s of unmatchedSkus) console.log(`  ${s}`);
  } else if (unmatchedSkus.length > 20) {
    console.log("\nFirst 20 unmatched SKUs:");
    for (const s of unmatchedSkus.slice(0, 20)) console.log(`  ${s}`);
  }

  if (conflicts.length > 0) {
    console.log("\nBarcode conflicts (skipped):");
    for (const c of conflicts.slice(0, 20)) console.log(`  ${c}`);
  }
};

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
