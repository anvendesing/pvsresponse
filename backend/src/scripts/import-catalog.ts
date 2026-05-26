/**
 * Import catalog master data exported by export-catalog.ts.
 *
 * VPS (compiled — included in Docker image after build):
 *   docker cp catalog-export.json pvsresponse-backend-1:/tmp/catalog-export.json
 *   docker compose exec backend node dist/scripts/import-catalog.js /tmp/catalog-export.json --full
 *
 * Local:
 *   npm run build && npm run db:import-catalog -- data/catalog-export.json --full
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { PrismaClient } from "@prisma/client";
import { binCodeFromRow } from "../lib/codes.js";

const db = new PrismaClient();

interface ExportFile {
  version: number;
  products: Array<{
    sku: string;
    name: string;
    type: string;
    uom: string;
    barcode: string;
    state: string;
    category: string;
    hsn: string;
    costPrice: number;
    sellingPrice: number;
    reorderLevel: number;
    stockOnHand: number;
    batchTracked: boolean;
    description?: string | null;
    ingredients?: string | null;
    tags?: string | null;
    imageHint?: string | null;
    imageUrl?: string | null;
    variants: Array<{
      sku: string;
      barcode?: string | null;
      size?: string | null;
      color?: string | null;
      grade?: string | null;
      uom?: string | null;
      packSize: number;
      costPriceOverride?: number | null;
      sellingPriceOverride?: number | null;
      stockOnHand: number;
      active: boolean;
    }>;
  }>;
  warehouses: Array<{ code: string; name: string; city: string; active: boolean }>;
  priceLists: Array<{
    code: string;
    name: string;
    description?: string | null;
    currency: string;
    basis: string;
    multiplier: number;
    active: boolean;
    isDefault: boolean;
    validFrom?: string | null;
    validUntil?: string | null;
    items: Array<{
      productSku: string;
      variantSku?: string | null;
      price: number;
      minQty: number;
      notes?: string | null;
    }>;
  }>;
  bins: Array<{
    warehouseCode: string;
    zone: string;
    rack: string;
    shelf: string;
    bin: string;
    code?: string | null;
    capacity: number;
    occupied: number;
    qty: number;
    reservedQty: number;
    batch?: string | null;
    productSku?: string | null;
  }>;
  stockLedger: Array<{
    date: string;
    productSku: string;
    txnType: string;
    ref: string;
    qty: number;
    warehouseCode: string;
    bin?: string | null;
    balance: number;
  }>;
}

const fileArg = process.argv.find((a) => !a.startsWith("-") && a.endsWith(".json"));
const full = process.argv.includes("--full");

if (!fileArg) {
  console.error("Usage: node dist/scripts/import-catalog.js <catalog-export.json> [--full]");
  process.exit(1);
}

async function wipeCatalog(fullWipe: boolean) {
  console.log(fullWipe ? "Wiping catalog + transactional product links…" : "Wiping catalog…");

  // FK-safe order: children before parents. DispatchOrder, payments, and
  // returns all reference Invoice — clear those before deleting invoices.
  await db.creditNoteItem.deleteMany();
  await db.creditNote.deleteMany();
  await db.customerReturnItem.deleteMany();
  await db.customerReturn.deleteMany();

  if (fullWipe) {
    await db.dispatchOrder.deleteMany();
    await db.customerPaymentAllocation.deleteMany();
    await db.customerPayment.deleteMany();
    await db.invoiceItem.deleteMany();
    await db.invoice.deleteMany();
    await db.packingSlipItem.deleteMany();
    await db.packingSlip.deleteMany();
    await db.pickListItem.deleteMany();
    await db.pickList.deleteMany();
    await db.salesOrderItem.deleteMany();
    await db.salesOrder.deleteMany();
    await db.quoteRevision.deleteMany();
    await db.quoteItem.deleteMany();
    await db.quote.deleteMany();
    await db.grn.deleteMany();
    await db.purchaseOrderItem.deleteMany();
    await db.purchaseOrder.deleteMany();
    await db.approval.deleteMany();
    await db.trip.deleteMany();
  } else {
    await db.packingSlipItem.deleteMany();
    await db.packingSlip.deleteMany();
    await db.pickListItem.deleteMany();
    await db.pickList.deleteMany();
  }

  // Manufacturing orders reference BOMs — must go before bom/bomItem deletes.
  await db.workOrder.deleteMany();
  await db.productionOrder.deleteMany();
  await db.bomItem.deleteMany();
  await db.bom.deleteMany();
  await db.priceListItem.deleteMany();
  await db.priceList.deleteMany();
  await db.stockLedger.deleteMany();
  await db.binCount.deleteMany();
  await db.bin.deleteMany();
  await db.productVariant.deleteMany();
  await db.product.deleteMany();
}

async function main() {
  const path = resolve(fileArg!);
  const raw = readFileSync(path, "utf8");
  const data = JSON.parse(raw) as ExportFile;

  if (data.version !== 1) {
    throw new Error(`Unsupported export version: ${data.version}`);
  }

  console.log(`Importing from ${path}…`);
  await wipeCatalog(full);

  const warehouseByCode = new Map<string, string>();
  for (const w of data.warehouses) {
    const row = await db.warehouse.upsert({
      where: { code: w.code },
      create: w,
      update: { name: w.name, city: w.city, active: w.active },
    });
    warehouseByCode.set(w.code, row.id);
  }
  console.log(`✓ ${data.warehouses.length} warehouses`);

  const productBySku = new Map<string, string>();
  const variantBySku = new Map<string, string>();

  for (const p of data.products) {
    const created = await db.product.create({
      data: {
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
        description: p.description ?? null,
        ingredients: p.ingredients ?? null,
        tags: p.tags ?? null,
        imageHint: p.imageHint ?? null,
        imageUrl: p.imageUrl ?? null,
        variants: {
          create: p.variants.map((v) => ({
            sku: v.sku,
            barcode: v.barcode ?? null,
            size: v.size ?? null,
            color: v.color ?? null,
            grade: v.grade ?? null,
            uom: v.uom ?? null,
            packSize: v.packSize,
            costPriceOverride: v.costPriceOverride ?? null,
            sellingPriceOverride: v.sellingPriceOverride ?? null,
            stockOnHand: v.stockOnHand,
            active: v.active,
          })),
        },
      },
      include: { variants: true },
    });
    productBySku.set(p.sku, created.id);
    for (const v of created.variants) variantBySku.set(v.sku, v.id);
  }
  console.log(`✓ ${data.products.length} products`);

  for (const pl of data.priceLists) {
    const createdPl = await db.priceList.create({
      data: {
        code: pl.code,
        name: pl.name,
        description: pl.description ?? null,
        currency: pl.currency,
        basis: pl.basis,
        multiplier: pl.multiplier,
        active: pl.active,
        isDefault: pl.isDefault,
        validFrom: pl.validFrom ? new Date(pl.validFrom) : null,
        validUntil: pl.validUntil ? new Date(pl.validUntil) : null,
      },
    });

    const items = pl.items
      .map((it) => {
        const productId = productBySku.get(it.productSku);
        if (!productId) return null;
        const variantId = it.variantSku ? variantBySku.get(it.variantSku) ?? null : null;
        return {
          priceListId: createdPl.id,
          productId,
          variantId,
          price: it.price,
          minQty: it.minQty,
          notes: it.notes ?? null,
        };
      })
      .filter(Boolean) as Array<{
      priceListId: string;
      productId: string;
      variantId: string | null;
      price: number;
      minQty: number;
      notes: string | null;
    }>;

    if (items.length) {
      await db.priceListItem.createMany({ data: items });
    }
  }
  console.log(`✓ ${data.priceLists.length} price lists`);

  let binsCreated = 0;
  for (const b of data.bins) {
    const warehouseId = warehouseByCode.get(b.warehouseCode);
    if (!warehouseId) {
      console.warn(`  skip bin ${b.warehouseCode}/${b.zone}: unknown warehouse`);
      continue;
    }
    const productId = b.productSku ? productBySku.get(b.productSku) ?? null : null;
    const code =
      b.code ??
      binCodeFromRow(
        { zone: b.zone, rack: b.rack, shelf: b.shelf, bin: b.bin },
        b.warehouseCode
      );

    await db.bin.create({
      data: {
        warehouseId,
        zone: b.zone,
        rack: b.rack,
        shelf: b.shelf,
        bin: b.bin,
        code,
        capacity: b.capacity,
        occupied: b.occupied,
        qty: b.qty,
        reservedQty: b.reservedQty,
        batch: b.batch ?? null,
        productId,
      },
    });
    binsCreated++;
  }
  console.log(`✓ ${binsCreated} bins`);

  let ledgerCreated = 0;
  for (const row of data.stockLedger) {
    const productId = productBySku.get(row.productSku);
    const warehouseId = warehouseByCode.get(row.warehouseCode);
    if (!productId || !warehouseId) continue;

    await db.stockLedger.create({
      data: {
        date: new Date(row.date),
        productId,
        txnType: row.txnType,
        ref: row.ref,
        qty: row.qty,
        warehouseId,
        bin: row.bin ?? null,
        balance: row.balance,
      },
    });
    ledgerCreated++;
  }
  console.log(`✓ ${ledgerCreated} stock ledger rows`);

  console.log("\nDone. Catalog imported.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
