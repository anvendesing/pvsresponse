/**
 * Reset the database to a clean **test** state:
 *
 *   KEEP:  users, warehouses, UoMs, product categories, products, variants,
 *          price lists, BOMs (+ by-products), putaway rules, work centers,
 *          machines, company profile.
 *
 *   CLEAR: customers, vendors, enquiries, all orders (SO/PO/quotes/invoices/
 *          picks/packs/returns/transfers/MOs/GRNs), stock ledger, bins,
 *          stock rules, audit/sync logs, attendance, etc.
 *
 *   SEED:  qty 999 (default) in bins resolved via putaway rules; variant
 *          stockOnHand = 999; parent product stock = sum of variants (or 999
 *          when no variants).
 *
 * Local:
 *   npm run db:reset-test-env
 *   npm run db:reset-test-env -- --qty=500
 *   npm run db:reset-test-env -- --dry-run
 *
 * VPS (compiled):
 *   docker compose exec backend node dist/scripts/reset-test-environment.js
 *   docker compose exec backend node dist/scripts/reset-test-environment.js --qty=999
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
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid --qty= value: ${arg}`);
  }
  return n;
};

const dryRun = process.argv.includes("--dry-run");

/** FK-safe wipe of transactional data; masters listed in file header are kept. */
async function wipeTransactional() {
  console.log("Phase 1 — clearing transactional data (keeping catalog masters)…");

  await db.scanEvent.deleteMany();
  await db.binCount.deleteMany();

  await db.transferOrderItem.deleteMany();
  await db.transferOrder.deleteMany();

  await db.pickListItem.deleteMany();
  await db.pickList.deleteMany();
  await db.packingSlipItem.deleteMany();
  await db.packingSlip.deleteMany();

  await db.salesOrderItem.deleteMany();
  await db.salesOrder.deleteMany();
  await db.quoteRevision.deleteMany();
  await db.quoteItem.deleteMany();
  await db.quote.deleteMany();

  await db.dispatchOrder.deleteMany();
  await db.customerPaymentAllocation.deleteMany();
  await db.customerPayment.deleteMany();
  await db.invoiceItem.deleteMany();
  await db.invoice.deleteMany();

  await db.creditNoteItem.deleteMany();
  await db.creditNote.deleteMany();
  await db.customerReturnItem.deleteMany();
  await db.customerReturn.deleteMany();

  await db.grnItem.deleteMany();
  await db.grn.deleteMany();
  await db.purchaseOrderItem.deleteMany();
  await db.purchaseOrder.deleteMany();

  await db.enquiryItem.deleteMany();
  await db.enquiryActivity.deleteMany();
  await db.enquiry.deleteMany();

  await db.workOrder.deleteMany();
  await db.productionOrder.deleteMany();

  await db.approval.deleteMany();
  await db.trip.deleteMany();
  await db.attendance.deleteMany();

  await db.customerAccount.deleteMany();
  await db.customer.deleteMany();
  await db.vendor.deleteMany();

  await db.stockRule.deleteMany();
  await db.stockLedger.deleteMany();

  // PutawayRule.toBinId → Bin: detach before bin delete (rules are kept).
  await db.putawayRule.updateMany({ data: { toBinId: null } });
  await db.bin.deleteMany();

  await db.auditLog.deleteMany();
  await db.changeLog.deleteMany();
  await db.tombstone.deleteMany();
  await db.syncConflict.deleteMany();
  await db.syncState.deleteMany();
  await db.session.deleteMany();

  console.log("  ✓ transactional tables cleared");
}

type RuleBinSnapshot = {
  ruleId: string;
  warehouseId: string;
  warehouseCode: string;
  zone: string;
  shelf: string;
  binLabel: string;
  code: string | null;
};

