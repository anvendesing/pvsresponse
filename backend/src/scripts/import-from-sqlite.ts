/**
 * Import all data from the local SQLite dev.db into the running Postgres
 * instance. Handles schema drift by reading valid columns from Postgres and
 * silently dropping any extra fields that exist in SQLite but were removed
 * from the Prisma schema.
 *
 * Usage (from backend/):
 *   npx tsx scripts/import-from-sqlite.ts
 *   npx tsx scripts/import-from-sqlite.ts --tables Product,Vendor,StockRule
 *   npx tsx scripts/import-from-sqlite.ts --skip-truncate   (append-only)
 *
 * The script disables FK checks during load (session_replication_role=replica)
 * then re-enables them, so table order doesn't matter.
 */

import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const db = new PrismaClient();

// ── CLI flags ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const onlyTables =
  args.find((a) => a.startsWith("--tables="))?.replace("--tables=", "").split(",") ?? null;
const skipTruncate = args.includes("--skip-truncate");

// ── SQLite source ─────────────────────────────────────────────────────────────
const SQLITE_PATH = process.env["SQLITE_PATH"] ??
  path.resolve(__dirname, "../../prisma/dev.db");

// ── Tables to import (in dependency order for reference, but FK disabled) ────
// All tables that exist in the Postgres schema. Operational tables are included
// so the full ERP state is preserved.
const ALL_TABLES = [
  // Reference data
  "UomCategory", "Uom", "CompanyProfile",
  // Locations
  "WorkCenter", "Warehouse", "Bin",
  // Products & catalog
  "ProductCategory", "ProductConcern", "Product", "ProductVariant",
  "ProductConcernLink",
  // BOMs
  "Bom", "BomOperation", "BomItem", "BomByproduct", "BomOperationLine",
  // Pricing
  "PriceList", "PriceListItem", "PriceListItemRevision",
  // Vendors
  "Vendor", "VendorCatalogItem",
  // Stock rules
  "StockRule", "PutawayRule", "ReplenishSource",
  // Production
  "Machine", "Worker", "ProductionLine", "PackagingContainer",
  "Facility", "FacilityZone", "ProductionZoneAssignment",
  // Customers
  "Customer", "CustomerAddress",
  // Users & auth
  "User",
  // Operational
  "PurchaseOrder", "PurchaseOrderItem", "Grn", "GrnItem",
  "StockLot", "StockLedger",
  "SalesOrder", "SalesOrderItem", "SalesOrderReservation",
  "Invoice", "InvoiceItem",
  "Quote", "QuoteItem",
  "WorkOrder", "ProductionOrder",
  "TransferOrder", "TransferOrderItem",
  "PickList", "PickListItem",
  "PackingSlip", "PackingSlipItem", "PackingContainer", "PackingContainerItem",
  "Trip",
  // Payment & shipping config
  "PaymentGatewayConfig", "RazorpayConfig", "PayuConfig",
  "ShiprocketConfig", "StorefrontGatewayConfig",
  // Payments
  "CustomerPayment", "CustomerPaymentAllocation", "PaymentIntent",
  // Misc
  "ContainerType", "DispatchOption", "DispatchRouteOption",
  "BinCount", "ChannelMapping", "ScanEvent",
  "AuditLog", "SystemEventLog", "ChangeLog", "Tombstone",
  "OtpToken", "DevOtpLog",
];

// ── Helpers ───────────────────────────────────────────────────────────────────
/** Get columns with their data types from Postgres for a given table */
async function pgColumns(table: string): Promise<{ name: string; type: string }[]> {
  const rows = await db.$queryRaw<{ column_name: string; data_type: string }[]>`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = ${table}
    ORDER BY ordinal_position
  `;
  return rows.map((r) => ({ name: r.column_name, type: r.data_type }));
}

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
// Unix ms timestamps are large integers (> year 2000 in ms = 946684800000)
const UNIX_MS_MIN = 946_684_800_000;  // 2000-01-01 in ms
const UNIX_MS_MAX = 4_102_444_800_000; // 2100-01-01 in ms

/** Convert SQLite value to Postgres-compatible JS value */
function coerce(v: unknown, pgType: string): unknown {
  if (v === null || v === undefined) return null;
  const isTimestamp = pgType.startsWith("timestamp") || pgType === "date";
  if (isTimestamp) {
    // Unix milliseconds stored as integer
    if (typeof v === "number" && v >= UNIX_MS_MIN && v <= UNIX_MS_MAX) {
      return new Date(v);
    }
    // ISO string
    if (typeof v === "string" && ISO_PATTERN.test(v)) {
      return new Date(v);
    }
  }
  return v;
}

