#!/usr/bin/env tsx
/**
 * Hard-delete all inactive (active=false) warehouses and their empty layout data.
 *
 *   npx tsx scripts/purge-inactive-warehouses.ts
 *   npx tsx scripts/purge-inactive-warehouses.ts --dry-run
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const inactive = await db.warehouse.findMany({
    where: { active: false },
    orderBy: { code: "asc" },
    include: {
      _count: { select: { bins: true, ledger: true } },
      productionFacility: { select: { code: true } },
    },
  });

  console.log(`Found ${inactive.length} inactive warehouse(s)${dryRun ? " (dry run)" : ""}`);
  if (inactive.length === 0) return;

  let deleted = 0;
  let failed = 0;

  for (const wh of inactive) {
    const transfers = await db.transferOrder.findMany({
      where: {
        OR: [{ fromWarehouseId: wh.id }, { toWarehouseId: wh.id }],
      },
      select: { id: true, transferNo: true, status: true },
    });

    const blocking = transfers.filter((t) => !["done", "cancelled"].includes(t.status));
    if (blocking.length > 0) {
      console.log(
        `  SKIP (open transfer orders): ${summary} — ${blocking.map((t) => t.transferNo).join(", ")}`
      );
      failed++;
      continue;
    }

    const summary = `${wh.code} · ${wh.name} · bins=${wh._count.bins} ledger=${wh._count.ledger} transfers=${transfers.length}`;

    if (dryRun) {
      console.log(`  WOULD DELETE: ${summary}`);
      deleted++;
      continue;
    }

    try {
      await db.$transaction(async (tx) => {
        if (transfers.length > 0) {
          const ids = transfers.map((t) => t.id);
          await tx.transferOrderItem.deleteMany({
            where: { transferOrderId: { in: ids } },
          });
          await tx.transferOrder.deleteMany({ where: { id: { in: ids } } });
        }
        await tx.productionFacility.updateMany({
          where: { productionLineWarehouseId: wh.id },
          data: { productionLineWarehouseId: null },
        });
        await tx.putawayRule.deleteMany({ where: { toWarehouseId: wh.id } });
        await tx.stockRule.deleteMany({ where: { toWarehouseId: wh.id } });
        await tx.stockLot.deleteMany({ where: { warehouseId: wh.id } });
        await tx.stockLedger.deleteMany({ where: { warehouseId: wh.id } });

        const binIds = (
          await tx.bin.findMany({
            where: { warehouseId: wh.id },
            select: { id: true },
          })
        ).map((b) => b.id);

        if (binIds.length > 0) {
          await tx.pickListItem.updateMany({
            where: { binId: { in: binIds } },
            data: { binId: null },
          });
          await tx.salesOrderReservation.deleteMany({
            where: { binId: { in: binIds } },
          });
          await tx.binCount.deleteMany({ where: { binId: { in: binIds } } });
          await tx.putawayRule.updateMany({
            where: { toBinId: { in: binIds } },
            data: { toBinId: null },
          });
          await tx.stockRule.updateMany({
            where: { toBinId: { in: binIds } },
            data: { toBinId: null },
          });
        }

        await tx.bin.deleteMany({ where: { warehouseId: wh.id } });
        await tx.warehouse.delete({ where: { id: wh.id } });
      });
      console.log(`  DELETED: ${summary}`);
      deleted++;
    } catch (e) {
      console.log(`  FAILED: ${summary} — ${(e as Error).message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${deleted} removed, ${failed} skipped/failed`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
