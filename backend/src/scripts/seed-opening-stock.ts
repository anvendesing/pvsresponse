/**
 * Seed opening stock (qty 1234) and putaway rules from floor-walk bin map.
 *
 *   npm run db:seed-opening-stock:dev
 *   npm run db:seed-opening-stock:dev -- --dry-run
 *   npm run db:seed-opening-stock:dev -- --putaway-only   # rules only, no stock touch
 *   npm run db:seed-opening-stock:dev -- --keep-putaway-rules  # skip clearing STR/WH-FARM rules first
 */
import { PrismaClient } from "@prisma/client";
import { applyBinReassign } from "../lib/bin-stock-update.js";
import {
  binCandidates,
  OPENING_STOCK_QTY,
  parseOpeningStockAssignments,
  shelfCandidates,
} from "../lib/opening-stock-assignments.js";
import { FARM_SHOP_WAREHOUSE_CODE } from "../lib/farm-shop-layout.js";
import { STOCK_ROOM_WAREHOUSE_CODE } from "../lib/stock-room-layout.js";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const putawayOnly = process.argv.includes("--putaway-only");
const keepPutawayRules = process.argv.includes("--keep-putaway-rules");

const PUTAWAY_WAREHOUSE_CODES = [STOCK_ROOM_WAREHOUSE_CODE, FARM_SHOP_WAREHOUSE_CODE];

async function systemUserId(): Promise<string> {
  const user =
    (await db.user.findFirst({ where: { username: "admin" }, select: { id: true } })) ??
    (await db.user.findFirst({ select: { id: true } }));
  if (!user) throw new Error("No user found for bin count audit trail.");
  return user.id;
}

async function findBin(
  warehouseId: string,
  zone: string,
  shelf: string,
  bin: string
) {
  for (const s of shelfCandidates(shelf)) {
    for (const b of binCandidates(bin)) {
      const row = await db.bin.findUnique({
        where: {
          warehouseId_zone_shelf_bin: { warehouseId, zone, shelf: s, bin: b },
        },
      });
      if (row) return row;
    }
  }
  return null;
}

async function clearStrAndFarmPutawayRules(): Promise<number> {
  const warehouses = await db.warehouse.findMany({
    where: { code: { in: PUTAWAY_WAREHOUSE_CODES } },
    select: { id: true, code: true },
  });
  const ids = warehouses.map((w) => w.id);
  if (ids.length === 0) return 0;

  if (dryRun) {
    const count = await db.putawayRule.count({
      where: { toWarehouseId: { in: ids } },
    });
    console.log(
      `[dry] Would delete ${count} putaway rule(s) for ${warehouses.map((w) => w.code).join(", ")}`
    );
    return count;
  }

  const deleted = await db.putawayRule.deleteMany({
    where: { toWarehouseId: { in: ids } },
  });
  console.log(
    `Cleared ${deleted.count} putaway rule(s) for ${warehouses.map((w) => w.code).join(", ")}.`
  );
  return deleted.count;
}

async function createPutawayRule(opts: {
  productId: string;
  variantId: string;
  warehouseId: string;
  binId: string;
  notes: string;
}) {
  await db.putawayRule.create({
    data: {
      productId: opts.productId,
      variantId: opts.variantId,
      toWarehouseId: opts.warehouseId,
      toBinId: opts.binId,
      priority: 10,
      active: true,
      notes: opts.notes,
    },
  });
}

async function main() {
  const rows = parseOpeningStockAssignments();
  console.log(
    dryRun
      ? `DRY RUN — ${rows.length} opening-stock row(s) @ qty ${OPENING_STOCK_QTY}${putawayOnly ? " (putaway only)" : ""}`
      : `${putawayOnly ? "Putaway rules" : "Seeding"} for ${rows.length} opening-stock row(s) @ qty ${OPENING_STOCK_QTY}…\n`
  );

  if (!keepPutawayRules) {
    await clearStrAndFarmPutawayRules();
  } else {
    console.log("Keeping existing STR / WH-FARM putaway rules (--keep-putaway-rules).\n");
  }

  const whByCode = new Map<string, string>();
  const userId = dryRun ? "dry-run" : await systemUserId();
  const putawayDone = new Set<string>();

  let stockOk = 0;
  let putawayOk = 0;
  let skipped = 0;

  for (const row of rows) {
    let warehouseId = whByCode.get(row.warehouseCode);
    if (!warehouseId) {
      const wh = await db.warehouse.findUnique({
        where: { code: row.warehouseCode },
        select: { id: true },
      });
      if (!wh) {
        console.warn(`  ⚠ Warehouse ${row.warehouseCode} not found — skipped ${row.variantSku}`);
        skipped++;
        continue;
      }
      warehouseId = wh.id;
      whByCode.set(row.warehouseCode, warehouseId);
    }

    const variant = await db.productVariant.findUnique({
      where: { sku: row.variantSku },
      select: { id: true, productId: true, sku: true },
    });
    if (!variant) {
      console.warn(`  ⚠ Variant ${row.variantSku} not in catalog — skipped`);
      skipped++;
      continue;
    }

    const bin = await findBin(warehouseId, row.zone, row.shelf, row.bin);
    if (!bin) {
      console.warn(
        `  ⚠ Bin missing ${row.warehouseCode} ${row.zone}/${row.shelf}/${row.bin} — skipped ${row.variantSku}`
      );
      skipped++;
      continue;
    }

    const loc = `${row.zone}/${bin.shelf}/${bin.bin}`;
    const putawayKey = `${variant.id}::${warehouseId}`;

    if (dryRun) {
      console.log(
        `  [dry] ${row.variantSku} → ${row.warehouseCode} ${loc}${putawayOnly ? "" : ` ×${row.qty}`}`
      );
      if (!putawayOnly) stockOk++;
      if (!putawayDone.has(putawayKey)) {
        putawayDone.add(putawayKey);
        putawayOk++;
      }
      continue;
    }

    if (!putawayOnly) {
      await applyBinReassign(bin, {
        productId: variant.productId,
        variantId: variant.id,
        qty: row.qty,
        reasonCode: "physical_match",
        remarks: `Opening stock floor walk (${row.variantSku})`,
        userId,
      });
      stockOk++;
      console.log(`  ✓ stock ${row.variantSku} → ${row.warehouseCode} ${loc} ×${row.qty}`);
    }

    if (!putawayDone.has(putawayKey)) {
      await createPutawayRule({
        productId: variant.productId,
        variantId: variant.id,
        warehouseId,
        binId: bin.id,
        notes: `Opening stock putaway → ${row.warehouseCode} ${loc}`,
      });
      putawayDone.add(putawayKey);
      putawayOk++;
      if (putawayOnly) {
        console.log(`  ✓ putaway ${row.variantSku} → ${row.warehouseCode} ${loc}`);
      }
    }
  }

  console.log(
    `\nDone. stock=${stockOk} putawayRules=${putawayOk} skipped=${skipped}` +
      (dryRun ? " (dry run)" : "")
  );
  if (!dryRun && !putawayOnly && stockOk > 0) {
    console.log("Tip: npm run db:sync-stock:dev to refresh product counters.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
