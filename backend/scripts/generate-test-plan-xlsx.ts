/**
 * Generates a comprehensive manual test plan workbook (PVS-ERP-Test-Plan.xlsx)
 * covering every Prisma model, ERP portal page, mobile screen, API route group,
 * and the key end-to-end business flows.
 *
 * Run:  npx tsx scripts/generate-test-plan-xlsx.ts
 */
import ExcelJS from "exceljs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../PVS-ERP-Test-Plan.xlsx");

// ── palette ─────────────────────────────────────────────────────────────────
const NAVY = "FF1F3A5F";
const HEAD = "FF2E5E8C";
const ZEBRA = "FFF2F6FA";
const PRI_HI = "FFFADBD8";
const PRI_MED = "FFFCF3CF";
const PRI_LOW = "FFEAF2F8";

type Row = {
  area: string;
  item: string; // model / page / screen / route
  tc: string; // test case title
  steps: string;
  expected: string;
  type: string; // Functional / Validation / Permission / Edge / UI / Integration
  priority: "High" | "Medium" | "Low";
};

let seq = 0;
const id = (prefix: string) => `${prefix}-${String(++seq).padStart(3, "0")}`;

// =============================================================================
// 1. BACKEND MODELS
// =============================================================================
const models: Row[] = [
  // User / auth / session
  { area: "Auth & Users", item: "User", tc: "Create user with each role", steps: "Settings → Users → Add user for admin, supervisor, procurement, billing, warehouse", expected: "User saved; appears in list with correct role badge", type: "Functional", priority: "High" },
  { area: "Auth & Users", item: "User", tc: "Unique username enforced", steps: "Create a second user with an existing username", expected: "Rejected with a clear duplicate error", type: "Validation", priority: "High" },
  { area: "Auth & Users", item: "User", tc: "Deactivate user blocks login", steps: "Set user inactive, attempt login", expected: "Login refused for inactive account", type: "Functional", priority: "High" },
  { area: "Auth & Users", item: "Session", tc: "Token issued on login", steps: "Login via portal and via /m/login", expected: "Bearer token returned and stored; protected calls succeed", type: "Functional", priority: "High" },
  { area: "Auth & Users", item: "Session", tc: "Expired/invalid token", steps: "Tamper token, call protected endpoint", expected: "401 returned; portal redirects to /login, mobile to /m/login", type: "Edge", priority: "High" },

  // UOM
  { area: "Master Data", item: "UomCategory / Uom", tc: "Create UOM category & units", steps: "Settings → UOMs → add category, add base + derived units with factor", expected: "Units saved; conversion factor respected in pickers", type: "Functional", priority: "Medium" },
  { area: "Master Data", item: "Uom", tc: "Conversion factor validation", steps: "Add a unit with factor 0 or negative", expected: "Rejected with validation error", type: "Validation", priority: "Medium" },

  // Warehouse / Bin
  { area: "Warehouse", item: "Warehouse", tc: "Create storage vs production warehouse", steps: "Settings → Warehouses → create with kind=storage and kind=production", expected: "Both saved; kind shown correctly", type: "Functional", priority: "High" },
  { area: "Warehouse", item: "Bin", tc: "Create rack/bin hierarchy", steps: "Warehouse page → Add rack, Add bin; verify zone/rack/shelf/bin tree", expected: "Tree reflects new nodes; bin code composed correctly", type: "Functional", priority: "High" },
  { area: "Warehouse", item: "Bin", tc: "Bin capacity / reservedQty integrity", steps: "Reserve stock via picking, inspect reservedQty", expected: "reservedQty never exceeds qty; freed on cancel/complete", type: "Integration", priority: "High" },

  // Product / Variant
  { area: "Products", item: "Product", tc: "Create product of each type", steps: "Products → add finished good, raw material, etc.", expected: "Saved with SKU, UOM, type; visible in list & pickers", type: "Functional", priority: "High" },
  { area: "Products", item: "Product", tc: "Duplicate SKU rejected", steps: "Create product reusing an existing SKU", expected: "Validation error", type: "Validation", priority: "High" },
  { area: "Products", item: "ProductVariant", tc: "Add variants with sizes", steps: "Open product → add variants with distinct size/SKU", expected: "Variants saved and selectable in orders/BOM", type: "Functional", priority: "Medium" },
  { area: "Products", item: "Product", tc: "Barcode lookup", steps: "Assign barcode, scan via /m/scan", expected: "productByBarcode resolves to correct product", type: "Integration", priority: "Medium" },

  // Vendor / Procurement
  { area: "Procurement", item: "Vendor", tc: "Create & edit vendor", steps: "Procurement → vendors → add/edit", expected: "Vendor persisted; selectable on PO", type: "Functional", priority: "Medium" },
  { area: "Procurement", item: "PurchaseOrder / Item", tc: "Create PO with multiple lines", steps: "Create PO, add items with qty & price", expected: "PO totals computed; status draft", type: "Functional", priority: "High" },
  { area: "Procurement", item: "Grn / GrnItem", tc: "Receive against PO (GRN)", steps: "Create GRN from PO, receive partial then full", expected: "Stock increments; PO receipt status updates; ledger 'in' rows", type: "Integration", priority: "High" },
  { area: "Procurement", item: "GrnItem", tc: "Over-receipt guard", steps: "Receive more than ordered qty", expected: "Blocked or flagged per policy", type: "Edge", priority: "Medium" },

  // Customer / payments
  { area: "Customers", item: "Customer", tc: "Create customer with credit limit", steps: "Customers → add with credit limit & terms", expected: "Saved; credit limit enforced on orders", type: "Functional", priority: "High" },
  { area: "Customers", item: "CustomerPayment / Allocation", tc: "Record payment & allocate", steps: "Customer → Record Payment, allocate to invoices", expected: "Open balance reduces; allocations tracked", type: "Integration", priority: "High" },
  { area: "Customers", item: "CustomerAccount", tc: "AR statement accuracy", steps: "Open AR statement after invoices + payments", expected: "Open balance, available credit computed correctly", type: "Functional", priority: "High" },

  // Pricing
  { area: "Pricing", item: "PriceList / Item", tc: "Create price list & items", steps: "Price Lists → create list, add item prices (selling/cost basis)", expected: "Prices apply on quotes/orders per basis", type: "Functional", priority: "High" },
  { area: "Pricing", item: "PriceListItem", tc: "Effective date / overlap", steps: "Add overlapping price entries", expected: "Correct price resolved by precedence", type: "Edge", priority: "Medium" },

  // BOM / Manufacturing
  { area: "Manufacturing", item: "Bom / BomItem", tc: "Create multi-level BOM", steps: "Manufacturing → BOM → add components incl. nested BOM", expected: "explodeBom resolves leaves with correct qty", type: "Functional", priority: "High" },
  { area: "Manufacturing", item: "ProductionOrder", tc: "Create MO from BOM", steps: "Create MO, set plan qty, link work center", expected: "MO created in planned/draft status", type: "Functional", priority: "High" },
  { area: "Manufacturing", item: "ProductionOrder", tc: "Release MO computes shortages", steps: "Release MO with insufficient line stock", expected: "Replenishment TOs created for shortages only", type: "Integration", priority: "High" },
  { area: "Manufacturing", item: "ProductionOrder", tc: "Issue materials strict to line WH", steps: "Issue materials with requireMoReleaseBeforeIssue on", expected: "Consumes only from production-line warehouse; clear error if short", type: "Integration", priority: "High" },
  { area: "Manufacturing", item: "ProductionOrder", tc: "Complete MO lands FG + putaway TO", steps: "Complete MO, set final good qty", expected: "FG landed in line WH; putaway TO auto-created; ledger updated", type: "Integration", priority: "High" },
  { area: "Manufacturing", item: "WorkOrder", tc: "Work order lifecycle", steps: "Start/pause/complete work orders within MO", expected: "Status transitions valid; timestamps recorded", type: "Functional", priority: "Medium" },
  { area: "Manufacturing", item: "WorkCenter", tc: "Auto-create production warehouse", steps: "Create WC with 'auto-create production warehouse' checked", expected: "WH-PROD-<code> minted with default bin & linked", type: "Functional", priority: "High" },
  { area: "Manufacturing", item: "WorkCenter", tc: "Link existing production WH", steps: "Edit WC, choose existing production warehouse", expected: "productionLineWarehouseId set; unique constraint honored", type: "Validation", priority: "Medium" },
  { area: "Manufacturing", item: "Machine", tc: "Create machine under WC", steps: "Add machine, assign to work center", expected: "Machine listed under WC", type: "Functional", priority: "Low" },

  // Workforce
  { area: "Workforce", item: "Worker / Attendance", tc: "Mark attendance", steps: "Productivity → record attendance in/out", expected: "Attendance saved; productivity metrics update", type: "Functional", priority: "Medium" },

  // Putaway / Transfers
  { area: "Transfers", item: "PutawayRule", tc: "Create variant & product rules", steps: "Settings → Putaway rules → add variant-level and product-level rule", expected: "Saved; @@unique(productId,variantId) enforced", type: "Functional", priority: "High" },
  { area: "Transfers", item: "PutawayRule", tc: "Resolution waterfall", steps: "Complete MO for a variant having both variant & product rule", expected: "Variant rule wins over product rule over fallback", type: "Integration", priority: "High" },
  { area: "Transfers", item: "TransferOrder", tc: "Manual transfer creation", steps: "Transfers page → Create Transfer with lines", expected: "TO created kind=manual, status ready", type: "Functional", priority: "High" },
  { area: "Transfers", item: "TransferOrder", tc: "Pick decrements source", steps: "Mobile → claim → pick from source bin", expected: "Source Bin.qty down; ledger 'out'; status in_transit", type: "Integration", priority: "High" },
  { area: "Transfers", item: "TransferOrder", tc: "Drop increments destination", steps: "Mobile → drop into destination bin", expected: "Dest Bin.qty up; ledger 'in'; status done", type: "Integration", priority: "High" },
  { area: "Transfers", item: "TransferOrder", tc: "Cancel releases reservation", steps: "Cancel a ready/draft TO", expected: "Status cancelled; reservedQty released", type: "Functional", priority: "High" },
  { area: "Transfers", item: "TransferOrderItem", tc: "Partial pick/drop", steps: "Pick less than requested then drop", expected: "qtyPicked/qtyDropped tracked; variance visible", type: "Edge", priority: "Medium" },

  // Stock ledger
  { area: "Inventory", item: "StockLedger", tc: "Every movement writes a ledger row", steps: "Perform GRN, issue, transfer, adjust, complete MO", expected: "Each produces in/out ledger entries with ref", type: "Integration", priority: "High" },
  { area: "Inventory", item: "BinCount", tc: "Cycle count adjustment", steps: "Warehouse audit → count a bin, apply variance", expected: "Bin.qty corrected; adjustment ledger row", type: "Functional", priority: "Medium" },

  // Sales / fulfilment
  { area: "Sales", item: "Quote / Item / Revision", tc: "Create quote, revise, share", steps: "Quotes → create, edit to new revision, share public link", expected: "Revisions versioned; public link renders", type: "Functional", priority: "High" },
  { area: "Sales", item: "SalesOrder / Item", tc: "Convert quote → SO", steps: "Accept quote, generate SO", expected: "SO created with lines; status open", type: "Integration", priority: "High" },
  { area: "Fulfilment", item: "PickList / Item", tc: "Generate pick list from SO", steps: "Picking → create pick list", expected: "Pick lines with bin allocations; reservedQty set", type: "Integration", priority: "High" },
  { area: "Fulfilment", item: "PackingSlip / Item", tc: "Pack picked items", steps: "Packing → pack from completed pick", expected: "Packing slip created; qty reconciled", type: "Integration", priority: "High" },

  // Billing
  { area: "Billing", item: "Invoice / Item", tc: "Generate invoice from SO/packing", steps: "Billing → create invoice", expected: "Invoice totals, tax computed; AR updated", type: "Integration", priority: "High" },
  { area: "Billing", item: "Invoice", tc: "Public invoice share link", steps: "Share invoice, open /share/invoice/:token", expected: "Read-only invoice renders for token", type: "Functional", priority: "Medium" },

  // Transport
  { area: "Transport", item: "DispatchOrder / Trip", tc: "Create dispatch & trip", steps: "Transport → create dispatch, assign to trip", expected: "Trip groups dispatches; status flow valid", type: "Functional", priority: "Medium" },

  // Returns / credit
  { area: "Returns", item: "CustomerReturn / Item", tc: "Create return", steps: "Returns → create against invoice/SO, add items", expected: "Return recorded; stock optionally restocked", type: "Functional", priority: "Medium" },
  { area: "Returns", item: "CreditNote / Item", tc: "Issue credit note", steps: "Generate credit note from return", expected: "Credit applied to customer balance", type: "Integration", priority: "Medium" },

  // Approvals / audit
  { area: "Governance", item: "Approval", tc: "Approval request & decision", steps: "Trigger approvable action, approve/reject", expected: "Status updates; gated action proceeds only on approve", type: "Functional", priority: "Medium" },
  { area: "Governance", item: "AuditLog", tc: "Sensitive actions logged", steps: "Edit price/credit limit, inspect audit log", expected: "Entry with actor, before/after captured", type: "Functional", priority: "Medium" },

  // Sync
  { area: "Sync", item: "ChangeLog / Tombstone / SyncState", tc: "Mobile delta sync", steps: "Make server changes, run mobile sync", expected: "Mobile receives upserts & tombstones; cursor advances", type: "Integration", priority: "High" },
  { area: "Sync", item: "SyncConflict", tc: "Conflict resolution", steps: "Edit same record on server & offline mobile, sync", expected: "Conflict recorded & resolved per strategy", type: "Edge", priority: "Medium" },
  { area: "Sync", item: "ScanEvent", tc: "Scan event captured", steps: "Scan barcodes on mobile", expected: "ScanEvent rows logged for audit", type: "Functional", priority: "Low" },

  // Company profile
  { area: "Settings", item: "CompanyProfile", tc: "Toggle requireMoReleaseBeforeIssue", steps: "Settings → toggle the gate, retry issue-materials", expected: "Gate enforced/relaxed accordingly", type: "Functional", priority: "Medium" },
];

