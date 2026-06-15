/**
 * backfill-production-facilities.ts
 *
 * Migrates the legacy single-level WorkCenter model to the new two-level
 * ProductionFacility → ProductionLine structure.
 *
 * Run once after the schema migration:
 *   npx ts-node scripts/backfill-production-facilities.ts
 *
 * What it does:
 *   1. For every ProductionFacility (formerly WorkCenter), create one default
 *      ProductionLine named "<Facility Name> – Main Line".
 *   2. Machines: set productionLineId to the default line of the facility they
 *      were previously assigned to (via the legacy workCenterId column).
 *   3. BOMs: copy defaultWorkCenterId → defaultFacilityId; set defaultLineId
 *      to the default line of that facility.
 *   4. ProductionOrders (open/planned/in-progress): set facilityId by matching
 *      the legacy station string to facility name; leave lineId = null so
 *      supervisors assign them. Completed MOs get lineId = default line.
 *   5. WorkOrders: open WOs get lineId = null; completed WOs get lineId from
 *      the parent MO's assigned line.
 *
 * Safe to re-run: skips rows that already have the new FK populated.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Backfill: ProductionFacility → ProductionLine migration ===\n");

  // -----------------------------------------------------------------------
  // Step 1 — Create a default ProductionLine for every ProductionFacility
  //           that doesn't already have one.
  // -----------------------------------------------------------------------
  const facilities = await prisma.productionFacility.findMany();
  console.log(`Found ${facilities.length} production facilities.`);

  const facilityToDefaultLine: Record<string, string> = {};

  for (const facility of facilities) {
    // Check whether a line already exists for this facility.
    const existing = await prisma.productionLine.findFirst({
      where: { facilityId: facility.id },
      orderBy: { createdAt: "asc" },
    });

    if (existing) {
      facilityToDefaultLine[facility.id] = existing.id;
      console.log(
        `  Facility "${facility.name}": default line already exists → "${existing.name}" (${existing.id})`
      );
    } else {
      const defaultLine = await prisma.productionLine.create({
        data: {
          code: `${facility.code}-MAIN`,
          name: `${facility.name} – Main Line`,
          facilityId: facility.id,
          capacityPerHour: facility.capacityPerHour ?? undefined,
          active: facility.active,
        },
      });
      facilityToDefaultLine[facility.id] = defaultLine.id;
      console.log(
        `  Facility "${facility.name}": created default line → "${defaultLine.name}" (${defaultLine.id})`
      );
    }
  }

  // -----------------------------------------------------------------------
  // Step 2 — Machines: set productionLineId from workCenterId (legacy).
  // -----------------------------------------------------------------------
  console.log("\n--- Machines ---");
  const machines = await prisma.machine.findMany();
  let machineUpdated = 0;

  for (const m of machines) {
    if (m.productionLineId) {
      // Already migrated.
      continue;
    }
    if (!m.workCenterId) {
      console.warn(`  Machine "${m.name}" (${m.id}): no workCenterId — skipping.`);
      continue;
    }
    const defaultLineId = facilityToDefaultLine[m.workCenterId];
    if (!defaultLineId) {
      console.warn(
        `  Machine "${m.name}": workCenterId ${m.workCenterId} not found in facilities — skipping.`
      );
      continue;
    }
    await prisma.machine.update({
      where: { id: m.id },
      data: { productionLineId: defaultLineId },
    });
    machineUpdated++;
  }
  console.log(`  Updated ${machineUpdated} machine(s).`);

  // -----------------------------------------------------------------------
  // Step 3 — BOMs: copy defaultWorkCenterId → defaultFacilityId + defaultLineId.
  // -----------------------------------------------------------------------
  console.log("\n--- BOMs ---");
  const boms = await prisma.bom.findMany();
  let bomUpdated = 0;

  for (const bom of boms) {
    if (bom.defaultFacilityId) {
      // Already migrated.
      continue;
    }
    if (!bom.defaultWorkCenterId) {
      // BOM had no work-center default — leave it without a facility default too.
      continue;
    }
    const defaultLineId = facilityToDefaultLine[bom.defaultWorkCenterId] ?? null;
    await prisma.bom.update({
      where: { id: bom.id },
      data: {
        defaultFacilityId: bom.defaultWorkCenterId,
        defaultLineId: defaultLineId,
      },
    });
    bomUpdated++;
  }
  console.log(`  Updated ${bomUpdated} BOM(s).`);

  // -----------------------------------------------------------------------
  // Step 4 — ProductionOrders: set facilityId by matching station name.
  //   Open MOs (planned | in-progress | qc | delayed): lineId = null
  //   Completed MOs: lineId = default line of the facility
  // -----------------------------------------------------------------------
  console.log("\n--- Production Orders ---");

  // Build a name→id map for fast station lookup (case-insensitive).
  const facilityByName: Record<string, string> = {};
  for (const f of facilities) {
    facilityByName[f.name.toLowerCase().trim()] = f.id;
  }

  const productionOrders = await prisma.productionOrder.findMany();
  let moUpdated = 0;
  const moLineMap: Record<string, string | null> = {}; // moId → lineId

  for (const mo of productionOrders) {
    if (mo.facilityId) {
      // Already migrated — remember the line for WO pass.
      moLineMap[mo.id] = mo.lineId;
      continue;
    }

    const facilityId =
      facilityByName[mo.station.toLowerCase().trim()] ?? null;

    const isCompleted = mo.status === "completed";
    const lineId =
      isCompleted && facilityId
        ? (facilityToDefaultLine[facilityId] ?? null)
        : null;

    await prisma.productionOrder.update({
      where: { id: mo.id },
      data: { facilityId: facilityId ?? undefined, lineId },
    });
    moLineMap[mo.id] = lineId;
    moUpdated++;
  }
  console.log(`  Updated ${moUpdated} production order(s).`);

  // -----------------------------------------------------------------------
  // Step 5 — WorkOrders: set lineId from parent MO's assigned line.
  //   Open WOs: lineId = null (supervisor will assign later)
  //   Completed WOs: lineId = parent MO's lineId
  // -----------------------------------------------------------------------
  console.log("\n--- Work Orders ---");
  const workOrders = await prisma.workOrder.findMany();
  let woUpdated = 0;

  for (const wo of workOrders) {
    if (wo.lineId) {
      continue;
    }
    const isCompleted = wo.status === "complete";
    const parentLineId = moLineMap[wo.productionOrderId] ?? null;
    const lineId = isCompleted ? parentLineId : null;

    await prisma.workOrder.update({
      where: { id: wo.id },
      data: { lineId },
    });
    woUpdated++;
  }
  console.log(`  Updated ${woUpdated} work order(s).`);

  console.log("\n=== Backfill complete ===");
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
