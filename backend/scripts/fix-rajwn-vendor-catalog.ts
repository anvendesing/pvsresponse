/**
 * Add VEND-HERB catalog line for RAJWN (if missing) and run PO stock-rule check.
 *   npx tsx scripts/fix-rajwn-vendor-catalog.ts
 */
import { db } from "../src/db.js";
import { checkGlobalPoStockRules } from "../src/lib/stock-rules.js";

const product = await db.product.findUnique({ where: { sku: "RAJWN" } });
if (!product) throw new Error("Product RAJWN not found");

const vendor = await db.vendor.findUnique({ where: { code: "VEND-HERB" } });
if (!vendor) throw new Error("Vendor VEND-HERB not found");

let vp = await db.vendorProduct.findFirst({
  where: { vendorId: vendor.id, productId: product.id, variantId: null },
});

if (!vp) {
  vp = await db.vendorProduct.create({
    data: {
      vendorId: vendor.id,
      productId: product.id,
      vendorProductCode: "HI-AJWN-25KG",
      vendorProductName: "Raw Ajwain (whole)",
      vendorUom: "bag",
      packSize: 25,
      price: 3200,
      minOrderQty: 1,
      priority: 100,
      active: true,
    },
  });
  console.log("Created vendor catalog line for RAJWN on VEND-HERB");
} else {
  console.log("Catalog line already exists");
}

const results = await checkGlobalPoStockRules(null);
const rule = await db.stockRule.findFirst({
  where: { productId: product.id, triggerType: "po", active: true },
});
const hit = rule ? results.find((r) => r.ruleId === rule.id) : null;
console.log("PO check:", hit?.created ? `created ${hit.created.documentNo}` : hit?.skippedReason ?? "none");

const po = await db.purchaseOrder.findFirst({
  where: {
    vendorId: vendor.id,
    status: "draft",
    items: { some: { productId: product.id } },
  },
  include: { items: { include: { product: { select: { sku: true } } } } },
});
if (po) {
  console.log(`Draft PO ${po.poNo}:`, po.items.map((i) => `${i.product.sku} qty=${i.qty}`).join(", "));
}

await db.$disconnect();
