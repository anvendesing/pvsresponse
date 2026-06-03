/**
 * Seed opening stock for active variants / products that currently have
 * zero (or missing) stock in bins.
 *
 * Safe to run on a live server — does NOT clear customers, orders, or any
 * other transactional data. Only creates bins and stock-ledger entries for
 * items that have no quantity yet.
 *
 * Usage:
 *   Local dev:
 *     npm run db:seed-stock
 *     npm run db:seed-stock -- --qty=500
 *     npm run db:seed-stock -- --dry-run
 *
 *   VPS (inside the container):
 *     docker compose exec backend node dist/scripts/seed-opening-stock.js
 *     docker compose exec backend node dist/scripts/seed-opening-stock.js --qty=500
 *     docker compose exec backend node dist/scripts/seed-opening-stock.js --dry-run
 */

import { PrismaClient } from "@prisma/client";
import { binCodeFromRow } from "../lib/codes.js";
import { resolvePutawayDestination } from "../lib/putaway.js";

const db = new PrismaClient();

const DEFAULT_QTY = 999;

const parseQty = (): number => {
  const arg = process.argv.find((a) => a.startsWith("--qty="));
  if (!arg) return DEFAULT_QTY;
  const n = parseInt(arg.slice("--qty=".length), 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid --qty= value: ${arg}`);
  return n;
};

const dryRun = process.argv.includes("--dry-run");

const sanitizeBinLabel = (sku: string): string => {
  const base = sku.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12);
  return base || "SKU";
};

/**
 * Find or create the bin for a product/variant using putaway rules.
 * Falls back to a TEST/AUTO/<sku> slot when no rule exists.
 */
async function ensureBin(
  productId: string,
  variantId: string | null,
  sku: string,
  fallbackWhId: string
): Promise<{ binId: string; warehouseId: string } | null> {
  const dest = await resolvePutawayDestination(productId, variantId, fallbackWhId);
  if (!dest) return null;

  if (dest.binId) {
    const b = await db.bin.findUnique({ where: { id: dest.binId } });
    if (b) return { binId: b.id, warehouseId: dest.warehouseId };
  }

  const wh = await db.warehouse.findUnique({
    where: { id: dest.warehouseId },
    select: { id: true, code: true },
  });
  if (!wh) return null;

  const zone = "STOCK";
  const shelf = variantId ? "VAR" : "PRD";
  const binLabel = sanitizeBinLabel(sku);
  const code = binCodeFromRow({ zone, shelf, bin: binLabel }, wh.code);

  const existing = await db.bin.findUnique({
    where: { warehouseId_zone_shelf_bin: { warehouseId: wh.id, zone, shelf, bin: binLabel } },
  });
  if (existing) return { binId: existing.id, warehouseId: wh.id };

  if (dryRun) return { binId: "(new)", warehouseId: wh.id };

  const created = await db.bin.create({
    data: { warehouseId: wh.id, zone, shelf, bin: binLabel, code, productId, qty: 0, reservedQty: 0 },
  });
  return { binId: created.id, warehouseId: wh.id };
}

async function main() {
  const qty = parseQty();
  console.log(
    dryRun
      ? `DRY RUN — seed opening stock (qty=${qty}, no writes)`
      : `Seeding opening stock (qty=${qty}) for zero-stock items…`
  );

  // Prefer any storage warehouse as fallback; else first active warehouse.
  const fallbackWh =
    (await db.warehouse.findFirst({ where: { kind: "storage", active: true }, orderBy: { code: "asc" }, select: { id: true } })) ??
    (await db.warehouse.findFirst({ where: { active: true }, orderBy: { code: "asc" }, select: { id: true } }));

  if (!fallbackWh) {
    console.error("No warehouses found. Run ops:site-setup first.");
    process.exit(1);
  }

  const year = new Date().getUTCFullYear();
  let seeded = 0;
  let skipped = 0;
  let noBin = 0;

  // ── Variants ──────────────────────────────────────────────────────────────
  const variants = await db.productVariant.findMany({
    where: { active: true, product: { state: "active" } },
    select: { id: true, sku: true, productId: true, stockOnHand: true },
    orderBy: { sku: "asc" },
  });

  for (const v of variants) {
    if (v.stockOnHand > 0) {
      console.log(`  skip  ${v.sku}  (already has ${v.stockOnHand})`);
      skipped++;
      continue;
    }

    const slot = await ensureBin(v.productId, v.id, v.sku, fallbackWh.id);
    if (!slot) {
      console.warn(`  no-bin  ${v.sku}  (no putaway rule — add one in Settings)`);
      noBin++;
      continue;
    }

    console.log(`  seed  ${v.sku}  → bin ${slot.binId}  qty=${qty}${dryRun ? " [dry]" : ""}`);
    if (!dryRun) {
      const ref = `OPEN-${year}-${v.sku}`;
      await db.$transaction([
        db.bin.update({ where: { id: slot.binId }, data: { productId: v.productId, qty, reservedQty: 0 } }),
        db.productVariant.update({ where: { id: v.id }, data: { stockOnHand: qty } }),
        db.stockLedger.create({ data: { productId: v.productId, warehouseId: slot.warehouseId, txnType: "Adjust", ref, qty, balance: qty } }),
      ]);
    }
    seeded++;
  }

  // ── Products without variants ──────────────────────────────────────────────
  const products = await db.product.findMany({
    where: { state: "active", variants: { none: {} } },
    select: { id: true, sku: true, stockOnHand: true },
    orderBy: { sku: "asc" },
  });

  for (const p of products) {
    if (p.stockOnHand > 0) {
      console.log(`  skip  ${p.sku}  (already has ${p.stockOnHand})`);
      skipped++;
      continue;
    }

    const slot = await ensureBin(p.id, null, p.sku, fallbackWh.id);
    if (!slot) {
      console.warn(`  no-bin  ${p.sku}  (no putaway rule)`);
      noBin++;
      continue;
    }

    console.log(`  seed  ${p.sku}  → bin ${slot.binId}  qty=${qty}${dryRun ? " [dry]" : ""}`);
    if (!dryRun) {
      const ref = `OPEN-${year}-${p.sku}`;
      await db.$transaction([
        db.bin.update({ where: { id: slot.binId }, data: { productId: p.id, qty, reservedQty: 0 } }),
        db.product.update({ where: { id: p.id }, data: { stockOnHand: qty } }),
        db.stockLedger.create({ data: { productId: p.id, warehouseId: slot.warehouseId, txnType: "Adjust", ref, qty, balance: qty } }),
      ]);
    }
    seeded++;
  }

  // ── Update parent counters for variant products ────────────────────────────
  if (!dryRun) {
    const parents = await db.product.findMany({
      where: { variants: { some: { active: true } } },
      select: { id: true, variants: { where: { active: true }, select: { stockOnHand: true } } },
    });
    for (const p of parents) {
      const sum = p.variants.reduce((s, v) => s + v.stockOnHand, 0);
      await db.product.update({ where: { id: p.id }, data: { stockOnHand: sum } });
    }
  }

  console.log(`\nDone.  seeded=${seeded}  already-had-stock=${skipped}  no-putaway-bin=${noBin}`);
  if (noBin > 0) {
    console.log(`  → Run "ops:site-setup:dist" first to create putaway rules, then re-run this script.`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
