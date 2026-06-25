#!/usr/bin/env tsx
import { db } from "../src/db.js";

async function main() {
  const wss = await db.product.findFirst({ where: { sku: "WSS" } });
  if (!wss) return console.log("WSS not found");

  const bins = await db.bin.findMany({
    where: { productId: wss.id, variantId: null, qty: { gt: 0 } },
    include: { warehouse: { select: { code: true } } },
    orderBy: [{ warehouse: { code: "asc" } }, { qty: "desc" }],
  });

  console.log(`WSS parent bins (${bins.length}):`);
  for (const b of bins) {
    console.log(`  ${b.warehouse.code} ${b.zone}/${b.shelf}/${b.bin} qty=${b.qty}`);
  }

  const oilWh = await db.warehouse.findUnique({ where: { code: "WH-PROD-OIL" } });
  const storWh = await db.warehouse.findUnique({ where: { code: "WH-STOR" } });
  const gdnwWh = await db.warehouse.findUnique({ where: { code: "WH-GDNW" } });

  for (const wh of [oilWh, storWh, gdnwWh]) {
    if (!wh) continue;
    const n = await db.bin.count({
      where: { warehouseId: wh.id, qty: { gte: 1234 }, variantId: null },
    });
    console.log(`${wh.code}: ${n} parent bins @ ≥1234`);
  }
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