// =============================================================================
// 2. ERP PORTAL PAGES
// =============================================================================
const pages: Row[] = [
  { area: "Page", item: "Login", tc: "Valid & invalid login", steps: "Submit correct then wrong credentials", expected: "Success routes to dashboard; failure shows error", type: "Functional", priority: "High" },
  { area: "Page", item: "Dashboard", tc: "KPIs load", steps: "Open /dashboard", expected: "KPI cards & widgets populate without errors", type: "UI", priority: "Medium" },
  { area: "Page", item: "Products", tc: "List, search, CRUD, variants", steps: "Search, add/edit/delete product, manage variants", expected: "All operations reflect immediately", type: "Functional", priority: "High" },
  { area: "Page", item: "Procurement", tc: "PO & GRN workflow", steps: "Create PO, receive GRN", expected: "Stock & statuses update", type: "Functional", priority: "High" },
  { area: "Page", item: "PriceLists", tc: "Manage price lists", steps: "Create list, add/edit items", expected: "Prices saved and applied", type: "Functional", priority: "High" },
  { area: "Page", item: "Customers", tc: "Customer & AR management", steps: "CRUD customer, record payment, open statement", expected: "Balances accurate", type: "Functional", priority: "High" },
  { area: "Page", item: "Quotes", tc: "Quote lifecycle & share", steps: "Create/revise/share/accept", expected: "Revisions & sharing work", type: "Functional", priority: "High" },
  { area: "Page", item: "SalesOrders", tc: "SO management", steps: "Create SO, edit lines, progress status", expected: "SO flows to fulfilment", type: "Functional", priority: "High" },
  { area: "Page", item: "Picking", tc: "Pick list generation & tracking", steps: "Generate, assign, monitor", expected: "Pick lines & status correct", type: "Functional", priority: "High" },
  { area: "Page", item: "Packing", tc: "Packing slip workflow", steps: "Pack from pick, print slip", expected: "Packing slip created/printable", type: "Functional", priority: "High" },
  { area: "Page", item: "Returns", tc: "Returns & credit notes", steps: "Create return, issue credit", expected: "Return & credit reflected", type: "Functional", priority: "Medium" },
  { area: "Page", item: "Inventory", tc: "Stock view & adjust", steps: "View on-hand, adjust qty, view ledger", expected: "Adjustments tracked in ledger", type: "Functional", priority: "High" },
  { area: "Page", item: "Warehouse", tc: "Bin tree + contents (post-reorg)", steps: "Browse tree, view bin contents", expected: "Tree + table render; no Fast-Transfer rail present", type: "UI", priority: "High" },
  { area: "Page", item: "Warehouse", tc: "Transfers button navigates", steps: "Click 'Transfers' in toolbar", expected: "Routes to /transfers", type: "UI", priority: "High" },
  { area: "Page", item: "Transfers", tc: "KPI row counts", steps: "Open /transfers", expected: "Pending/In-Transit/Done today/Cancelled correct", type: "Functional", priority: "High" },
  { area: "Page", item: "Transfers", tc: "Tab filtering", steps: "Switch All/Putaway/Replenishment/Manual", expected: "Table filters; tab counts correct", type: "Functional", priority: "High" },
  { area: "Page", item: "Transfers", tc: "Row detail slide-over", steps: "Click a row", expected: "Slide-over shows items, pick/drop timestamps, meta", type: "UI", priority: "High" },
  { area: "Page", item: "Transfers", tc: "Create Transfer modal", steps: "Create TO with warehouses + product lines", expected: "Validates warehouses & lines; TO created; list refreshes", type: "Functional", priority: "High" },
  { area: "Page", item: "Transfers", tc: "Cancel from slide-over", steps: "Cancel a draft/ready TO", expected: "Cancelled; list refreshes; closed panel", type: "Functional", priority: "High" },
  { area: "Page", item: "WarehouseAudit", tc: "Cycle count flow", steps: "Count bins, apply variances", expected: "Counts recorded; stock corrected", type: "Functional", priority: "Medium" },
  { area: "Page", item: "Manufacturing", tc: "BOM/MO/release/complete", steps: "Build BOM, create MO, release, issue, complete", expected: "Full flow incl. linked TOs", type: "Functional", priority: "High" },
  { area: "Page", item: "Productivity", tc: "Attendance & metrics", steps: "Record attendance, view productivity", expected: "Metrics compute", type: "Functional", priority: "Medium" },
  { area: "Page", item: "Transport", tc: "Dispatch & trips", steps: "Create dispatch, build trip", expected: "Trip management works", type: "Functional", priority: "Medium" },
  { area: "Page", item: "Billing", tc: "Invoice & payment", steps: "Create invoice, record payment", expected: "AR & invoice status update", type: "Functional", priority: "High" },
  { area: "Page", item: "Reports", tc: "Render all reports", steps: "Open each report incl. transfer throughput & SKUs missing putaway rules", expected: "Data renders; filters work", type: "Functional", priority: "Medium" },
  { area: "Page", item: "Approvals", tc: "Approve/reject queue", steps: "Process approval items", expected: "Decisions persist & gate actions", type: "Functional", priority: "Medium" },
  { area: "Page", item: "Settings", tc: "All settings sections", steps: "UOMs, Warehouses, Work centers, Putaway rules, Users, Company profile", expected: "Each section CRUD works", type: "Functional", priority: "High" },
  { area: "Page", item: "Store", tc: "Storefront browse", steps: "Open /store, browse catalog", expected: "Catalog renders", type: "UI", priority: "Low" },
  { area: "Page", item: "Public share pages", tc: "Quote/Invoice/SO/PackingSlip share", steps: "Open each /share/* token URL", expected: "Read-only docs render; invalid token handled", type: "Functional", priority: "Medium" },
  { area: "Page", item: "Print pages", tc: "Pick list & packing slip print", steps: "Open /print/pick-list/:id and /print/packing-slip/:id", expected: "Print-friendly layout renders", type: "UI", priority: "Low" },
];

