#!/usr/bin/env tsx
/**
 * Configure Oil Extraction facility: 10 parallel lines, godown replenish sources,
 * merge legacy WC-FILTER into WC-OIL, FG → Stock Room.
 *
 *   npm run db:configure-oil-extraction:dev
 *   npm run db:configure-oil-extraction        (container / dist)
 */
import { PrismaClient } from "@prisma/client";
import {
  BIG_GODOWN_CODE,
  EXISTING_FINISHED_GOODS_WH_CODE,
  NEW_GODOWN_CODE,
  OIL_EXTRACTION_LINES,
  oilLineMachine,
  OIL_LOCAL_STORAGE_CODE,
} from "./config/site-layout.js";

const db = new PrismaClient();

const FACILITY_CODE = "WC-OIL";
const LEGACY_FILTER_CODE = "WC-FILTER";

async function main() {
  const prodWh = await db.warehouse.findUnique({
    where: { code: OIL_LOCAL_STORAGE_CODE },
  });
  if (!prodWh) {
    throw new Error(`${OIL_LOCAL_STORAGE_CODE} not found. Run ops:site-setup first.`);
  }

  for (const code of [NEW_GODOWN_CODE, BIG_GODOWN_CODE, EXISTING_FINISHED_GOODS_WH_CODE]) {
    const wh = await db.warehouse.findUnique({ where: { code } });
    if (!wh) console.warn(`  ⚠ Warehouse ${code} not found — seed godowns / stock room first.`);
  }

  let facility = await db.productionFacility.findFirst({
    where: { OR: [{ code: FACILITY_CODE }, { code: "FAC-OIL" }] },
  });
  if (!facility) {
    facility = await db.productionFacility.create({
      data: {
        code: FACILITY_CODE,
        name: "Oil Extraction",
        active: true,
        productionLineWarehouseId: prodWh.id,
        replenishWarehouseCodes: [NEW_GODOWN_CODE, BIG_GODOWN_CODE, OIL_LOCAL_STORAGE_CODE].join(
          ","
        ),
      },
    });
    console.log(`Created facility ${FACILITY_CODE}.`);
  }

  const replenish = [NEW_GODOWN_CODE, BIG_GODOWN_CODE, OIL_LOCAL_STORAGE_CODE].join(",");
  const description =
    "Six extraction lines, three filtering lines, one filling line (demand-driven variants). " +
    "Materials from New Godown, Big Godown, and local line storage; all FG → Stock Room.\n" +
    `[ops] fg=${EXISTING_FINISHED_GOODS_WH_CODE} staging=${OIL_LOCAL_STORAGE_CODE} replenish=${replenish}`;

  await db.productionFacility.update({
    where: { id: facility.id },
    data: {
      code: FACILITY_CODE,
      name: "Oil Extraction",
      description,
      productionLineWarehouseId: prodWh.id,
      replenishWarehouseCodes: replenish,
      active: true,
    },
  });

  for (const lineDef of OIL_EXTRACTION_LINES) {
    const line = await db.productionLine.upsert({
      where: { code: lineDef.code },
      create: {
        code: lineDef.code,
        name: lineDef.name,
        description: `[role=${lineDef.role}]`,
        facilityId: facility.id,
        active: true,
      },
      update: {
        name: lineDef.name,
        description: `[role=${lineDef.role}]`,
        facilityId: facility.id,
        active: true,
      },
    });

    const machine = oilLineMachine(lineDef);
    await db.machine.upsert({
      where: { code: machine.code },
      create: {
        code: machine.code,
        name: machine.name,
        description: machine.description ?? null,
        productionLineId: line.id,
        status: "idle",
        active: true,
      },
      update: {
        name: machine.name,
        description: machine.description ?? null,
        productionLineId: line.id,
        active: true,
      },
    });
  }

  for (const legacy of ["WC-OIL-MAIN", "LINE-OIL-MAIN"]) {
    const old = await db.productionLine.findUnique({ where: { code: legacy } });
    if (old && old.facilityId === facility.id) {
      await db.productionLine.update({
        where: { id: old.id },
        data: { active: false },
      });
      console.log(`  Deactivated legacy line ${legacy}.`);
    }
  }

  const legacyFilter = await db.productionFacility.findUnique({
    where: { code: LEGACY_FILTER_CODE },
  });
  if (legacyFilter) {
    await db.productionFacility.update({
      where: { id: legacyFilter.id },
      data: { active: false },
    });
    for (const ln of await db.productionLine.findMany({
      where: { facilityId: legacyFilter.id },
    })) {
      await db.productionLine.update({
        where: { id: ln.id },
        data: { active: false },
      });
    }
    const filterWh = await db.warehouse.findUnique({ where: { code: "WH-PROD-FILTER" } });
    if (filterWh) {
      const linked = await db.productionFacility.findFirst({
        where: { productionLineWarehouseId: filterWh.id, active: true },
      });
      if (!linked) {
        await db.warehouse.update({ where: { id: filterWh.id }, data: { active: false } });
        console.log("  Deactivated WH-PROD-FILTER.");
      }
    }
    console.log(`  Deactivated legacy facility ${LEGACY_FILTER_CODE}.`);
  }

  console.log(
    `\nOil Extraction (${FACILITY_CODE}): ${OIL_EXTRACTION_LINES.length} lines + ` +
      `${OIL_EXTRACTION_LINES.length} machines, ` +
      `local WH=${OIL_LOCAL_STORAGE_CODE}, replenish=${replenish}, FG→${EXISTING_FINISHED_GOODS_WH_CODE}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
