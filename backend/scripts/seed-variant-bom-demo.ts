// Variant-level BOM demo.
//
// Layers on top of seed-multi-level-bom.ts to show how a single
// finished product can have *different* packing per variant. Uses
// the existing 6RKS product (which already has 2 size variants:
// 10 pcs and 30 pcs) and the existing 3-level BOM as the
// product-level default.
//
// This script:
//   1. Creates an "Inner pouch (10 pcs)" and "Inner pouch (30 pcs)"
//      consumable so each variant has a distinguishable component.
//   2. Adds variant-specific BOMs:
//        6RKS [10 pcs variant] - smaller carton (1/24 each), small pouch
//        6RKS [30 pcs variant] - bigger carton  (1/8 each),  big pouch
//   3. Leaves the product-level BOM untouched as the fallback for any
//      future variant that doesn't have its own.
//
// Re-runs are idempotent; the routes endpoint /v1/boms with active=true
// guarantees only one BOM per (productId, variantId) pair stays active.
//
// Usage:  cd backend && npx tsx scripts/seed-variant-bom-demo.ts

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const ensureProduct = async (
  sku: string,
  init: {
    name: string;
    type: string;
    uom: string;
    category: string;
    hsn?: string;
  }
) => {
  const existing = await db.product.findUnique({ where: { sku } });
  if (existing) return existing;
  return db.product.create({
    data: {
      sku,
      name: init.name,
      type: init.type,
      uom: init.uom,
      category: init.category,
      hsn: init.hsn ?? "9999",
      barcode: `BC-${sku}`,
      costPrice: 0,
      sellingPrice: 0,
      batchTracked: false,
    },
  });
};

const upsertVariantBom = async (
  productId: string,
  variantId: string,
  revision: string,
  outputQty: number,
  items: Array<{
    productId: string;
    qty: number;
    uom: string;
    scrapPct?: number;
  }>
) => {
  // Deactivate any existing active BOM for the same scope.
  await db.bom.updateMany({
    where: { productId, variantId, active: true },
    data: { active: false },
  });
  // Look for a previous run's BOM at this exact revision so we can
  // update-in-place rather than spawning revision drift on re-run.
  const existing = await db.bom.findFirst({
    where: { productId, variantId, revision },
  });
  if (existing) {
    await db.bomItem.deleteMany({ where: { bomId: existing.id } });
    return db.bom.update({
      where: { id: existing.id },
      data: {
        outputQty,
        active: true,
        items: {
          create: items.map((it) => ({
            productId: it.productId,
            qty: it.qty,
            uom: it.uom,
            scrapPct: it.scrapPct ?? 0,
          })),
        },
      },
      include: {
        product: { select: { sku: true, name: true } },
        variant: { select: { sku: true, size: true } },
        items: { include: { product: { select: { sku: true, name: true } } } },
      },
    });
  }
  return db.bom.create({
    data: {
      productId,
      variantId,
      revision,
      outputQty,
      active: true,
      items: {
        create: items.map((it) => ({
          productId: it.productId,
          qty: it.qty,
          uom: it.uom,
          scrapPct: it.scrapPct ?? 0,
        })),
      },
    },
    include: {
      product: { select: { sku: true, name: true } },
      variant: { select: { sku: true, size: true } },
      items: { include: { product: { select: { sku: true, name: true } } } },
    },
  });
};

