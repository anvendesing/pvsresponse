#!/usr/bin/env tsx
/**
 * Repair TRF-2026-2208: RRUP landed on RSBWT shared WH/00/00 bin.
 *
 *   npx tsx scripts/fix-trf-2208-rrup-stock.ts --dry-run
 *   npx tsx scripts/fix-trf-2208-rrup-stock.ts --apply
 */
import { db } from "../src/db.js";
import { productBulkShelf, resolveOrCreateLocationBin } from "../src/lib/location-bin.js";

const apply = process.argv.includes("--apply");
const TRF_NO = "TRF-2026-2208";
const QTY = 200;
const WRONG_BIN_ID = "cmqs1vjmz0001g47f5sw1to33";

async function main() {
  const trf = await db.transferOrder.findFirst({
    where: { transferNo: TRF_NO },
    include: {
      items: { include: { product: { select: { id: true, sku: true } } } },
      toWarehouse: { select: { id: true, code: true, scanPrefix: true } },
    },
  });
  if (!trf) throw new Error(`${TRF_NO} not found`);

  const item = trf.items[0];
  if (!item || item.product.sku !== "RRUP") {
    throw new Error("Expected RRUP line on transfer");
  }

  const wrongBin = await db.bin.findUnique({
    where: { id: WRONG_BIN_ID },
    include: { product: { select: { sku: true } } },
  });
  if (!wrongBin) throw new Error("Wrong bin not found");

  const correctPath = {
    zone: "WH",
    shelf: productBulkShelf("RRUP"),
  };

  console.log("Wrong bin:", {
    code: wrongBin.code,
    product: wrongBin.product?.sku,
    qty: wrongBin.qty,
  });
  console.log("Will move", QTY, "RRUP to", `${correctPath.zone}/${correctPath.shelf}/00`);

  if (!apply) {
    console.log("\nRe-run with --apply");
    return;
  }

  await db.$transaction(async (tx) => {
    await tx.bin.update({
      where: { id: wrongBin.id },
      data: { qty: { decrement: QTY } },
    });

    let rrupBin = await tx.bin.findFirst({
      where: {
        warehouseId: trf.toWarehouseId,
        zone: correctPath.zone,
        shelf: correctPath.shelf,
        bin: "00",
      },
    });
    if (!rrupBin) {
      rrupBin = await resolveOrCreateLocationBin(tx, trf.toWarehouse, correctPath);
    }

    await tx.bin.update({
      where: { id: rrupBin.id },
      data: {
        qty: { increment: QTY },
        productId: item.productId,
        variantId: item.variantId,
      },
    });

    await tx.transferOrderItem.update({
      where: { id: item.id },
      data: { toBinId: rrupBin.id },
    });
  });

  const after = await db.bin.findMany({
    where: {
      warehouseId: trf.toWarehouseId,
      OR: [{ id: wrongBin.id }, { productId: item.productId }],
    },
    include: { product: { select: { sku: true } } },
  });
  console.log("\nAfter repair:");
  for (const b of after) {
    console.log(`  ${b.product?.sku ?? "—"} ${b.zone}/${b.shelf}/${b.bin} qty=${b.qty}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
