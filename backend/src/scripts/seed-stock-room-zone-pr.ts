/**
 * Seed Stock Room (STR) zone PR putaway rules for all bulk finished
 * products, and migrate any existing warehouse-level `_/<SKU>/00`
 * placeholder bins into the new `PR/<SKU>/00` zone slots.
 *
 * Why
 * ---
 * Finished goods produced at the various production rooms (Mill, Flour,
 * Snacks, Oil, …) need to land in Stock Room before retail packing.
 * Vacuum packing runs INSIDE STR (zone A), so when the production
 * warehouse already IS STR no TO is created — the FG just lands in
 * zone PR. Operators don't need bin-level allocation; "Zone PR" is the
 * staging bucket.
 *
 * What this script does
 * ---------------------
 *   1. For every active product (and per-variant where the variant is
 *      the manufactured SKU) without an existing putaway rule, create
 *      one with toWarehouse=STR, toZone="PR", toBinId=null.
 *   2. For every legacy `STR._/<SKU>/00` (or `STR.WH/<SKU>/00`) bin
 *      that holds stock, create/find the `STR.PR/<SKU>/00` slot, move
 *      the qty across, and write Adjust ledger entries on both sides
 *      so the books reconcile.
 *   3. Delete the now-empty `_` placeholders so the warehouse map stops
 *      showing them.
 *
 * Usage
 * -----
 *   npx tsx src/scripts/seed-stock-room-zone-pr.ts            # dry run
 *   npx tsx src/scripts/seed-stock-room-zone-pr.ts --apply    # commit
 *
 * Filter to a specific product family:
 *   ... --apply --sku-prefix=WHET,FLOR
 *
 * Skip the rule seeding (only migrate stock):
 *   ... --apply --skip-rules
 *
 * Skip the migration (only seed rules):
 *   ... --apply --skip-migrate
 */

import { PrismaClient } from "@prisma/client";
import {
  resolveOrCreateLocationBin,
  isWarehouseLevelZone,
} from "../lib/location-bin.js";

const apply = process.argv.includes("--apply");
const skipRules = process.argv.includes("--skip-rules");
const skipMigrate = process.argv.includes("--skip-migrate");
const dryRun = !apply;

const STR_CODE = "STR";
const ZONE_PR = "PR";
const RULE_PRIORITY = 200; // lower priority than existing fixed-bin rules
const RULE_NOTES = "Auto-staged in Zone PR for retail / vacuum pack";

const prefixArg = process.argv.find((a) => a.startsWith("--sku-prefix="));
const skuPrefixes = prefixArg
  ? prefixArg
      .slice("--sku-prefix=".length)
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  : [];

const db = new PrismaClient();

const skuMatches = (sku: string): boolean =>
  skuPrefixes.length === 0 || skuPrefixes.some((p) => sku.toUpperCase().startsWith(p));

async function seedRules(strId: string) {
  // Products eligible to be staged in STR.PR: FINISHED only. Semi
  // products (BRAR-SEMI, WHET-SEMI, …) stay on their production WH
  // until the next room consumes them; pushing them through STR adds
  // a pointless TO and dirties the staging zone.
  const products = await db.product.findMany({
    where: {
      state: "active",
      type: "finished",
    },
    select: { id: true, sku: true, name: true, type: true },
    orderBy: { sku: "asc" },
  });

  let created = 0;
  let skippedExisting = 0;
  let skippedFilter = 0;

  for (const p of products) {
    if (!skuMatches(p.sku)) {
      skippedFilter++;
      continue;
    }
    const existing = await db.putawayRule.findFirst({
      where: { productId: p.id, variantId: null, active: true },
    });
    if (existing) {
      skippedExisting++;
      continue;
    }
    if (dryRun) {
      console.log(`  [dry] rule  ${p.sku.padEnd(20)} → STR / Zone ${ZONE_PR}`);
    } else {
      await db.putawayRule.create({
        data: {
          productId: p.id,
          variantId: null,
          toWarehouseId: strId,
          toZone: ZONE_PR,
          toBinId: null,
          priority: RULE_PRIORITY,
          active: true,
          notes: RULE_NOTES,
        },
      });
    }
    created++;
  }

  console.log(
    `\nRules: ${created} ${dryRun ? "would be created" : "created"}, ` +
      `${skippedExisting} skipped (existing rule), ` +
      `${skippedFilter} skipped (sku filter)`
  );
}