// =============================================================================
// 3. MOBILE SCREENS
// =============================================================================
const mobile: Row[] = [
  { area: "Mobile", item: "MobileLogin", tc: "Login on device", steps: "Open /m/login, sign in", expected: "Token stored; routed to /m/tasks", type: "Functional", priority: "High" },
  { area: "Mobile", item: "MobileTasks", tc: "Pick/Pack/Move tabs & counts", steps: "Open /m/tasks, switch tabs", expected: "Claimed & available buckets correct incl. transfers", type: "Functional", priority: "High" },
  { area: "Mobile", item: "MobileTasks", tc: "Claim task", steps: "Claim a pick/pack/transfer", expected: "Moves to 'mine'; assignment recorded", type: "Functional", priority: "High" },
  { area: "Mobile", item: "MobilePick / MobilePickLine", tc: "Pick line scan-confirm", steps: "Open pick, scan bin & product, confirm qty", expected: "Lines complete; reservation consumed", type: "Functional", priority: "High" },
  { area: "Mobile", item: "MobilePack", tc: "Pack confirm", steps: "Open pack, confirm items", expected: "Packing slip progresses", type: "Functional", priority: "High" },
  { area: "Mobile", item: "MobileTransfer", tc: "Sequential pick → drop", steps: "Open /m/transfers/:id, pick from source then drop to dest", expected: "Bin qty moves; TO done; qty adjustments handled", type: "Functional", priority: "High" },
  { area: "Mobile", item: "MobileTransfer", tc: "Cancel transfer", steps: "Cancel an in-progress TO", expected: "TO cancelled; stock consistent", type: "Edge", priority: "Medium" },
  { area: "Mobile", item: "MobileScan", tc: "Barcode scan routing", steps: "Scan product/bin barcode", expected: "Resolves to correct entity screen", type: "Functional", priority: "Medium" },
  { area: "Mobile", item: "MobileVerify", tc: "Verification flow", steps: "Run verify workflow", expected: "Verification result shown", type: "Functional", priority: "Low" },
  { area: "Mobile", item: "MobileLocation", tc: "Location lookup", steps: "Open /m/loc/:code", expected: "Location contents render", type: "Functional", priority: "Low" },
  { area: "Mobile", item: "MobileBin", tc: "Bin detail", steps: "Open /m/bin/:binId", expected: "Bin contents & actions render", type: "Functional", priority: "Low" },
  { area: "Mobile", item: "MobileProfile", tc: "Profile & logout", steps: "Open /m/profile, logout", expected: "Session cleared; back to /m/login", type: "Functional", priority: "Medium" },
  { area: "Mobile", item: "Offline/Sync", tc: "Offline action then sync", steps: "Go offline, perform action, reconnect", expected: "Queued action syncs; conflicts surfaced", type: "Integration", priority: "High" },
];

