/**
 * Remove all bins (and stock) in a Stock Room (STR) zone — legacy putaway bins
 * or bins no longer in the official layout.
 *
 *   npm run db:clear-stock-room-zone:dev -- A
 *   npm run db:clear-stock-room-zone:dev -- B --dry-run
 *
 * Clears reservations, putaway/stock rules, then deletes bin rows.
 */

import { PrismaClient } from "@prisma/client";
import { STOCK_ROOM_WAREHOUSE_CODE } from "../src/lib/stock-room-layout.js";

const dryRun = process.argv.includes("--dry-run");
const zoneArg = process.argv.find((a) => /^[A-D]$/i.test(a));
const zone = (zoneArg ?? "A").toUpperCase();
const db = new PrismaClient();

async function main() {
  const wh = await db.warehouse.findUnique({
    where: { code: STOCK_ROOM_WAREHOUSE_CODE },
  });
  if (!wh) {
    throw new Error(`Warehouse ${STOCK_ROOM_WAREHOUSE_CODE} not found`);
  }

  const bins = await db.bin.findMany({
    where: { warehouseId: wh.id, zone },
    select: { id: true, shelf: true, bin: true, code: true, qty: true, reservedQty: true },
  });

  if (bins.length === 0) {
    console.log(`Stock Room (${wh.code}): zone ${zone} is already empty.`);
    return;
  }

  const totalQty = bins.reduce((s, b) => s + b.qty, 0);
  const totalReserved = bins.reduce((s, b) => s + b.reservedQty, 0);
  const binIds = bins.map((b) => b.id);

  const putawayRules = await db.putawayRule.findMany({
    where: { toBinId: { in: binIds } },
    select: { id: true },
  });

  console.log(
    dryRun ? "[DRY RUN] " : "",
    `Stock Room zone ${zone}: ${bins.length} bin(s), qty=${totalQty}, reserved=${totalReserved},`,
    `${putawayRules.length} putaway rule(s) to remove`
  );
  for (const b of bins.slice(0, 8)) {
    console.log(`  ${b.code ?? `${zone}/${b.shelf}/${b.bin}`} qty=${b.qty}`);
  }
  if (bins.length > 8) console.log(`  … and ${bins.length - 8} more`);

  if (dryRun) return;

  await db.$transaction(async (tx) => {
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
      await tx.stockRule.deleteMany({ where: { id: { in: stockRules.map((r) => r.id) } } });
    }

    if (putawayRules.length > 0) {
      await tx.putawayRule.deleteMany({ where: { id: { in: putawayRules.map((r) => r.id) } } });
    }

    await tx.salesOrderReservation.deleteMany({ where: { binId: { in: binIds } } });
    await tx.binCount.deleteMany({ where: { binId: { in: binIds } } });

    const deleted = await tx.bin.deleteMany({ where: { id: { in: binIds } } });
    console.log(
      `Deleted ${deleted.count} zone ${zone} bin(s), ${putawayRules.length} putaway rule(s), ${stockRules.length} stock rule(s).`
    );
  });

  console.log(`Zone ${zone} is now clear.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