/** Build and execute a batched INSERT … ON CONFLICT DO NOTHING */
async function insertBatch(table: string, cols: { name: string; type: string }[], rows: Record<string, unknown>[]): Promise<number> {
  if (rows.length === 0) return 0;
  const colList = cols.map((c) => `"${c.name}"`).join(", ");

  let inserted = 0;
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const placeholders = chunk
      .map(
        (_, ri) =>
          `(${cols.map((_, ci) => `$${ri * cols.length + ci + 1}`).join(", ")})`
      )
      .join(", ");
    const values = chunk.flatMap((row) => cols.map((c) => coerce(row[c.name], c.type)));
    const sql = `INSERT INTO "${table}" (${colList}) VALUES ${placeholders} ON CONFLICT DO NOTHING`;
    try {
      await db.$executeRawUnsafe(sql, ...values);
      inserted += chunk.length;
    } catch (err) {
      console.error(`    ✗ batch error on ${table}:`, (err as Error).message.slice(0, 120));
    }
  }
  return inserted;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nImporting SQLite → Postgres`);
  console.log(`  Source: ${SQLITE_PATH}`);
  console.log(`  Target: ${process.env["DATABASE_URL"]?.replace(/:\/\/.*@/, "://<hidden>@")}\n`);

  const sqlite = new DatabaseSync(SQLITE_PATH);

  // Resolve which tables to process
  const sqliteTables = new Set(
    (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
      .map((r) => r.name)
  );

  const tables = (onlyTables ?? ALL_TABLES).filter((t) => {
    if (!sqliteTables.has(t)) { console.log(`  SKIP ${t} (not in SQLite)`); return false; }
    return true;
  });

  // Disable FK checks so we can insert in any order
  await db.$executeRawUnsafe("SET session_replication_role = 'replica'");

  // Optionally truncate all target tables first
  if (!skipTruncate) {
    console.log("Truncating Postgres tables...");
    for (const table of [...tables].reverse()) {
      try {
        await db.$executeRawUnsafe(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
        process.stdout.write(".");
      } catch {
        // Table may not exist yet — skip
      }
    }
    console.log(" done\n");
  }

  // Import each table
  let totalRows = 0;
  for (const table of tables) {
    // Get what columns Postgres actually has for this table
    const pgCols = await pgColumns(table);
    if (pgCols.length === 0) {
      console.log(`  SKIP ${table} (not in Postgres schema)`);
      continue;
    }

    // Read all rows from SQLite
    const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
    if (rows.length === 0) {
      console.log(`  ${table}: 0 rows (empty)`);
      continue;
    }

    // Filter to only columns that exist in Postgres (handles schema drift)
    const sqliteCols = Object.keys(rows[0]);
    const pgColNames = pgCols.map((c) => c.name);
    const useCols = pgCols.filter((c) => sqliteCols.includes(c.name));
    const droppedCols = sqliteCols.filter((c) => !pgColNames.includes(c));
    if (droppedCols.length > 0) {
      console.log(`  ${table}: dropping obsolete columns: ${droppedCols.join(", ")}`);
    }

    const inserted = await insertBatch(table, useCols, rows);
    console.log(`  ✓ ${table}: ${inserted}/${rows.length} rows`);
    totalRows += inserted;
  }

  // Re-enable FK checks
  await db.$executeRawUnsafe("SET session_replication_role = 'origin'");

  // Post-import: wipe all operational/transactional tables so only clean
  // master data remains. Test-generated invoices, POs, stock ledger etc.
  // would fail FK constraints anyway — start those fresh on Postgres.
  console.log("\nCleaning operational tables (keeping master data)...");
  const OPERATIONAL = [
    "PackingSlipItem","PackingSlip","PackingContainer","PackingContainerItem",
    "PickListItem","PickList","Trip",
    "InvoiceItem","Invoice",
    "SalesOrderReservation","SalesOrderItem","SalesOrder",
    "QuoteItem","Quote",
    "WorkOrderRun","WorkOrderRunBatch","WorkOrder","ProductionOrder",
    "GrnItem","Grn","PurchaseOrderItem","PurchaseOrder",
    "TransferOrderItem","TransferOrder",
    "StockLedger","StockLot","BinCount",
    "CustomerPaymentAllocation","CustomerPayment","PaymentIntent",
    "CustomerReturnItem","CustomerReturn","CreditNoteItem","CreditNote",
    "EnquiryItem","Enquiry",
    "OtpToken","DevOtpLog",
    "ChangeLog","Tombstone","AuditLog","SystemEventLog","ScanEvent",
  ];
  await db.$executeRawUnsafe("SET session_replication_role = 'replica'");
  for (const t of OPERATIONAL) {
    try {
      await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" CASCADE`);
      process.stdout.write(".");
    } catch { /* table may not exist */ }
  }
  await db.$executeRawUnsafe("SET session_replication_role = 'origin'");
  console.log(" done");

  sqlite.close();
  await db.$disconnect();

  console.log(`\nDone. ${totalRows} rows imported into Postgres.`);
  console.log("Master data preserved: products, variants, customers, bins,");
  console.log("putaway rules, stock rules, BOMs, price lists, warehouses.\n");
  console.log("Next: npm run db:sync-stock  (reconcile product SOH from bins)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