// =============================================================================
// 4. API ROUTE GROUPS
// =============================================================================
const routes: Row[] = [
  { area: "API", item: "auth", tc: "Login/refresh/logout", steps: "Hit auth endpoints", expected: "Tokens issued/cleared; 401 on bad creds", type: "Functional", priority: "High" },
  { area: "API", item: "settings", tc: "Company profile & masters", steps: "GET/PATCH settings", expected: "Admin-only; values persist", type: "Permission", priority: "High" },
  { area: "API", item: "uoms", tc: "UOM CRUD", steps: "CRUD uoms", expected: "Validations enforced", type: "Functional", priority: "Medium" },
  { area: "API", item: "catalog", tc: "Product/variant catalog", steps: "GET products, by-barcode", expected: "Correct data & lookups", type: "Functional", priority: "High" },
  { area: "API", item: "pricing", tc: "Price list endpoints", steps: "CRUD price lists/items", expected: "Pricing resolution correct", type: "Functional", priority: "High" },
  { area: "API", item: "procurement", tc: "PO & GRN", steps: "Create PO, post GRN", expected: "Stock & status update", type: "Integration", priority: "High" },
  { area: "API", item: "inventory", tc: "Stock query & adjust", steps: "GET stock, POST adjust", expected: "Ledger rows written", type: "Integration", priority: "High" },
  { area: "API", item: "locations", tc: "/me/tasks buckets", steps: "GET /me/tasks", expected: "pick/pack/transfer claimed+available counts correct", type: "Functional", priority: "High" },
  { area: "API", item: "transfers", tc: "Putaway rules + TO lifecycle", steps: "CRUD rules; create/claim/pick/drop/cancel TO", expected: "Stock & status transitions atomic", type: "Integration", priority: "High" },
  { area: "API", item: "manufacturing", tc: "BOM/MO/release/issue/complete", steps: "Exercise MO endpoints", expected: "Shortages, putaway TO, FG landing correct", type: "Integration", priority: "High" },
  { area: "API", item: "workforce", tc: "Workers & attendance", steps: "CRUD workers, attendance", expected: "Persisted correctly", type: "Functional", priority: "Medium" },
  { area: "API", item: "sales", tc: "Quotes & sales orders", steps: "Create/convert", expected: "Lifecycle correct", type: "Integration", priority: "High" },
  { area: "API", item: "fulfilment", tc: "Pick & pack", steps: "Generate pick, pack", expected: "Reservations & statuses correct", type: "Integration", priority: "High" },
  { area: "API", item: "billing", tc: "Invoices", steps: "Create invoice, list", expected: "Totals & AR correct", type: "Integration", priority: "High" },
  { area: "API", item: "customer-payments", tc: "Payments & allocations", steps: "Record & allocate", expected: "Balances correct", type: "Integration", priority: "High" },
  { area: "API", item: "returns", tc: "Returns & credit notes", steps: "Create return/credit", expected: "Stock/credit correct", type: "Functional", priority: "Medium" },
  { area: "API", item: "trips", tc: "Dispatch & trips", steps: "CRUD trips", expected: "Grouping correct", type: "Functional", priority: "Medium" },
  { area: "API", item: "reports", tc: "Report endpoints", steps: "GET each report incl. transfer-throughput, skus-missing-putaway-rules", expected: "Aggregations correct", type: "Functional", priority: "Medium" },
  { area: "API", item: "approvals", tc: "Approval workflow", steps: "Create/decide approvals", expected: "Gating works", type: "Functional", priority: "Medium" },
  { area: "API", item: "share", tc: "Public document tokens", steps: "GET share endpoints", expected: "Read-only; invalid token 404", type: "Permission", priority: "Medium" },
  { area: "API", item: "sync", tc: "Delta sync", steps: "Pull/push changes", expected: "ChangeLog/Tombstone/cursor correct; conflicts recorded", type: "Integration", priority: "High" },
  { area: "API", item: "bulk-order", tc: "Bulk order intake", steps: "Submit bulk order payload", expected: "Validated & created", type: "Functional", priority: "Low" },
  { area: "API", item: "storefront-mock", tc: "Storefront data", steps: "GET storefront", expected: "Catalog data returns", type: "Functional", priority: "Low" },
];

