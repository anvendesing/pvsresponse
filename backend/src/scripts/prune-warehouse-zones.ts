/**
 * Remove bins in zones that are not part of the official warehouse layout.
 *
 *   Farm Shop (WH-FARM): zone A only
 *   Stock Room (STR):    zones A, B, C, D only (D is reserved / may be empty)
 *
 * Also drops bins whose location is not in the canonical layout file
 * (orphan shelves/bins within allowed zones).
 *
 *   npm run db:prune-warehouse-zones:dev
 *   npm run db:prune-warehouse-zones:dev -- --dry-run
 */

import { PrismaClient } from "@prisma/client";
import {
  farmShopBinRows,
  FARM_SHOP_WAREHOUSE_CODE,
} from "../lib/farm-shop-layout.js";
import {
  STOCK_ROOM_WAREHOUSE_CODE,
  stockRoomBinRows,
} from "../lib/stock-room-layout.js";

const dryRun = process.argv.includes("--dry-run");
const db = new PrismaClient();

const ALLOWED_ZONES: Record<string, Set<string>> = {
  [FARM_SHOP_WAREHOUSE_CODE]: new Set(["A"]),
  [STOCK_ROOM_WAREHOUSE_CODE]: new Set(["A", "B", "C", "D"]),
};

/** Zones where orphan bins (not in layout file) should be removed. D is reserved. */
const LAYOUT_PRUNE_ZONES: Record<string, Set<string>> = {
  [FARM_SHOP_WAREHOUSE_CODE]: new Set(["A"]),
  [STOCK_ROOM_WAREHOUSE_CODE]: new Set(["A", "B", "C"]),
};

function layoutKeys(code: string): Set<string> {
  const rows =
    code === FARM_SHOP_WAREHOUSE_CODE
      ? farmShopBinRows()
      : code === STOCK_ROOM_WAREHOUSE_CODE
        ? stockRoomBinRows()
        : [];
  return new Set(rows.map((r) => `${r.zone}/${r.shelf}/${r.bin}`));
}

async function deleteBins(
  whCode: string,
  bins: Array<{
    id: string;
    zone: string;
    shelf: string;
    bin: string;
    code: string | null;
    qty: number;
    reservedQty: number;
  }>,
  reason: string
) {
  if (bins.length === 0) return;

  const totalQty = bins.reduce((s, b) => s + b.qty, 0);
  const totalReserved = bins.reduce((s, b) => s + b.reservedQty, 0);
  const binIds = bins.map((b) => b.id);

  console.log(
    dryRun ? "[DRY RUN] " : "",
    `${whCode}: ${reason} — ${bins.length} bin(s), qty=${totalQty}, reserved=${totalReserved}`
  );
  for (const b of bins.slice(0, 6)) {
    console.log(
      `  ${b.code ?? `${b.zone}/${b.shelf}/${b.bin}`} qty=${b.qty}`
    );
  }
  if (bins.length > 6) console.log(`  … and ${bins.length - 6} more`);

  if (dryRun) return;

  if (totalReserved > 0) {
    console.warn(
      `  WARNING: clearing ${totalReserved} reserved unit(s) on open pick lists for these bins.`
    );
  }

  await db.$transaction(async (tx) => {
    const putawayRules = await tx.putawayRule.findMany({
      where: { toBinId: { in: binIds } },
      select: { id: true },
    });
    const stockRules = await tx.stockRule.findMany({
      where: {
        OR: [
          { monitorBinId: { in: binIds } },
          { sourceBinId: { in: binIds } },
          { toBinId: { in: binIds } },
        ],
      },
      select: { id: true },
    });

    if (stockRules.length > 0) {
      await tx.stockRule.deleteMany({
        where: { id: { in: stockRules.map((r) => r.id) } },
      });
    }
    if (putawayRules.length > 0) {
      await tx.putawayRule.deleteMany({
        where: { id: { in: putawayRules.map((r) => r.id) } },
      });
    }

    await tx.salesOrderReservation.deleteMany({ where: { binId: { in: binIds } } });
    await tx.binCount.deleteMany({ where: { binId: { in: binIds } } });

    const deleted = await tx.bin.deleteMany({ where: { id: { in: binIds } } });
    console.log(
      `  Deleted ${deleted.count} bin(s), ${putawayRules.length} putaway rule(s), ${stockRules.length} stock rule(s).`
    );
  });
}

async function pruneWarehouse(whCode: string) {
  const allowedZones = ALLOWED_ZONES[whCode];
  if (!allowedZones) {
    console.log(`Skip ${whCode} (not configured)`);
    return;
  }

  const wh = await db.warehouse.findUnique({ where: { code: whCode } });
  if (!wh) {
    console.log(`Skip ${whCode} (warehouse not found)`);
    return;
  }

  const allBins = await db.bin.findMany({
    where: { warehouseId: wh.id },
    select: {
      id: true,
      zone: true,
      shelf: true,
      bin: true,
      code: true,
      qty: true,
      reservedQty: true,
    },
  });

  const layout = layoutKeys(whCode);
  const layoutPrune = LAYOUT_PRUNE_ZONES[whCode] ?? new Set<string>();

  const wrongZone = allBins.filter((b) => !allowedZones.has(b.zone.toUpperCase()));
  const orphanInZone = allBins.filter((b) => {
    const z = b.zone.toUpperCase();
    return (
      layoutPrune.has(z) &&
      !layout.has(`${z}/${b.shelf}/${b.bin}`)
    );
  });

  // Normalize zone letter casing in report only; DB may store "a" vs "A"
  await deleteBins(whCode, wrongZone, "disallowed zone");
  await deleteBins(whCode, orphanInZone, "not in layout");

  const remaining = await db.bin.groupBy({
    by: ["zone"],
    where: { warehouseId: wh.id },
    _count: { _all: true },
  });
  console.log(`${whCode} zones after prune:`);
  for (const z of remaining.sort((a, b) => a.zone.localeCompare(b.zone))) {
    console.log(`  ${z.zone}: ${z._count._all} bins`);
  }
}

async function main() {
  console.log(dryRun ? "=== DRY RUN ===" : "=== Prune warehouse zones ===");
  await pruneWarehouse(FARM_SHOP_WAREHOUSE_CODE);
  console.log("");
  await pruneWarehouse(STOCK_ROOM_WAREHOUSE_CODE);
  console.log("\nRe-seed official layout:");
  console.log("  npm run db:seed-farm-shop:dev");
  console.log("  npm run db:seed-stock-room:dev");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