/** Capture fixed-bin locations from putaway rules before bins are wiped. */
async function snapshotPutawayBins(): Promise<RuleBinSnapshot[]> {
  const rules = await db.putawayRule.findMany({
    where: { toBinId: { not: null } },
    include: {
      tobin: {
        select: {
          zone: true,
          shelf: true,
          bin: true,
          code: true,
          warehouse: { select: { id: true, code: true } },
        },
      },
    },
  });

  const out: RuleBinSnapshot[] = [];
  for (const r of rules) {
    if (!r.tobin) continue;
    out.push({
      ruleId: r.id,
      warehouseId: r.tobin.warehouse.id,
      warehouseCode: r.tobin.warehouse.code,
      zone: r.tobin.zone,
      shelf: r.tobin.shelf,
      binLabel: r.tobin.bin,
      code: r.tobin.code,
    });
  }
  return out;
}

async function restorePutawayRuleBins(snapshots: RuleBinSnapshot[]) {
  if (snapshots.length === 0) return;
  console.log(`  restoring ${snapshots.length} fixed putaway bin(s)…`);
  for (const s of snapshots) {
    const code =
      s.code ??
      binCodeFromRow(
        { zone: s.zone, shelf: s.shelf, bin: s.binLabel },
        s.warehouseCode
      );
    const row = await db.bin.upsert({
      where: {
        warehouseId_zone_shelf_bin: {
          warehouseId: s.warehouseId,
          zone: s.zone,
          shelf: s.shelf,
          bin: s.binLabel,
        },
      },
      create: {
        warehouseId: s.warehouseId,
        zone: s.zone,
        shelf: s.shelf,
        bin: s.binLabel,
        code,
        productId: null,
        qty: 0,
        reservedQty: 0,
      },
      update: { code },
    });
    await db.putawayRule.update({
      where: { id: s.ruleId },
      data: { toBinId: row.id },
    });
  }
}

const sanitizeBinLabel = (sku: string): string => {
  const base = sku.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12);
  return base || "SKU";
};

/**
 * Ensure a bin exists for receiving stock. Uses putaway resolution first;
 * creates a TEST/AUTO/<sku> slot when no bin is available.
 */
async function ensureBinForReceive(
  productId: string,
  variantId: string | null,
  variantSku: string,
  fallbackWarehouseId: string | null
): Promise<{ binId: string; warehouseId: string; created: boolean } | null> {
  const dest = await resolvePutawayDestination(
    productId,
    variantId,
    fallbackWarehouseId
  );
  if (!dest) return null;

  if (dest.binId) {
    const b = await db.bin.findUnique({ where: { id: dest.binId } });
    if (b) return { binId: b.id, warehouseId: dest.warehouseId, created: false };
  }

  const wh = await db.warehouse.findUnique({
    where: { id: dest.warehouseId },
    select: { id: true, code: true },
  });
  if (!wh) return null;

  const zone = "TEST";
  const shelf = variantId ? "VAR" : "PRD";
  const binLabel = sanitizeBinLabel(variantSku);

  const code = binCodeFromRow({ zone, shelf, bin: binLabel }, wh.code);
  const existing = await db.bin.findUnique({
    where: {
      warehouseId_zone_shelf_bin: {
        warehouseId: wh.id,
        zone,
        shelf,
        bin: binLabel,
      },
    },
  });
  if (existing) {
    return { binId: existing.id, warehouseId: wh.id, created: false };
  }

  const created = await db.bin.create({
    data: {
      warehouseId: wh.id,
      zone,
      shelf,
      bin: binLabel,
      code,
      productId,
      qty: 0,
      reservedQty: 0,
    },
  });
  return { binId: created.id, warehouseId: wh.id, created: true };
}