// =============================================================================
// 5. END-TO-END FLOWS
// =============================================================================
const flows: Row[] = [
  { area: "E2E", item: "Order-to-Cash", tc: "Quote → SO → Pick → Pack → Invoice → Payment", steps: "Run the full sales cycle for one customer", expected: "Each step links; stock, AR, statuses all consistent", type: "Integration", priority: "High" },
  { area: "E2E", item: "Procure-to-Stock", tc: "PO → GRN → On-hand", steps: "Order from vendor, receive, verify stock & ledger", expected: "Stock increases; ledger accurate", type: "Integration", priority: "High" },
  { area: "E2E", item: "FG Putaway", tc: "MO complete → putaway TO → mobile pick/drop → FG in storage", steps: "Complete an MO with a putaway rule, fulfil the TO on mobile", expected: "FG moves line→storage; ledger & bins correct", type: "Integration", priority: "High" },
  { area: "E2E", item: "Raw Replenishment", tc: "MO release → replenishment TO → mobile → issue from line", steps: "Release MO with shortage, fulfil replenishment TO, issue materials", expected: "Materials land at line; issue consumes only from line WH", type: "Integration", priority: "High" },
  { area: "E2E", item: "Returns/Credit", tc: "Invoice → Return → Credit note → balance", steps: "Return goods against an invoice and issue credit", expected: "Stock restocked; credit reduces balance", type: "Integration", priority: "Medium" },
  { area: "E2E", item: "Mobile Offline", tc: "Offline picking then sync", steps: "Pick offline, reconnect, sync", expected: "Server reconciles; no data loss/duplication", type: "Integration", priority: "High" },
  { area: "E2E", item: "RBAC", tc: "Role-based route access", steps: "Login as each role, attempt every page", expected: "Allowed pages load; disallowed are blocked/redirected", type: "Permission", priority: "High" },
];

