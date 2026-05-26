// Seed a multi-level BOM demo on top of the existing seed data.
//
// What this does:
//   1. Picks one finished product (preferably a coconut-oil variant
//      since the catalog has variants there).
//   2. Creates two NEW intermediate "semi" products that don't exist
//      yet and need to be made: a "Filled bottle" sub-assembly and
//      an "Oil blend" sub-sub-assembly.
//   3. Wires up a 3-level BOM:
//        Finished pack
//          -> Filled bottle (semi, has its own BOM)
//               -> Oil blend (semi, has its own BOM)
//                     -> Coconut oil (raw)
//                     -> Vitamin E premix (consumable)
//               -> PET bottle 1L (raw)
//               -> Cap with seal (raw)
//          -> Carton box (consumable)
//          -> Shrink wrap (consumable)
//
// Re-runs cleanly: if the demo products already exist, items are
// regenerated rather than duplicated.
//
// Usage:  cd backend && npx tsx scripts/seed-multi-level-bom.ts

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
  // barcode is unique-required on Product. Use SKU-based barcode so
  // re-runs are deterministic and barcode collisions are impossible.
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

const replaceBom = async (
  productId: string,
  revision: string,
  outputQty: number,
  items: Array<{ productId: string; qty: number; uom: string; scrapPct?: number }>
) => {
  // Update-in-place when an existing BOM is found, else create.
  // Plain delete fails the moment a downstream production order
  // references the BOM (FK constraint) - update-in-place avoids that
  // entire class of P2003 errors and keeps existing MO history valid.
  const existing = await db.bom.findFirst({ where: { productId } });
  if (existing) {
    await db.bomItem.deleteMany({ where: { bomId: existing.id } });
    await db.bom.update({
      where: { id: existing.id },
      data: {
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
    });
    return db.bom.findUnique({
      where: { id: existing.id },
      include: {
        product: { select: { sku: true, name: true } },
        items: { include: { product: { select: { sku: true, name: true } } } },
      },
    });
  }
  return db.bom.create({
    data: {
      productId,
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
      items: { include: { product: { select: { sku: true, name: true } } } },
    },
  });
};

async function main() {
  console.log("==> Locating finished product to use as the demo root");
  // Prefer a finished bottle of coconut oil if present.
  const finished =
    (await db.product.findFirst({
      where: {
        OR: [
          { sku: { contains: "COIL-1L" } },
          { sku: { contains: "COIL" } },
          { type: "finished" },
        ],
      },
      orderBy: { sku: "asc" },
    })) ?? null;
  if (!finished) {
    throw new Error(
      "No finished product found in the catalog. Run `npm run db:seed` first."
    );
  }
  console.log(`    using ${finished.sku} - ${finished.name}`);

  console.log("==> Ensuring intermediate + leaf demo products exist");
  const oilBlend = await ensureProduct("SEMI-OBL-1L", {
    name: "Oil blend (1 L) - vitamin-fortified",
    type: "semi",
    uom: "Ltr",
    category: "Intermediates",
    hsn: "1513",
  });
  const filledBottle = await ensureProduct("SEMI-FB-1L", {
    name: "Filled bottle (1 L) - capped",
    type: "semi",
    uom: "Pcs",
    category: "Intermediates",
    hsn: "3923",
  });
  const rawOil = await ensureProduct("RAW-COCO-OIL", {
    name: "Coconut oil (bulk crude)",
    type: "raw",
    uom: "Ltr",
    category: "Edible Oils",
    hsn: "1513",
  });
  const vitaminMix = await ensureProduct("CONS-VITAMIN-E", {
    name: "Vitamin E premix",
    type: "consumable",
    uom: "Ltr",
    category: "Additives",
    hsn: "2936",
  });
  const bottle = await ensureProduct("RAW-BOT-1L", {
    name: "PET bottle 1 L (clear)",
    type: "raw",
    uom: "Pcs",
    category: "Packaging",
    hsn: "3923",
  });
  const cap = await ensureProduct("RAW-CAP-S38", {
    name: "Cap with safety seal (38 mm)",
    type: "raw",
    uom: "Pcs",
    category: "Packaging",
    hsn: "3923",
  });
  const carton = await ensureProduct("CONS-CTN-12", {
    name: "Carton box (holds 12 bottles)",
    type: "consumable",
    uom: "Pcs",
    category: "Packaging",
    hsn: "4819",
  });
  const shrink = await ensureProduct("CONS-SHRINK", {
    name: "Shrink wrap (per metre)",
    type: "consumable",
    uom: "Mtr",
    category: "Packaging",
    hsn: "3920",
  });

  console.log("==> Wiring 3-level BOM");

  // Level 3 (deepest): Oil blend = coconut oil + vitamin premix
  await replaceBom(oilBlend.id, "Rev-1.0", 1, [
    { productId: rawOil.id, qty: 0.99, uom: rawOil.uom, scrapPct: 1 },
    { productId: vitaminMix.id, qty: 0.01, uom: vitaminMix.uom, scrapPct: 0 },
  ]);

  // Level 2: Filled bottle = oil blend + bottle + cap
  await replaceBom(filledBottle.id, "Rev-1.0", 1, [
    { productId: oilBlend.id, qty: 1.0, uom: oilBlend.uom, scrapPct: 0 },
    { productId: bottle.id, qty: 1, uom: bottle.uom, scrapPct: 1 },
    { productId: cap.id, qty: 1, uom: cap.uom, scrapPct: 0.5 },
  ]);

  // Level 1 (root): Finished pack = filled bottle + carton + shrink
  // (Carton holds 12, so 1/12 per bottle pack; shrink ~0.3 m per bottle.)
  await replaceBom(finished.id, "Rev-2.0", 1, [
    { productId: filledBottle.id, qty: 1, uom: filledBottle.uom, scrapPct: 0 },
    { productId: carton.id, qty: 1 / 12, uom: carton.uom, scrapPct: 2 },
    { productId: shrink.id, qty: 0.3, uom: shrink.uom, scrapPct: 5 },
  ]);

  console.log("==> Seeding raw stock so MOs can actually be issued");
  const wh = await db.warehouse.findFirst({ where: { active: true } });
  if (!wh) throw new Error("No active warehouse - run db:seed first.");
  const placements: Array<[string, number, number]> = [
    [rawOil.id, 1500, 5000],
    [vitaminMix.id, 50, 500],
    [bottle.id, 5000, 8000],
    [cap.id, 5000, 8000],
    [carton.id, 800, 1500],
    [shrink.id, 5000, 8000],
  ];

  // For each placement: refill an existing bin if the product is
  // already placed (idempotent re-runs), otherwise grab the next
  // empty bin in the warehouse.
  for (const [productId, qty, capacity] of placements) {
    let bin = await db.bin.findFirst({
      where: { warehouseId: wh.id, productId },
      orderBy: { qty: "desc" },
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
      console.warn(`    ! no bin available for product ${productId}; skipping`);
      continue;
    }
    await db.bin.update({
      where: { id: bin.id },
      data: { productId, qty, capacity, occupied: qty },
    });
    await db.stockLedger.create({
      data: {
        productId,
        warehouseId: wh.id,
        bin: `${bin.zone}/${bin.rack}/${bin.shelf}/${bin.bin}`,
        txnType: "in",
        ref: "DEMO-MULTI-LEVEL-BOM",
        qty,
        balance: qty,
      },
    });
  }

  console.log("==> Done. Try:");
  console.log(`    GET  /v1/boms?productId=${finished.id}`);
  console.log(`    GET  /v1/products/${finished.id}/where-used`);
  console.log(
    `    GET  /v1/boms/<bomId>/tree?qty=100   (the root BOM you just created)`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
