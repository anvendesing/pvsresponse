/**
 * Backfill one default operation per BOM (Odoo-style legacy single-step).
 *
 *   npm run db:backfill-bom-operations:dev
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const boms = await db.bom.findMany({
    include: { operations: true, items: true },
  });
  let created = 0;
  let linked = 0;

  for (const bom of boms) {
    if (bom.operations.length > 0) continue;

    const op = await db.bomOperation.create({
      data: {
        bomId: bom.id,
        seq: 1,
        name: "Manufacture",
        description: "Auto-created for legacy single-step BOM",
        facilityId: bom.defaultFacilityId,
        lineId: bom.defaultLineId,
        machineId: bom.defaultMachineId,
        requiresQa: false,
      },
    });
    created++;

    if (bom.items.length > 0) {
      const r = await db.bomItem.updateMany({
        where: { bomId: bom.id, bomOperationId: null },
        data: { bomOperationId: op.id },
      });
      linked += r.count;
    }
  }

  console.log(`Backfill complete: ${created} operations created, ${linked} items linked.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
