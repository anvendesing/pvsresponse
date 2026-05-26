/**
 * Export catalog master data (products, variants, price lists, bins, stock)
 * to a portable JSON file for import on another server.
 *
 * Usage (local machine):
 *   cd backend
 *   npx tsx scripts/export-catalog.ts
 *   npx tsx scripts/export-catalog.ts --out data/my-export.json
 */
import { writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const outArg = process.argv.find((a) => a.startsWith("--out="));
const outPath = resolve(
  outArg?.slice("--out=".length) ?? "data/catalog-export.json"
);

async function main() {
  console.log("Exporting catalog…");

  const warehouses = await db.warehouse.findMany({
    orderBy: { code: "asc" },
    select: { code: true, name: true, city: true, active: true },
  });

  const products = await db.product.findMany({
    orderBy: { sku: "asc" },
    include: {
      variants: { orderBy: { sku: "asc" } },
    },
  });

  const priceLists = await db.priceList.findMany({
    orderBy: { code: "asc" },
    include: {
      items: {
        include: {
          product: { select: { sku: true } },
          variant: { select: { sku: true } },
        },
        orderBy: [{ productId: "asc" }, { minQty: "asc" }],
      },
    },
  });

  const bins = await db.bin.findMany({
    orderBy: [{ warehouseId: "asc" }, { zone: "asc" }, { rack: "asc" }],
    include: {
      warehouse: { select: { code: true } },
      product: { select: { sku: true } },
    },
  });

  const stockLedger = await db.stockLedger.findMany({
    orderBy: { date: "asc" },
    include: {
      product: { select: { sku: true } },
      warehouse: { select: { code: true } },
    },
  });

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    counts: {
      warehouses: warehouses.length,
      products: products.length,
      variants: products.reduce((n, p) => n + p.variants.length, 0),
      priceLists: priceLists.length,
      priceListItems: priceLists.reduce((n, pl) => n + pl.items.length, 0),
      bins: bins.length,
      stockLedger: stockLedger.length,
    },
    warehouses,
    products: products.map((p) => ({
      sku: p.sku,
      name: p.name,
      type: p.type,
      uom: p.uom,
      barcode: p.barcode,
      state: p.state,
      category: p.category,
      hsn: p.hsn,
      costPrice: p.costPrice,
      sellingPrice: p.sellingPrice,
      reorderLevel: p.reorderLevel,
      stockOnHand: p.stockOnHand,
      batchTracked: p.batchTracked,
      description: p.description,
      ingredients: p.ingredients,
      tags: p.tags,
      imageHint: p.imageHint,
      imageUrl: p.imageUrl,
      variants: p.variants.map((v) => ({
        sku: v.sku,
        barcode: v.barcode,
        size: v.size,
        color: v.color,
        grade: v.grade,
        uom: v.uom,
        packSize: v.packSize,
        costPriceOverride: v.costPriceOverride,
        sellingPriceOverride: v.sellingPriceOverride,
        stockOnHand: v.stockOnHand,
        active: v.active,
      })),
    })),
    priceLists: priceLists.map((pl) => ({
      code: pl.code,
      name: pl.name,
      description: pl.description,
      currency: pl.currency,
      basis: pl.basis,
      multiplier: pl.multiplier,
      active: pl.active,
      isDefault: pl.isDefault,
      validFrom: pl.validFrom?.toISOString() ?? null,
      validUntil: pl.validUntil?.toISOString() ?? null,
      items: pl.items.map((it) => ({
        productSku: it.product.sku,
        variantSku: it.variant?.sku ?? null,
        price: it.price,
        minQty: it.minQty,
        notes: it.notes,
      })),
    })),
    bins: bins.map((b) => ({
      warehouseCode: b.warehouse.code,
      zone: b.zone,
      rack: b.rack,
      shelf: b.shelf,
      bin: b.bin,
      code: b.code,
      capacity: b.capacity,
      occupied: b.occupied,
      qty: b.qty,
      reservedQty: b.reservedQty,
      batch: b.batch,
      productSku: b.product?.sku ?? null,
    })),
    stockLedger: stockLedger.map((row) => ({
      date: row.date.toISOString(),
      productSku: row.product.sku,
      txnType: row.txnType,
      ref: row.ref,
      qty: row.qty,
      warehouseCode: row.warehouse.code,
      bin: row.bin,
      balance: row.balance,
    })),
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");

  console.log(`✓ Wrote ${outPath}`);
  console.log(
    `  ${payload.counts.products} products · ${payload.counts.variants} variants · ${payload.counts.priceListItems} price rows · ${payload.counts.bins} bins · ${payload.counts.stockLedger} ledger rows`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