async function main() {
  console.log("==> Locating finished product with variants");
  const root = await db.product.findFirst({
    where: { sku: "6RKS" },
    include: { variants: { orderBy: { sku: "asc" } } },
  });
  if (!root) {
    throw new Error(
      "Product 6RKS not found - run db:seed and import-pricelists first."
    );
  }
  if (root.variants.length < 2) {
    throw new Error(
      `Product ${root.sku} has only ${root.variants.length} variant(s); need >=2.`
    );
  }
  // The price-list importer creates variants with active=false. The
  // BOM-editor UI (and the variants-with-boms endpoint) only shows
  // active variants, so flip them on for the demo.
  for (const v of root.variants) {
    if (!v.active) {
      await db.productVariant.update({
        where: { id: v.id },
        data: { active: true },
      });
      v.active = true;
    }
  }
  console.log(
    `    using ${root.sku} (${root.name}) with ${root.variants.length} variants:`
  );
  for (const v of root.variants) {
    console.log(`      ${v.sku.padEnd(22)} size=${v.size}`);
  }

  console.log("==> Ensuring variant-specific packing components exist");
  // The whole point of variant-level BOMs is that pack sizes drive
  // *different* packing. We model that explicitly with two different
  // pouch products.
  const smallPouch = await ensureProduct("CONS-POUCH-SM", {
    name: "Inner pouch (small) - for 10pcs packs",
    type: "consumable",
    uom: "Pcs",
    category: "Packaging",
    hsn: "3923",
  });
  const largePouch = await ensureProduct("CONS-POUCH-LG", {
    name: "Inner pouch (large) - for 30pcs packs",
    type: "consumable",
    uom: "Pcs",
    category: "Packaging",
    hsn: "3923",
  });
  // Re-use the carton + shrink seeded by seed-multi-level-bom.ts so
  // the variant BOM walks into the same downstream raw materials.
  const carton = await db.product.findUnique({
    where: { sku: "CONS-CTN-12" },
  });
  const shrink = await db.product.findUnique({
    where: { sku: "CONS-SHRINK" },
  });
  const filledBottle = await db.product.findUnique({
    where: { sku: "SEMI-FB-1L" },
  });
  if (!carton || !shrink || !filledBottle) {
    throw new Error(
      "Run scripts/seed-multi-level-bom.ts first - this demo layers on top of it."
    );
  }

  console.log("==> Building variant-specific BOMs");
  // For 10pcs variant: 10 finished items per pack -> use 1 small
  // pouch + 1/24 carton (smaller carton holds 24 packs of 10) + a
  // bit less shrink.
  const v10 = root.variants.find((v) => /10\s*pcs/i.test(v.size ?? "")) ??
    root.variants[0];
  const v30 = root.variants.find((v) => /30\s*pcs/i.test(v.size ?? "")) ??
    root.variants[1];

  await upsertVariantBom(root.id, v10.id, "Rev-1.0", 1, [
    // The actual product is a "bundle of N filled bottles" - for the
    // demo we approximate one filled bottle per pack so the explosion
    // walks down through the existing sub-assembly chain.
    { productId: filledBottle.id, qty: 1, uom: filledBottle.uom },
    { productId: smallPouch.id, qty: 1, uom: smallPouch.uom, scrapPct: 1 },
    { productId: carton.id, qty: 1 / 24, uom: carton.uom, scrapPct: 2 },
    { productId: shrink.id, qty: 0.2, uom: shrink.uom, scrapPct: 5 },
  ]);
  console.log(`    created variant BOM for ${v10.sku} (size: ${v10.size})`);

  await upsertVariantBom(root.id, v30.id, "Rev-1.0", 1, [
    { productId: filledBottle.id, qty: 1, uom: filledBottle.uom },
    { productId: largePouch.id, qty: 1, uom: largePouch.uom, scrapPct: 1 },
    { productId: carton.id, qty: 1 / 8, uom: carton.uom, scrapPct: 2 },
    { productId: shrink.id, qty: 0.5, uom: shrink.uom, scrapPct: 5 },
  ]);
  console.log(`    created variant BOM for ${v30.sku} (size: ${v30.size})`);

  console.log("==> Stocking the new pouch components");
  const wh = await db.warehouse.findFirst({ where: { active: true } });
  if (!wh) throw new Error("No active warehouse");
  for (const [productId, qty, capacity] of [
    [smallPouch.id, 4000, 8000],
    [largePouch.id, 2000, 4000],
  ] as const) {
    let bin = await db.bin.findFirst({
      where: { warehouseId: wh.id, productId },
    });
    if (!bin) {
      bin = await db.bin.findFirst({
        where: { warehouseId: wh.id, productId: null, qty: 0 },
        orderBy: [
          { zone: "asc" },
          { rack: "asc" },
          { shelf: "asc" },
          { bin: "asc" },
        ],
      });
    }
    if (!bin) {
      console.warn(`    ! no bin for product ${productId}`);
      continue;
    }
    await db.bin.update({
      where: { id: bin.id },
      data: { productId, qty, capacity, occupied: qty },
    });
  }

  console.log("==> Done. Try in the UI:");
  console.log("    Manufacturing -> Manage BOMs -> 6RKS");
  console.log("    You should now see THREE BOMs for 6RKS:");
  console.log("      * 6RKS [default]   Rev-2.0  (product-level fallback)");
  console.log(`      * 6RKS [${v10.size}]  Rev-1.0  (variant-specific)`);
  console.log(`      * 6RKS [${v30.size}]  Rev-1.0  (variant-specific)`);
  console.log("");
  console.log("    Click 'Clone…' on any of them to copy to other variants.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