async function seedOpeningStock(qty: number) {
  console.log(`Phase 3 — seeding opening stock (${qty} per variant / product)…`);

  const storageWh = await db.warehouse.findFirst({
    where: { kind: "storage", active: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true },
  });
  const fallbackWh =
    storageWh ??
    (await db.warehouse.findFirst({
      where: { active: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true },
    }));
  if (!fallbackWh) {
    throw new Error("No warehouse found — create at least one warehouse before reset.");
  }

  const year = new Date().getUTCFullYear();
  let binsTouched = 0;
  let variantsSet = 0;
  let productsSet = 0;
  let skipped = 0;

  const variants = await db.productVariant.findMany({
    where: { active: true, product: { state: "active" } },
    select: { id: true, sku: true, productId: true },
    orderBy: { sku: "asc" },
  });

  for (const v of variants) {
    const slot = await ensureBinForReceive(v.productId, v.id, v.sku, fallbackWh.id);
    if (!slot) {
      console.warn(`  skip variant ${v.sku}: no putaway destination`);
      skipped++;
      continue;
    }

    const ref = `TEST-OPEN-${year}-${v.sku}`;
    if (!dryRun) {
      await db.$transaction([
        db.bin.update({
          where: { id: slot.binId },
          data: { productId: v.productId, qty, reservedQty: 0 },
        }),
        db.productVariant.update({
          where: { id: v.id },
          data: { stockOnHand: qty },
        }),
        db.stockLedger.create({
          data: {
            productId: v.productId,
            warehouseId: slot.warehouseId,
            txnType: "Adjust",
            ref,
            qty,
            balance: qty,
          },
        }),
      ]);
    }
    binsTouched++;
    variantsSet++;
  }

  // Products with no variants: one bin + parent counter.
  const productsNoVariants = await db.product.findMany({
    where: { state: "active", variants: { none: {} } },
    select: { id: true, sku: true },
    orderBy: { sku: "asc" },
  });

  for (const p of productsNoVariants) {
    const slot = await ensureBinForReceive(p.id, null, p.sku, fallbackWh.id);
    if (!slot) {
      console.warn(`  skip product ${p.sku}: no putaway destination`);
      skipped++;
      continue;
    }

    const ref = `TEST-OPEN-${year}-${p.sku}`;
    if (!dryRun) {
      await db.$transaction([
        db.bin.update({
          where: { id: slot.binId },
          data: { productId: p.id, qty, reservedQty: 0 },
        }),
        db.product.update({
          where: { id: p.id },
          data: { stockOnHand: qty },
        }),
        db.stockLedger.create({
          data: {
            productId: p.id,
            warehouseId: slot.warehouseId,
            txnType: "Adjust",
            ref,
            qty,
            balance: qty,
          },
        }),
      ]);
    }
    binsTouched++;
    productsSet++;
  }

  // Parent counters for variant parents = sum of active variant stock.
  if (!dryRun) {
    const parents = await db.product.findMany({
      where: { variants: { some: { active: true } } },
      select: {
        id: true,
        sku: true,
        variants: { where: { active: true }, select: { stockOnHand: true } },
      },
    });
    for (const p of parents) {
      const sum = p.variants.reduce((s, v) => s + v.stockOnHand, 0);
      await db.product.update({
        where: { id: p.id },
        data: { stockOnHand: sum },
      });
    }
  }

  console.log(
    `  ✓ variants seeded: ${variantsSet}  products (no variants): ${productsSet}  bin placements: ${binsTouched}  skipped: ${skipped}`
  );
}

async function main() {
  const qty = parseQty();
  console.log(
    dryRun
      ? `DRY RUN — reset test environment (qty=${qty}, no writes)`
      : `Resetting test environment (qty=${qty})…`
  );

  const binSnapshots = await snapshotPutawayBins();
  console.log(`  captured ${binSnapshots.length} fixed putaway bin location(s)`);

  if (!dryRun) {
    await wipeTransactional();
    await restorePutawayRuleBins(binSnapshots);

    await db.product.updateMany({ data: { stockOnHand: 0 } });
    await db.productVariant.updateMany({ data: { stockOnHand: 0 } });
    console.log("Phase 2 — zeroed product / variant counters");
  } else {
    console.log("Phase 1–2 — skipped (dry run)");
  }

  await seedOpeningStock(qty);

  console.log(
    dryRun
      ? "\nDry run complete. Re-run without --dry-run to apply."
      : "\nDone. Test environment ready — masters kept, transactional data cleared, opening stock loaded."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
