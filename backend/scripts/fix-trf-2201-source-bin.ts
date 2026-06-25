#!/usr/bin/env tsx
import { db } from "../src/db.js";
import { findReplenishmentSourceBin } from "../src/lib/facility-ops.js";

async function main() {
  const to = await db.transferOrder.findFirst({
    where: { transferNo: "TRF-2026-2201" },
    include: { items: true },
  });
  if (!to?.items[0]) {
    console.log("TRF-2026-2201 not found");
    return;
  }
  const item = to.items[0];
  if (item.fromBinId) {
    console.log("Already has fromBinId:", item.fromBinId);
    return;
  }

  const srcBin = await findReplenishmentSourceBin(
    item.productId,
    [],
    item.qtyRequested
  );
  if (!srcBin) {
    console.log("No source bin with enough qty");
    return;
  }

  const wh = await db.warehouse.findUnique({
    where: { id: srcBin.warehouseId },
    select: { code: true },
  });

  await db.transferOrder.update({
    where: { id: to.id },
    data: {
      fromWarehouseId: srcBin.warehouseId,
      items: {
        update: {
          where: { id: item.id },
          data: { fromBinId: srcBin.id },
        },
      },
    },
  });

  console.log(
    `Assigned ${wh?.code} ${srcBin.zone}/${srcBin.shelf}/${srcBin.bin} (qty ${srcBin.qty}) for ${item.qtyRequested} kg WSS`
  );
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
