// Import catalog seed data (exported from SQLite) into Postgres.
//
// Usage (after switching DATABASE_URL to Postgres):
//
//   DATABASE_URL="postgresql://novaerp:..." npx tsx scripts/import-catalog-seed.ts
//
// Prerequisites:
//   1. npx prisma migrate deploy   ← creates tables in Postgres
//   2. Run this script once
//
// Idempotent: uses createMany with skipDuplicates: true, so re-runs are safe.
// Insert order respects FK dependencies (parents before children).

import { PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";

const db = new PrismaClient();
const SEED_DIR = path.join(process.cwd(), "seed-data");

function load<T>(name: string): T[] {
  const file = path.join(SEED_DIR, `${name}.json`);
  if (!fs.existsSync(file)) {
    console.warn(`  SKIP ${name} (seed-data/${name}.json not found)`);
    return [];
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as T[];
}

async function ins(name: string, data: object[], createFn: (d: object[]) => Promise<{ count: number }>) {
  if (data.length === 0) { console.log(`  ${name}: no data`); return; }
  const { count } = await createFn(data);
  console.log(`  ${name}: ${count} inserted (of ${data.length})`);
}

async function main() {
  if (!fs.existsSync(SEED_DIR)) {
    throw new Error(`seed-data/ directory not found at ${SEED_DIR}. Run export-catalog-seed.ts first.`);
  }

  console.log("Importing catalog seed into Postgres...");

  // UoMs first (referenced everywhere)
  await ins("Uom", load("Uom"), (d) => db.uom.createMany({ data: d as Parameters<typeof db.uom.createMany>[0]["data"], skipDuplicates: true }));

  // Taxonomy
  await ins("ProductCategory", load("ProductCategory"), (d) => db.productCategory.createMany({ data: d as Parameters<typeof db.productCategory.createMany>[0]["data"], skipDuplicates: true }));
  await ins("ProductConcern", load("ProductConcern"), (d) => db.productConcern.createMany({ data: d as Parameters<typeof db.productConcern.createMany>[0]["data"], skipDuplicates: true }));

  // Workers and machines
  await ins("Worker", load("Worker"), (d) => db.worker.createMany({ data: d as Parameters<typeof db.worker.createMany>[0]["data"], skipDuplicates: true }));
  await ins("Machine", load("Machine"), (d) => db.machine.createMany({ data: d as Parameters<typeof db.machine.createMany>[0]["data"], skipDuplicates: true }));

  // Facilities
  await ins("WorkCenter", load("WorkCenter"), (d) => db.workCenter.createMany({ data: d as Parameters<typeof db.workCenter.createMany>[0]["data"], skipDuplicates: true }));
  await ins("Facility", load("Facility"), (d) => db.facility.createMany({ data: d as Parameters<typeof db.facility.createMany>[0]["data"], skipDuplicates: true }));
  await ins("FacilityZone", load("FacilityZone"), (d) => db.facilityZone.createMany({ data: d as Parameters<typeof db.facilityZone.createMany>[0]["data"], skipDuplicates: true }));
  await ins("ProductionLine", load("ProductionLine"), (d) => db.productionLine.createMany({ data: d as Parameters<typeof db.productionLine.createMany>[0]["data"], skipDuplicates: true }));
  await ins("PackagingContainer", load("PackagingContainer"), (d) => db.packagingContainer.createMany({ data: d as Parameters<typeof db.packagingContainer.createMany>[0]["data"], skipDuplicates: true }));

  // Warehouses and bins
  await ins("Warehouse", load("Warehouse"), (d) => db.warehouse.createMany({ data: d as Parameters<typeof db.warehouse.createMany>[0]["data"], skipDuplicates: true }));
  await ins("Bin", load("Bin"), (d) => db.bin.createMany({ data: d as Parameters<typeof db.bin.createMany>[0]["data"], skipDuplicates: true }));

  // Vendors
  await ins("Vendor", load("Vendor"), (d) => db.vendor.createMany({ data: d as Parameters<typeof db.vendor.createMany>[0]["data"], skipDuplicates: true }));
  await ins("VendorCatalogItem", load("VendorCatalogItem"), (d) => db.vendorCatalogItem.createMany({ data: d as Parameters<typeof db.vendorCatalogItem.createMany>[0]["data"], skipDuplicates: true }));

  // Products and variants
  await ins("Product", load("Product"), (d) => db.product.createMany({ data: d as Parameters<typeof db.product.createMany>[0]["data"], skipDuplicates: true }));
  await ins("ProductVariant", load("ProductVariant"), (d) => db.productVariant.createMany({ data: d as Parameters<typeof db.productVariant.createMany>[0]["data"], skipDuplicates: true }));

  const pza = load("ProductionZoneAssignment");
  if (pza.length > 0) {
    await ins("ProductionZoneAssignment", pza, (d) => db.productionZoneAssignment.createMany({ data: d as Parameters<typeof db.productionZoneAssignment.createMany>[0]["data"], skipDuplicates: true }));
  }

  // BOMs (parent before children)
  await ins("Bom", load("Bom"), (d) => db.bom.createMany({ data: d as Parameters<typeof db.bom.createMany>[0]["data"], skipDuplicates: true }));
  await ins("BomOperation", load("BomOperation"), (d) => db.bomOperation.createMany({ data: d as Parameters<typeof db.bomOperation.createMany>[0]["data"], skipDuplicates: true }));
  await ins("BomItem", load("BomItem"), (d) => db.bomItem.createMany({ data: d as Parameters<typeof db.bomItem.createMany>[0]["data"], skipDuplicates: true }));
  await ins("BomByproduct", load("BomByproduct"), (d) => db.bomByproduct.createMany({ data: d as Parameters<typeof db.bomByproduct.createMany>[0]["data"], skipDuplicates: true }));
  await ins("BomOperationLine", load("BomOperationLine"), (d) => db.bomOperationLine.createMany({ data: d as Parameters<typeof db.bomOperationLine.createMany>[0]["data"], skipDuplicates: true }));

  // Price lists
  await ins("PriceList", load("PriceList"), (d) => db.priceList.createMany({ data: d as Parameters<typeof db.priceList.createMany>[0]["data"], skipDuplicates: true }));
  await ins("PriceListItem", load("PriceListItem"), (d) => db.priceListItem.createMany({ data: d as Parameters<typeof db.priceListItem.createMany>[0]["data"], skipDuplicates: true }));
  await ins("PriceListItemRevision", load("PriceListItemRevision"), (d) => db.priceListItemRevision.createMany({ data: d as Parameters<typeof db.priceListItemRevision.createMany>[0]["data"], skipDuplicates: true }));

  // Stock rules
  await ins("StockRule", load("StockRule"), (d) => db.stockRule.createMany({ data: d as Parameters<typeof db.stockRule.createMany>[0]["data"], skipDuplicates: true }));
  await ins("PutawayRule", load("PutawayRule"), (d) => db.putawayRule.createMany({ data: d as Parameters<typeof db.putawayRule.createMany>[0]["data"], skipDuplicates: true }));
  await ins("ReplenishSource", load("ReplenishSource"), (d) => db.replenishSource.createMany({ data: d as Parameters<typeof db.replenishSource.createMany>[0]["data"], skipDuplicates: true }));

  // Customers (preserves phone-based login)
  await ins("Customer", load("Customer"), (d) => db.customer.createMany({ data: d as Parameters<typeof db.customer.createMany>[0]["data"], skipDuplicates: true }));

  // Payment / shipping gateway configs
  const payuRows = load("PayuConfig");
  if (payuRows.length > 0) await ins("PayuConfig", payuRows, (d) => db.payuConfig.createMany({ data: d as Parameters<typeof db.payuConfig.createMany>[0]["data"], skipDuplicates: true }));

  const rzpRows = load("RazorpayConfig");
  if (rzpRows.length > 0) await ins("RazorpayConfig", rzpRows, (d) => db.razorpayConfig.createMany({ data: d as Parameters<typeof db.razorpayConfig.createMany>[0]["data"], skipDuplicates: true }));

  const srRows = load("ShiprocketConfig");
  if (srRows.length > 0) await ins("ShiprocketConfig", srRows, (d) => db.shiprocketConfig.createMany({ data: d as Parameters<typeof db.shiprocketConfig.createMany>[0]["data"], skipDuplicates: true }));

  const sgRows = load("StorefrontGatewayConfig");
  if (sgRows.length > 0) await ins("StorefrontGatewayConfig", sgRows, (d) => db.storefrontGatewayConfig.createMany({ data: d as Parameters<typeof db.storefrontGatewayConfig.createMany>[0]["data"], skipDuplicates: true }));

  await db.$disconnect();
  console.log("\nImport complete.");
  console.log("Next steps:");
  console.log("  1. npm run db:seed-godowns          (optional — create godown shelf bins)");
  console.log("  2. npm run db:sync-stock             (reconcile product SOH from bins)");
  console.log("  3. npm run ops:post-migrate-config:dist");
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