async function migrateLegacyStock(strId: string) {
  // Pick up `_` / `WH` placeholder bins across EVERY warehouse — the
  // user's policy is "all finished goods live in STR.PR", so legacy
  // FG sitting in production-WH placeholders gets relocated too.
  const legacyBins = await db.bin.findMany({
    where: { OR: [{ zone: "_" }, { zone: "WH" }] },
    include: {
      product: { select: { sku: true, type: true } },
      warehouse: { select: { code: true } },
    },
  });

  if (legacyBins.length === 0) {
    console.log("\nMigration: no legacy `_/WH` zone bins anywhere. Nothing to move.");
    return;
  }

  const wh = await db.warehouse.findUnique({
    where: { id: strId },
    select: { id: true, code: true, scanPrefix: true },
  });
  if (!wh) throw new Error("STR warehouse not found");

  let moved = 0;
  let deleted = 0;
  let kept = 0;
  let movedQty = 0;

  for (const src of legacyBins) {
    if (!isWarehouseLevelZone(src.zone)) continue;
    // Only relocate FINISHED stock. Semi stays at the production WH
    // (next room consumes it in place); raw / packaging / consumables
    // also stay - their warehouses are storage by design.
    if (src.product && src.product.type !== "finished") {
      continue;
    }

    // Filter by --sku-prefix when supplied. Bins without a product tag
    // get the wildcard treatment (always processed when no filter).
    if (skuPrefixes.length > 0) {
      const sku = src.product?.sku ?? "";
      if (!skuMatches(sku)) {
        continue;
      }
    }

    // Empty bin: just delete the placeholder.
    if (src.qty <= 0 && src.reservedQty <= 0 && !src.productId) {
      if (dryRun) {
        console.log(`  [dry] delete empty ${src.code ?? `${src.zone}/${src.shelf}/${src.bin}`}`);
      } else {
        await db.bin.delete({ where: { id: src.id } });
      }
      deleted++;
      continue;
    }

    if (!src.productId) {
      // Has qty/reservation but no product — skip to be safe.
      console.warn(
        `  ! KEEP ${src.code} (qty=${src.qty}, no productId; manual review needed)`
      );
      kept++;
      continue;
    }
    if (src.reservedQty > 0) {
      console.warn(
        `  ! KEEP ${src.code} (qty=${src.qty}, reserved=${src.reservedQty}; resolve TOs first)`
      );
      kept++;
      continue;
    }

    // Choose the destination slot inside zone PR. We mirror the
    // existing pattern: one bin per product/variant in the zone, with
    // the shelf set to the product/variant SKU (and bin=00 placeholder).
    // The warehouse tree collapses this to `STR → Zone PR → <SKU>`.
    const destShelf = (src.shelf ?? "").toUpperCase() === "00"
      ? (src.product?.sku ?? "STOCK").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12)
      : src.shelf; // preserve any non-placeholder shelf the bin already had

    if (dryRun) {
      console.log(
        `  [dry] move ${src.warehouse.code}.${src.code ?? `${src.zone}/${src.shelf}/${src.bin}`}` +
          `  qty=${src.qty} → ${wh.code}.PR.${destShelf}.00 (${src.product?.sku ?? "?"})`
      );
      moved++;
      movedQty += src.qty;
      continue;
    }

    await db.$transaction(async (tx) => {
      // Create/find the PR slot. Going through resolveOrCreateLocationBin
      // means the no-deeper-children guard fires correctly (Zone PR has
      // no real shelves besides per-SKU placeholders).
      const dest = await resolveOrCreateLocationBin(tx, wh, {
        zone: ZONE_PR,
        shelf: destShelf,
        bin: "00",
      });

      // Refuse to mix products into one slot.
      if (dest.productId && dest.productId !== src.productId) {
        throw new Error(
          `dest slot ${dest.code} already holds another product (${dest.productId})`
        );
      }

      const qty = src.qty;

      await tx.bin.update({
        where: { id: dest.id },
        data: {
          qty: { increment: qty },
          productId: dest.productId ?? src.productId,
          variantId: dest.variantId ?? src.variantId,
        },
      });
      await tx.bin.update({
        where: { id: src.id },
        data: { qty: 0, productId: null, variantId: null },
      });

      // Ledger pair: -qty out of source warehouse, +qty into STR.
      // This treats the relocation as a transfer for the books
      // (variant counter / SOH is unchanged in aggregate).
      await tx.stockLedger.create({
        data: {
          productId: src.productId!,
          variantId: src.variantId,
          warehouseId: src.warehouseId,
          bin: `${src.zone}/${src.shelf}/${src.bin}`,
          txnType: "Transfer",
          ref: `ZONE-PR-MIGRATE:${src.id}`,
          qty: -qty,
          balance: 0,
        },
      });
      await tx.stockLedger.create({
        data: {
          productId: src.productId!,
          variantId: src.variantId,
          warehouseId: wh.id,
          bin: `${ZONE_PR}/${destShelf}/00`,
          txnType: "Transfer",
          ref: `ZONE-PR-MIGRATE:${src.id}`,
          qty,
          balance: dest.qty + qty,
        },
      });

      // Now safe to delete the source placeholder row.
      await tx.bin.delete({ where: { id: src.id } });
    });

    moved++;
    movedQty += src.qty;
  }

  console.log(
    `\nMigration: ${moved} ${dryRun ? "would move" : "moved"} (${movedQty} units), ` +
      `${deleted} empty deletes, ${kept} kept for review`
  );
}

async function main() {
  console.log(
    dryRun
      ? "=== DRY RUN === (pass --apply to commit)"
      : "=== Seed STR Zone PR putaway rules + migrate legacy stock ==="
  );
  if (skuPrefixes.length > 0) {
    console.log(`SKU filter: ${skuPrefixes.join(", ")}`);
  }

  const str = await db.warehouse.findUnique({
    where: { code: STR_CODE },
    select: { id: true, code: true, scanPrefix: true },
  });
  if (!str) {
    console.error(`Warehouse ${STR_CODE} not found.`);
    process.exit(1);
  }

  if (!skipRules) {
    await seedRules(str.id);
  } else {
    console.log("\nRules: skipped (--skip-rules).");
  }

  if (!skipMigrate) {
    await migrateLegacyStock(str.id);
  } else {
    console.log("\nMigration: skipped (--skip-migrate).");
  }

  console.log(
    dryRun ? "\nDry run complete. Re-run with --apply to commit." : "\nDone."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
