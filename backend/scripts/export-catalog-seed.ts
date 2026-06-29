// Export catalog/operational data from SQLite → JSON seed files.
//
// Run this script while DATABASE_URL still points at the SQLite dev.db,
// BEFORE switching to Postgres:
//
//   DATABASE_URL="file:./prisma/dev.db" npx tsx scripts/export-catalog-seed.ts
//
// Output: backend/seed-data/*.json  (one file per entity)
//
// Operational tables intentionally EXCLUDED (fresh start on Postgres):
//   StockLedger, SalesOrder, Invoice, ChangeLog, Tombstone, AuditLog,
//   SystemEventLog, CustomerActivity, PaymentIntent, OtpToken,
//   CustomerAccount, CustomerPayment, etc.

import { PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";

const db = new PrismaClient();
const OUT_DIR = path.join(process.cwd(), "seed-data");

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Helper to write a JSON seed file.
  const dump = async (name: string, data: unknown[]) => {
    const file = path.join(OUT_DIR, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
    console.log(`  ${name}: ${data.length} rows → ${file}`);
  };

  console.log("Exporting catalog seed from SQLite...");

  // UoMs (referenced by many entities)
  await dump("Uom", await db.uom.findMany());

  // Product taxonomy
  await dump("ProductCategory", await db.productCategory.findMany());
  await dump("ProductConcern", await db.productConcern.findMany());

  // Workers and machines (referenced by BOMs/work orders)
  await dump("Worker", await db.worker.findMany());
  await dump("Machine", await db.machine.findMany());

  // Facilities, production lines, workcenter
  await dump("WorkCenter", await db.workCenter.findMany());
  await dump("Facility", await db.facility.findMany());
  await dump("FacilityZone", await db.facilityZone.findMany());
  await dump("ProductionLine", await db.productionLine.findMany());
  await dump("PackagingContainer", await db.packagingContainer.findMany());

  // Warehouses and bins
  await dump("Warehouse", await db.warehouse.findMany());
  await dump("Bin", await db.bin.findMany());

  // Vendors (for procurement)
  await dump("Vendor", await db.vendor.findMany());
  await dump("VendorCatalogItem", await db.vendorCatalogItem.findMany());

  // Products + variants
  await dump("Product", await db.product.findMany());
  await dump("ProductVariant", await db.productVariant.findMany());
  await dump("ProductionZoneAssignment", await db.productionZoneAssignment.findMany().catch(() => []));

  // BOMs
  await dump("Bom", await db.bom.findMany());
  await dump("BomItem", await db.bomItem.findMany());
  await dump("BomByproduct", await db.bomByproduct.findMany());
  await dump("BomOperation", await db.bomOperation.findMany());
  await dump("BomOperationLine", await db.bomOperationLine.findMany());

  // Price lists
  await dump("PriceList", await db.priceList.findMany());
  await dump("PriceListItem", await db.priceListItem.findMany());
  await dump("PriceListItemRevision", await db.priceListItemRevision.findMany());

  // Stock rules (replenishment config)
  await dump("StockRule", await db.stockRule.findMany());
  await dump("PutawayRule", await db.putawayRule.findMany());
  await dump("ReplenishSource", await db.replenishSource.findMany());

  // Customers (preserves login phone numbers)
  await dump("Customer", await db.customer.findMany());

  // Storefront gateway configs (encrypted or redacted in git; run locally)
  await dump("PayuConfig", await db.payuConfig.findMany().catch(() => []));
  await dump("RazorpayConfig", await db.razorpayConfig.findMany().catch(() => []));
  await dump("ShiprocketConfig", await db.shiprocketConfig.findMany().catch(() => []));
  await dump("StorefrontGatewayConfig", await db.storefrontGatewayConfig.findMany().catch(() => []));

  await db.$disconnect();
  console.log("\nExport complete. Files written to:", OUT_DIR);
  console.log("Next: run import-catalog-seed.ts against your Postgres instance.");
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
