#!/usr/bin/env tsx
/**
 * Seed machines for Milling Room and Flour Mill production lines.
 * Ensures WC-FLOUR facility + line exist (idempotent).
 *
 *   npm run db:configure-mill-machines:dev
 *   npm run db:configure-mill-machines        (container / dist)
 */
import {
  EXISTING_FINISHED_GOODS_WH_CODE,
  FLOUR_MILL_LINE_MACHINES,
  MILLING_LINE_MACHINES,
} from "./config/site-layout.js";
import { db, releaseProductionLineWarehouse, upsertProductionFacility } from "./lib/db.js";

const FLOUR_FACILITY_CODE = "WC-FLOUR";
const FLOUR_LINE_CODE = "WC-FLOUR-MAIN";
const FLOUR_WH_CODE = "WH-PROD-FLOUR";

const LINE_MACHINES: Array<{
  lineCodes: string[];
  machines: readonly { code: string; name: string; description?: string }[];
}> = [
  { lineCodes: ["WC-MILL-MAIN", "LINE-MILL-MAIN"], machines: MILLING_LINE_MACHINES },
  { lineCodes: [FLOUR_LINE_CODE, "LINE-FLOUR-MAIN"], machines: FLOUR_MILL_LINE_MACHINES },
];

async function ensureFlourFacility() {
  const prodWh = await db.warehouse.findUnique({ where: { code: FLOUR_WH_CODE } });
  if (!prodWh) {
    throw new Error(`${FLOUR_WH_CODE} not found — run ops:warehouses first.`);
  }

  const replenish = "WH-STO-MILLETS,WH-STO-OILSEEDS";
  const description =
    "Flour, spice and ravva grinding; temporary FG on facility WH; putaway TO to finished-goods warehouse.\n" +
    `[ops] fg=${EXISTING_FINISHED_GOODS_WH_CODE} staging=${FLOUR_WH_CODE} replenish=${replenish}`;

  const facility = await upsertProductionFacility({
    code: FLOUR_FACILITY_CODE,
    name: "Flour Mill",
    description,
    productionLineWarehouseId: prodWh.id,
    replenishWarehouseCodes: replenish,
  });
  if (!facility) return;

  await db.productionLine.upsert({
    where: { code: FLOUR_LINE_CODE },
    create: {
      code: FLOUR_LINE_CODE,
      name: "Main Line",
      facilityId: facility.id,
      active: true,
    },
    update: {
      name: "Main Line",
      facilityId: facility.id,
      active: true,
    },
  });
}

async function findLine(codes: string[]) {
  for (const code of codes) {
    const line = await db.productionLine.findUnique({ where: { code } });
    if (line) return line;
  }
  return null;
}

async function seedLineMachines(
  lineCodes: string[],
  machines: readonly { code: string; name: string; description?: string }[]
) {
  const line = await findLine(lineCodes);
  if (!line) {
    throw new Error(
      `Production line not found (${lineCodes.join(" / ")}) — run ops:site-setup first.`
    );
  }

  for (const m of machines) {
    await db.machine.upsert({
      where: { code: m.code },
      create: {
        code: m.code,
        name: m.name,
        description: m.description ?? null,
        productionLineId: line.id,
        status: "idle",
        active: true,
      },
      update: {
        name: m.name,
        description: m.description ?? null,
        productionLineId: line.id,
        active: true,
      },
    });
  }

  console.log(`  ✓ ${line.code}: ${machines.length} machine(s)`);
}

async function main() {
  console.log("Configure Milling Room + Flour Mill machines…\n");

  await ensureFlourFacility();

  for (const { lineCodes, machines } of LINE_MACHINES) {
    await seedLineMachines(lineCodes, machines);
  }

  console.log(
    `\nDone — ${MILLING_LINE_MACHINES.length} milling + ${FLOUR_MILL_LINE_MACHINES.length} flour mill machines.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
