#!/usr/bin/env tsx
/**
 * Point WC-VACUUM at Stock Room (STR) zone A — no separate WH-PROD-VACUUM.
 *
 *   npm run db:configure-vacuum-stock-room:dev
 *   npm run db:configure-vacuum-stock-room        (container / dist)
 */
import { PrismaClient } from "@prisma/client";
import { EXISTING_FINISHED_GOODS_WH_CODE } from "./config/site-layout.js";

import { EXISTING_FINISHED_GOODS_WH_CODE } from "./config/site-layout.js";

const MANUAL_PACK_LINE_CODE = "WC-STR-PACK-MANUAL";
const VACUUM_LINE_CODE = "WC-VACUUM-MAIN";

const db = new PrismaClient();

async function ensureStrPackLines(facilityId: string) {
  for (const [code, name] of [
    [VACUUM_LINE_CODE, "Vacuum Packing – Main Line"],
    [MANUAL_PACK_LINE_CODE, "Manual Packing Line"],
  ] as const) {
    await db.productionLine.upsert({
      where: { code },
      create: { code, name, facilityId, active: true },
      update: { name, facilityId, active: true },
    });
  }
  console.log(`  ✓ STR pack lines: ${VACUUM_LINE_CODE}, ${MANUAL_PACK_LINE_CODE}`);
}

async function main() {
  const str = await db.warehouse.findUnique({
    where: { code: EXISTING_FINISHED_GOODS_WH_CODE },
  });
  if (!str) {
    throw new Error(`Stock Room warehouse ${EXISTING_FINISHED_GOODS_WH_CODE} not found.`);
  }

  const fac = await db.productionFacility.findFirst({
    where: { OR: [{ code: "WC-VACUUM" }, { code: "FAC-VACUUM" }] },
    include: { productionLineWarehouse: { select: { code: true } } },
  });
  if (!fac) {
    console.log("SKIP: WC-VACUUM facility not found.");
    return;
  }

  const prevWh = fac.productionLineWarehouse?.code ?? "none";
  const replenish = `${EXISTING_FINISHED_GOODS_WH_CODE},WH-STO-COLD-1,WH-STO-COLD-2`;
  await db.productionFacility.update({
    where: { id: fac.id },
    data: {
      code: "WC-VACUUM",
      productionLineWarehouseId: str.id,
      productionZone: "A",
      replenishWarehouseCodes: replenish,
      description:
        "Vacuum and manual retail packing in Stock Room zone A. Bulk flour arrives via TO from Flour Mill.\n" +
        `[ops] fg=${EXISTING_FINISHED_GOODS_WH_CODE} staging=${EXISTING_FINISHED_GOODS_WH_CODE} zone=A replenish=${replenish}`,
    },
  });

  await ensureStrPackLines(fac.id);

  const legacyProdWh = await db.warehouse.findUnique({
    where: { code: "WH-PROD-VACUUM" },
  });
  if (legacyProdWh && legacyProdWh.id !== str.id) {
    const stillLinked = await db.productionFacility.findFirst({
      where: { productionLineWarehouseId: legacyProdWh.id, active: true },
    });
    if (!stillLinked) {
      await db.warehouse.update({
        where: { id: legacyProdWh.id },
        data: { active: false },
      });
      console.log("Deactivated unused warehouse WH-PROD-VACUUM.");
    }
  }

  console.log(`WC-VACUUM: production warehouse ${prevWh} → ${str.code}, productionZone=A`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
