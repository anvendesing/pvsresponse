#!/usr/bin/env tsx
/**
 * Fix TRF-2026-2207: point source to STR A/S031/02 where RSBWT actually sits.
 *
 *   npx tsx scripts/fix-trf-2207-source.ts --dry-run
 *   npx tsx scripts/fix-trf-2207-source.ts --apply
 */
import { db } from "../src/db.js";
import { STOCK_ROOM_WAREHOUSE_CODE } from "../src/lib/stock-room-layout.js";

const apply = process.argv.includes("--apply");
const TRF_NO = "TRF-2026-2207";
const MO_NO = "MO-2026-2260";
const RAW_SKU = "RSBWT";
const STR_BIN = { zone: "A", shelf: "S031", bin: "02" };

async function main() {
  const trf = await db.transferOrder.findFirst({
    where: { transferNo: TRF_NO },
    include: {
      fromWarehouse: { select: { code: true } },
      toWarehouse: { select: { code: true } },
      items: { include: { product: { select: { sku: true } } } },
    },
  });
  if (!trf) throw new Error(`${TRF_NO} not found`);

  const strWh = await db.warehouse.findUnique({
    where: { code: STOCK_ROOM_WAREHOUSE_CODE },
    select: { id: true, code: true },
  });
  if (!strWh) throw new Error(`${STOCK_ROOM_WAREHOUSE_CODE} not found`);

  const srcBin = await db.bin.findFirst({
    where: {
      warehouseId: strWh.id,
      zone: STR_BIN.zone,
      shelf: STR_BIN.shelf,
      bin: STR_BIN.bin,
      product: { sku: RAW_SKU },
    },
    select: { id: true, code: true, qty: true },
  });
  if (!srcBin) throw new Error(`No ${RAW_SKU} bin at STR ${STR_BIN.zone}/${STR_BIN.shelf}/${STR_BIN.bin}`);

  console.log("Current:", {
    from: trf.fromWarehouse.code,
    to: trf.toWarehouse.code,
    item: trf.items[0]?.product.sku,
    fromBinId: trf.items[0]?.fromBinId,
  });
  console.log("Correct source:", {
    warehouse: strWh.code,
    bin: srcBin.code,
    qty: srcBin.qty,
  });

  const millFacility = await db.productionFacility.findFirst({
    where: { code: "WC-MILL" },
    select: { id: true, replenishWarehouseCodes: true },
  });

  const replenish = "WH-STOR,WH-STO-MILLETS,WH-STO-OILSEEDS,STR";
  if (millFacility && millFacility.replenishWarehouseCodes !== replenish) {
    console.log(`WC-MILL replenish: ${millFacility.replenishWarehouseCodes ?? "(null)"} → ${replenish}`);
  }

  if (!apply) {
    console.log("\nRe-run with --apply to commit.");
    return;
  }

  await db.transferOrder.update({
    where: { id: trf.id },
    data: { fromWarehouseId: strWh.id },
  });
  await db.transferOrderItem.update({
    where: { id: trf.items[0]!.id },
    data: { fromBinId: srcBin.id },
  });

  if (millFacility) {
    await db.productionFacility.update({
      where: { id: millFacility.id },
      data: { replenishWarehouseCodes: replenish },
    });
  }

  console.log(`\n✓ ${TRF_NO} source → ${strWh.code} ${srcBin.code}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
