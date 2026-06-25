#!/usr/bin/env tsx
import { db } from "../src/db.js";

async function main() {
  const moCount = await db.productionOrder.count();
  const byStatus = await db.productionOrder.groupBy({
    by: ["status"],
    _count: true,
  });
  const moRules = await db.stockRule.count({
    where: { triggerType: "mo", active: true },
  });
  const tallyRules = await db.stockRule.count({
    where: { triggerType: "mo", active: true, tags: { contains: "tally-jit" } },
  });

  const recent = await db.productionOrder.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      orderNo: true,
      status: true,
      plannedQty: true,
      createdAt: true,
      bom: {
        select: {
          revision: true,
          product: { select: { sku: true } },
          variant: { select: { sku: true } },
        },
      },
    },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayCount = await db.productionOrder.count({
    where: { createdAt: { gte: today } },
  });

  console.log("Total MOs:", moCount);
  console.log("Created today:", todayCount);
  console.log("By status:", byStatus);
  console.log("Active MO stock rules:", moRules, `(tally-jit: ${tallyRules})`);
  console.log("\nRecent MOs:");
  for (const m of recent) {
    const sku = m.bom?.variant?.sku ?? m.bom?.product?.sku ?? "?";
    console.log(
      `  ${m.orderNo}  ${m.status.padEnd(12)}  ${sku.padEnd(20)}  qty=${m.plannedQty}  ${m.createdAt.toISOString().slice(0, 19)}`
    );
  }

  // Sample: rules where monitor bin qty is below min (would trigger MO)
  const lowRules = await db.stockRule.findMany({
    where: { triggerType: "mo", active: true },
    include: {
      monitorBin: { select: { qty: true, zone: true, shelf: true, bin: true } },
      variant: { select: { sku: true } },
    },
    take: 5,
  });
  console.log("\nSample MO rules (first 5):");
  for (const r of lowRules) {
    const eff = r.monitorBin?.qty ?? 0;
    console.log(
      `  ${r.variant?.sku ?? r.productId.slice(0, 8)}  min=${r.minQty}  binQty=${eff}  below=${eff < r.minQty}`
    );
  }
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
