#!/usr/bin/env tsx
import { db } from "../src/db.js";
import { getEffectiveBinStock } from "../src/lib/stock-rule-pipeline.js";

async function main() {
  const batch = await db.productionOrder.findMany({
    where: { createdAt: { gte: new Date("2026-06-24T08:27:00") } },
    select: {
      orderNo: true,
      plannedQty: true,
      bom: {
        select: {
          product: { select: { sku: true, type: true } },
          variant: { select: { sku: true } },
          revision: true,
        },
      },
    },
    orderBy: { orderNo: "asc" },
  });
  console.log(`MOs since 08:27: ${batch.length}`);

  const semiSkus = batch
    .map((m) => m.bom?.product?.sku)
    .filter((s): s is string => !!s && s.endsWith("-SEMI"));
  console.log(`Semi-finished MOs: ${semiSkus.length}`);

  // Rules for semi products
  const sampleSku = semiSkus[0] ?? "WHET-SEMI";
  const product = await db.product.findFirst({ where: { sku: sampleSku } });
  if (!product) return;

  const rules = await db.stockRule.findMany({
    where: { productId: product.id, triggerType: "mo", active: true },
    include: {
      monitorBin: {
        select: { qty: true, zone: true, shelf: true, bin: true, variantId: true },
      },
      variant: { select: { sku: true } },
    },
  });
  console.log(`\nRules for ${sampleSku}:`, rules.length);
  for (const r of rules) {
    const eff = r.monitorBin
      ? await getEffectiveBinStock(r.monitorBin.qty, r.productId, r.variantId)
      : null;
    console.log(
      `  variant=${r.variant?.sku ?? "null"} min=${r.minQty} max=${r.maxQty}`,
      `bin=${r.monitorBin?.zone}/${r.monitorBin?.shelf}/${r.monitorBin?.bin} qty=${r.monitorBin?.qty}`,
      eff ? `effective=${eff.effective}` : ""
    );
  }

  // Count rules that would fire (bin below min)
  const moRules = await db.stockRule.findMany({
    where: { triggerType: "mo", active: true },
    include: {
      monitorBin: { select: { qty: true } },
      variant: { select: { sku: true } },
      product: { select: { sku: true, type: true } },
    },
  });

  let wouldTrigger = 0;
  let semiTrigger = 0;
  for (const r of moRules) {
    if (!r.monitorBin) continue;
    const eff = await getEffectiveBinStock(
      r.monitorBin.qty,
      r.productId,
      r.variantId
    );
    if (eff.effective < r.minQty) {
      wouldTrigger += 1;
      if (r.product.type === "semi") semiTrigger += 1;
    }
  }
  console.log(`\nActive MO rules: ${moRules.length}`);
  console.log(`Would trigger now (effective < min): ${wouldTrigger} (semi: ${semiTrigger})`);

  // When were rules created
  const ruleDates = await db.stockRule.groupBy({
    by: ["triggerType"],
    where: { active: true },
    _count: true,
  });
  console.log("\nStock rules by trigger:", ruleDates);

  const sampleMo = await db.productionOrder.findFirst({
    where: { orderNo: "MO-2026-2246" },
    include: {
      bom: { select: { revision: true, product: { select: { sku: true } } } },
    },
  });
  if (sampleMo) {
    console.log("\nSample batch MO:", sampleMo.orderNo, sampleMo.bom?.revision, sampleMo.bom?.product?.sku);
  }

  const millRules = await db.stockRule.count({
    where: { triggerType: "mo", active: true, tags: { contains: "grain-milling" } },
  });
  const tallyRules = await db.stockRule.count({
    where: { triggerType: "mo", active: true, tags: { contains: "tally-jit" } },
  });
  console.log(`MO rules: grain-milling=${millRules}, tally-jit=${tallyRules}, other=${187 - millRules - tallyRules}`);
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
