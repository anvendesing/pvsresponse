#!/usr/bin/env tsx
import { db } from "../src/db.js";

async function main() {
  const to = await db.transferOrder.findFirst({
    where: { transferNo: "TRF-2026-2201" },
    include: {
      items: {
        include: {
          product: { select: { sku: true, name: true, uom: true } },
          variant: { select: { sku: true, size: true } },
          fromBin: { include: { warehouse: { select: { code: true } } } },
          tobin: { include: { warehouse: { select: { code: true } } } },
        },
      },
      fromWarehouse: { select: { code: true, name: true } },
      toWarehouse: { select: { code: true, name: true } },
      productionOrder: { select: { orderNo: true } },
    },
  });
  console.log("TO:", JSON.stringify(to, null, 2));

  if (!to?.items[0]) return;
  const pid = to.items[0].productId;
  const wss = await db.product.findUnique({
    where: { id: pid },
    select: { id: true, sku: true, name: true },
  });
  console.log("\nProduct:", wss);

  const rules = await db.stockRule.findMany({
    where: { productId: pid, active: true },
    include: {
      sourceBin: {
        select: {
          id: true,
          zone: true,
          shelf: true,
          bin: true,
          qty: true,
          productId: true,
          variantId: true,
          warehouse: { select: { code: true } },
        },
      },
      monitorBin: {
        select: {
          id: true,
          zone: true,
          shelf: true,
          bin: true,
          qty: true,
          warehouse: { select: { code: true } },
        },
      },
    },
  });
  console.log("\nStock rules:", JSON.stringify(rules, null, 2));

  const parentBins = await db.bin.findMany({
    where: { productId: pid, variantId: null, qty: { gt: 0 } },
    include: { warehouse: { select: { code: true, kind: true } } },
  });
  const variantBins = await db.bin.findMany({
    where: { productId: pid, variantId: { not: null }, qty: { gt: 0 } },
    include: {
      warehouse: { select: { code: true, kind: true } },
      variant: { select: { sku: true } },
    },
  });
  console.log("\nParent bins with qty:", parentBins.length);
  for (const b of parentBins.slice(0, 10)) {
    console.log(`  ${b.warehouse.code} ${b.zone}/${b.shelf}/${b.bin} qty=${b.qty}`);
  }
  console.log("Variant bins with qty:", variantBins.length);
  for (const b of variantBins.slice(0, 10)) {
    console.log(
      `  ${b.warehouse.code} ${b.zone}/${b.shelf}/${b.bin} ${b.variant?.sku} qty=${b.qty}`
    );
  }
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