// =============================================================================
// Role/permission matrix (separate sheet)
// =============================================================================
const ROLES = ["admin", "supervisor", "procurement", "billing", "warehouse"] as const;
const navMatrix: { page: string; roles: Record<(typeof ROLES)[number], boolean> }[] = [
  { page: "Dashboard", roles: { admin: true, supervisor: true, procurement: true, billing: true, warehouse: true } },
  { page: "Products", roles: { admin: true, supervisor: true, procurement: true, billing: false, warehouse: false } },
  { page: "Procurement", roles: { admin: true, supervisor: false, procurement: true, billing: false, warehouse: false } },
  { page: "Price Lists", roles: { admin: true, supervisor: false, procurement: true, billing: false, warehouse: false } },
  { page: "Customers", roles: { admin: true, supervisor: true, procurement: false, billing: true, warehouse: false } },
  { page: "Quotes", roles: { admin: true, supervisor: true, procurement: false, billing: true, warehouse: false } },
  { page: "Sales Orders", roles: { admin: true, supervisor: true, procurement: false, billing: true, warehouse: false } },
  { page: "Picking", roles: { admin: true, supervisor: true, procurement: false, billing: true, warehouse: true } },
  { page: "Packing", roles: { admin: true, supervisor: true, procurement: false, billing: true, warehouse: true } },
  { page: "Returns", roles: { admin: true, supervisor: true, procurement: false, billing: true, warehouse: true } },
  { page: "Inventory", roles: { admin: true, supervisor: true, procurement: true, billing: false, warehouse: true } },
  { page: "Warehouse", roles: { admin: true, supervisor: true, procurement: false, billing: false, warehouse: true } },
  { page: "Transfers", roles: { admin: true, supervisor: true, procurement: false, billing: false, warehouse: true } },
  { page: "WH Audit", roles: { admin: true, supervisor: false, procurement: false, billing: false, warehouse: true } },
  { page: "Manufacturing", roles: { admin: true, supervisor: true, procurement: false, billing: false, warehouse: false } },
  { page: "Productivity", roles: { admin: true, supervisor: true, procurement: false, billing: false, warehouse: false } },
  { page: "Transport", roles: { admin: true, supervisor: true, procurement: false, billing: false, warehouse: true } },
  { page: "Billing", roles: { admin: true, supervisor: false, procurement: false, billing: true, warehouse: false } },
  { page: "Reports", roles: { admin: true, supervisor: true, procurement: true, billing: true, warehouse: false } },
  { page: "Approvals", roles: { admin: true, supervisor: true, procurement: false, billing: true, warehouse: false } },
  { page: "Settings", roles: { admin: true, supervisor: false, procurement: false, billing: false, warehouse: false } },
];

