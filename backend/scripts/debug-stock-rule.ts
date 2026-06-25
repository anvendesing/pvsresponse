import { db } from "../src/db.js";
import { checkAllStockRules, checkGlobalPoStockRules } from "../src/lib/stock-rules.js";
import { getEffectiveProductStock } from "../src/lib/stock-rule-pipeline.js";

const q = process.argv[2]?.toUpperCase() ?? "RAJWN";

const products = await db.product.findMany({
  where: {
    OR: [
      { sku: { contains: q } },
      { name: { contains: q } },
    ],
  },
  select: { id: true, sku: true, name: true, uom: true },
});

console.log("Products matching", q, ":", products.length);
for (const p of products) {
  console.log(`\n=== ${p.sku} · ${p.name} ===`);
  const bins = await db.bin.findMany({
    where: { productId: p.id },
    select: {
      id: true,
      zone: true,
      shelf: true,
      bin: true,
      qty: true,
      warehouse: { select: { code: true } },
    },
  });
  const total = bins.reduce((s, b) => s + b.qty, 0);
  const effective = await getEffectiveProductStock(p.id, null);
  console.log(`Bins: ${bins.length}, total qty: ${total}`);
  console.log(
    `Effective stock: ${effective.effective} (${effective.onHand} on hand` +
      (effective.poPipeline ? ` + ${effective.poPipeline} PO pipeline` : "") +
      (effective.moPipeline ? ` + ${effective.moPipeline} MO pipeline` : "") +
      ")"
  );
  for (const b of bins.filter((x) => x.qty > 0).slice(0, 8)) {
    console.log(`  ${b.warehouse.code} ${b.zone}/${b.shelf}/${b.bin}: ${b.qty}`);
  }

  const rules = await db.stockRule.findMany({
    where: { productId: p.id },
    include: {
      vendor: { select: { code: true, name: true } },
      monitorBin: { select: { id: true, qty: true } },
    },
  });
  console.log(`Stock rules: ${rules.length}`);
  for (const r of rules) {
    console.log(
      `  [${r.active ? "active" : "OFF"}] ${r.triggerType} min=${r.minQty} max=${r.maxQty ?? "—"} vendor=${r.vendor?.code ?? "—"} monitorBin=${r.monitorBinId ?? "global"}`
    );
    if (r.triggerType === "po" && r.vendorId) {
      const vp = await db.vendorProduct.findFirst({
        where: {
          vendorId: r.vendorId,
          productId: p.id,
          variantId: r.variantId,
          active: true,
        },
      });
      console.log(`    vendor catalog: ${vp ? `yes (${vp.vendorUom}, pack=${vp.packSize})` : "MISSING"}`);
    }
  }

  const openPos = await db.purchaseOrder.findMany({
    where: {
      status: "draft",
      items: { some: { productId: p.id } },
    },
    select: { poNo: true, notes: true, vendor: { select: { code: true } } },
  });
  if (openPos.length) {
    console.log("Open POs with this product:");
    for (const po of openPos) console.log(`  ${po.poNo} · ${po.vendor.code} · ${po.notes?.slice(0, 60)}`);
  }
}

console.log("\n--- Running checkGlobalPoStockRules ---");
const results = await checkGlobalPoStockRules(null);

for (const p of products) {
  const ruleIds = (
    await db.stockRule.findMany({ where: { productId: p.id }, select: { id: true } })
  ).map((r) => r.id);
  const hits = results.filter((r) => ruleIds.includes(r.ruleId));
  if (hits.length) {
    console.log(`\nPO check results for ${p.sku}:`);
    for (const h of hits) {
      console.log(
        `  rule …${h.ruleId.slice(-6)}: ${h.created ? `TRIGGERED → ${h.created.documentNo}` : h.skippedReason ?? "no action"}`
      );
    }
  }
}

console.log("\n--- Full checkAllStockRules summary ---");
const all = await checkAllStockRules(null);
const triggered = all.filter((r) => r.created);
console.log(`Checked ${all.length}, triggered ${triggered.length}`);
for (const r of all.filter((x) => !x.created && x.skippedReason !== "above_min")) {
  console.log(`  skip ${r.ruleId.slice(-6)} (${r.triggerType}): ${r.skippedReason}`);
}

await db.$disconnect();