// =============================================================================
// Workbook build
// =============================================================================
async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PVS ERP";
  wb.created = new Date();

  const priFill = (p: string) =>
    p === "High" ? PRI_HI : p === "Medium" ? PRI_MED : PRI_LOW;

  const buildTestSheet = (name: string, prefix: string, rows: Row[]) => {
    const ws = wb.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    ws.columns = [
      { header: "ID", key: "id", width: 10 },
      { header: "Area", key: "area", width: 18 },
      { header: "Module / Item", key: "item", width: 24 },
      { header: "Test Case", key: "tc", width: 40 },
      { header: "Steps", key: "steps", width: 52 },
      { header: "Expected Result", key: "expected", width: 52 },
      { header: "Type", key: "type", width: 14 },
      { header: "Priority", key: "priority", width: 10 },
      { header: "Status", key: "status", width: 12 },
      { header: "Notes / Defect", key: "notes", width: 30 },
    ];
    rows.forEach((r) => {
      ws.addRow({
        id: id(prefix),
        area: r.area,
        item: r.item,
        tc: r.tc,
        steps: r.steps,
        expected: r.expected,
        type: r.type,
        priority: r.priority,
        status: "Not Run",
        notes: "",
      });
    });
    styleSheet(ws, rows, priFill);
    return ws;
  };

  const styleSheet = (
    ws: ExcelJS.Worksheet,
    rows: Row[],
    priFill: (p: string) => string
  ) => {
    // header
    const header = ws.getRow(1);
    header.height = 22;
    header.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
      c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      c.border = { bottom: { style: "thin", color: { argb: NAVY } } };
    });
    // body
    ws.eachRow((row, idx) => {
      if (idx === 1) return;
      const r = rows[idx - 2];
      row.alignment = { vertical: "top", wrapText: true };
      if (idx % 2 === 0) {
        row.eachCell((c) => {
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
        });
      }
      // priority cell colouring
      const priCell = row.getCell(8);
      if (r) {
        priCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: priFill(r.priority) } };
        priCell.alignment = { vertical: "top", horizontal: "center" };
        priCell.font = { bold: true };
      }
      // status default styling
      const stCell = row.getCell(9);
      stCell.alignment = { vertical: "top", horizontal: "center" };
    });
    ws.autoFilter = { from: "A1", to: `J1` };
    // status data validation
    for (let i = 2; i <= rows.length + 1; i++) {
      ws.getCell(`I${i}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"Not Run,Pass,Fail,Blocked,N/A"'],
      };
    }
  };

  // ── Overview sheet ──────────────────────────────────────────────────────
  const ov = wb.addWorksheet("Overview");
  ov.columns = [{ width: 26 }, { width: 90 }];
  const title = ov.addRow(["PVS ERP — Master Test Plan", ""]);
  title.getCell(1).font = { bold: true, size: 16, color: { argb: NAVY } };
  ov.addRow([]);
  ov.addRow(["Generated", new Date().toISOString().slice(0, 10)]);
  ov.addRow(["Scope", "All Prisma models, ERP portal pages, mobile screens, API route groups, and end-to-end flows."]);
  ov.addRow([]);
  const lh = ov.addRow(["Worksheet", "Purpose"]);
  lh.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
  });
  [
    ["1. Models", "Backend / database model behaviour & integrity"],
    ["2. ERP Pages", "Desktop portal page-level functional & UI tests"],
    ["3. Mobile Screens", "Warehouse mobile app screen tests"],
    ["4. API Routes", "Backend route-group contract & permission tests"],
    ["5. E2E Flows", "Cross-module business workflows"],
    ["6. Role Matrix", "Which role can access which page (RBAC reference)"],
  ].forEach((r) => ov.addRow(r));
  ov.addRow([]);
  const legend = ov.addRow(["Legend", ""]);
  legend.getCell(1).font = { bold: true, size: 12, color: { argb: NAVY } };
  [
    ["Status values", "Not Run / Pass / Fail / Blocked / N/A (dropdown in Status column)"],
    ["Priority", "High (red), Medium (amber), Low (blue)"],
    ["Type", "Functional / Validation / Permission / Edge / UI / Integration"],
    ["Roles", "admin, supervisor, procurement, billing, warehouse"],
  ].forEach((r) => {
    const row = ov.addRow(r);
    row.getCell(1).font = { bold: true };
  });

  // ── Test sheets ─────────────────────────────────────────────────────────
  buildTestSheet("1. Models", "MDL", models);
  buildTestSheet("2. ERP Pages", "PG", pages);
  buildTestSheet("3. Mobile Screens", "MOB", mobile);
  buildTestSheet("4. API Routes", "API", routes);
  buildTestSheet("5. E2E Flows", "E2E", flows);

  // ── Role matrix sheet ─────────────────────────────────────────────────────
  const rm = wb.addWorksheet("6. Role Matrix", { views: [{ state: "frozen", ySplit: 1, xSplit: 1 }] });
  rm.columns = [
    { header: "Page", key: "page", width: 22 },
    ...ROLES.map((r) => ({ header: r, key: r, width: 14 })),
  ];
  navMatrix.forEach((m) => {
    rm.addRow({ page: m.page, ...Object.fromEntries(ROLES.map((r) => [r, m.roles[r] ? "✓" : "—"])) });
  });
  const rmHead = rm.getRow(1);
  rmHead.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.alignment = { horizontal: "center", vertical: "middle" };
  });
  rm.eachRow((row, idx) => {
    if (idx === 1) return;
    row.getCell(1).font = { bold: true };
    for (let c = 2; c <= ROLES.length + 1; c++) {
      const cell = row.getCell(c);
      cell.alignment = { horizontal: "center" };
      if (cell.value === "✓") {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD5F5E3" } };
        cell.font = { bold: true, color: { argb: "FF1E8449" } };
      } else {
        cell.font = { color: { argb: "FFB0B0B0" } };
      }
    }
    if (idx % 2 === 0) row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
  });

  await wb.xlsx.writeFile(OUT);
  const total = models.length + pages.length + mobile.length + routes.length + flows.length;
  console.log(`Wrote ${OUT}`);
  console.log(`Total test cases: ${total}`);
  console.log(`  Models: ${models.length} | Pages: ${pages.length} | Mobile: ${mobile.length} | API: ${routes.length} | E2E: ${flows.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
