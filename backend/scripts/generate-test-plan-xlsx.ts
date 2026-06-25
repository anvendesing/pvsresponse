/**
 * Generates a comprehensive manual test plan workbook (PVS-ERP-Test-Plan.xlsx)
 * covering every Prisma model, ERP portal page, mobile screen, API route group,
 * the Manufacturing PWA, and detailed end-to-end business flows including the
 * recently added features (BOMs with operations, zone-PR putaway, work-order
 * material gate, TO refresh + release, etc.).
 *
 * Run:  npx tsx scripts/generate-test-plan-xlsx.ts
 */
import ExcelJS from "exceljs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { flows } from "./test-plan-e2e-flows.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../PVS-ERP-Test-Plan.xlsx");

// palette
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
const reseq = () => {
  seq = 0;
};

// =============================================================================
// 1. BACKEND MODELS
// =============================================================================
const models: Row[] = [
  // Auth / users
  { area: "Auth & Users", item: "User", tc: "Create user with each role", steps: "Settings → Users → add admin, supervisor, procurement, billing, warehouse, worker", expected: "User saved; appears in list with correct role badge", type: "Functional", priority: "High" },
  { area: "Auth & Users", item: "User", tc: "Unique username enforced", steps: "Create a second user with an existing username", expected: "Rejected with a clear duplicate error", type: "Validation", priority: "High" },
  { area: "Auth & Users", item: "User", tc: "Deactivate user blocks login", steps: "Set user inactive, attempt login", expected: "Login refused for inactive account", type: "Functional", priority: "High" },
  { area: "Auth & Users", item: "User", tc: "PIN login on mobile", steps: "Set 4-digit PIN; sign in on /m/login and /mfg/login", expected: "Both PWAs accept PIN; token stored per device", type: "Functional", priority: "High" },
  { area: "Auth & Users", item: "Session", tc: "Token issued on login", steps: "Login via portal and both PWAs", expected: "Bearer token returned; protected calls succeed", type: "Functional", priority: "High" },
  { area: "Auth & Users", item: "Session", tc: "Expired/invalid token", steps: "Tamper token, call protected endpoint", expected: "401 returned; portal redirects to /login, PWAs to /m/login or /mfg/login", type: "Edge", priority: "High" },

  // UOM
  { area: "Master Data", item: "UomCategory / Uom", tc: "Create UOM category & units", steps: "Settings → UOMs → add category, add base + derived units with factor", expected: "Units saved; conversion factor respected in pickers and BOM resolution", type: "Functional", priority: "Medium" },
  { area: "Master Data", item: "Uom", tc: "Conversion factor validation", steps: "Add a unit with factor 0 or negative", expected: "Rejected with validation error", type: "Validation", priority: "Medium" },
  { area: "Master Data", item: "Uom", tc: "Inactive UoMs hidden", steps: "Mark unit inactive, open product editor", expected: "Inactive units not offered in dropdowns", type: "UI", priority: "Low" },

  // Warehouse / Bin
  { area: "Warehouse", item: "Warehouse", tc: "Create storage vs production warehouse", steps: "Settings → Warehouses → create with kind=storage and kind=production", expected: "Both saved; kind shown correctly; production WH selectable on facility", type: "Functional", priority: "High" },
  { area: "Warehouse", item: "Bin", tc: "Zone / shelf / bin hierarchy", steps: "Warehouse → create A/S01/01 in STR; verify code STR.AS01.01", expected: "Tree reflects new nodes; bin code composed correctly", type: "Functional", priority: "High" },
  { area: "Warehouse", item: "Bin", tc: "Bin capacity / reservedQty integrity", steps: "Reserve stock via picking; inspect reservedQty during/after", expected: "reservedQty never exceeds qty; freed on cancel/complete", type: "Integration", priority: "High" },
  { area: "Warehouse", item: "Bin (placeholder guard)", tc: "Block warehouse-level write when zones exist", steps: "Try to Adjust Stock at warehouse level in a WH that already has real zones", expected: "409 location_level_blocked with list of available zones; no `_/<SKU>/00` bin created", type: "Validation", priority: "High" },
  { area: "Warehouse", item: "Bin (placeholder guard)", tc: "Block zone-level write when shelves exist", steps: "Try to land stock at zone-level in a zone that already has shelves", expected: "409 location_level_blocked with list of available shelves", type: "Validation", priority: "High" },
  { area: "Warehouse", item: "Bin (placeholder guard)", tc: "Block shelf-level write when bins exist", steps: "Try to drop into shelf-level when bins exist on that shelf", expected: "409 location_level_blocked with list of available bins", type: "Validation", priority: "High" },
  { area: "Warehouse", item: "STR Zone PR", tc: "Zone PR auto-creates per-product slots", steps: "Complete an MO whose FG rule routes to STR zone PR", expected: "Bin STR.PR.<SKU>.00 created/updated; warehouse tree shows STR → Zone PR → <SKU> (no shelf/bin children)", type: "Integration", priority: "High" },

  // Product / Variant
  { area: "Products", item: "Product", tc: "Create product of each type", steps: "Products → add finished, semi, raw, consumable, packaging", expected: "Saved with SKU, UOM, type; visible in list & pickers", type: "Functional", priority: "High" },
  { area: "Products", item: "Product", tc: "Duplicate SKU rejected", steps: "Create product reusing an existing SKU", expected: "Validation error", type: "Validation", priority: "High" },
  { area: "Products", item: "ProductVariant", tc: "Add variants with sizes", steps: "Open product → add variants with distinct size/SKU/barcode", expected: "Variants saved and selectable in orders/BOM/picker", type: "Functional", priority: "Medium" },
  { area: "Products", item: "Product", tc: "Barcode lookup", steps: "Assign barcode, scan via /m/scan", expected: "productByBarcode resolves to correct product", type: "Integration", priority: "Medium" },
  { area: "Products", item: "Product Supply Outlook", tc: "Effective stock = on-hand + PO + MO pipelines", steps: "Open Product detail → Supply outlook tab; add open PO/MO; refresh", expected: "Effective stock recomputes correctly; lines list pipeline rows", type: "Integration", priority: "High" },

  // Vendor / catalog
  { area: "Procurement", item: "Vendor", tc: "Create & edit vendor", steps: "Procurement → vendors → add/edit (lead time, payment terms, rating)", expected: "Vendor persisted; selectable on PO", type: "Functional", priority: "Medium" },
  { area: "Procurement", item: "VendorCatalog / VendorCatalogItem", tc: "Vendor-scoped catalog with pricing/lead", steps: "Vendor detail → add catalog items with price + lead time; reuse on PO", expected: "PO line autofills vendor price / promised date; lead time visible", type: "Integration", priority: "High" },
  { area: "Procurement", item: "VendorPerformance", tc: "On-time / quality scoring", steps: "Receive several GRNs against the vendor (some late)", expected: "Vendor card shows updated on-time %, avg delay; reports reflect", type: "Functional", priority: "Medium" },

  // Procurement
  { area: "Procurement", item: "PurchaseOrder / Item", tc: "Create PO with multiple lines", steps: "Create PO; add items with qty & price; promised dates", expected: "PO totals computed; status draft", type: "Functional", priority: "High" },
  { area: "Procurement", item: "PurchaseOrder", tc: "Auto-draft PO from stock rule (PO trigger)", steps: "Configure stock rule triggerType=po; drop bin qty below min", expected: "Draft PO created grouped by vendor; lines respect orderMultiple and maxQty", type: "Integration", priority: "High" },
  { area: "Procurement", item: "PurchaseOrder", tc: "Close PO when fulfilled", steps: "Receive remaining qty; click Close on PO; confirm modal", expected: "Status set to closed; no further GRN allowed; ledger consistent", type: "Functional", priority: "Medium" },
  { area: "Procurement", item: "Grn / GrnItem", tc: "Receive against PO (GRN)", steps: "Create GRN from PO, receive partial then full", expected: "Stock increments; PO receipt status updates; ledger 'in' rows", type: "Integration", priority: "High" },
  { area: "Procurement", item: "GrnItem (multi-bin)", tc: "Split one line across multiple bins + lots", steps: "GRN receive modal → use GrnLineAllocation to split 200 kg into 2 bins of 100 each; assign batch numbers", expected: "Two StockLot rows created (one per bin); each bin qty +100; ledger rows reference batches", type: "Integration", priority: "High" },
  { area: "Procurement", item: "GrnItem", tc: "Over-receipt guard", steps: "Receive more than ordered qty", expected: "Blocked or flagged per policy", type: "Edge", priority: "Medium" },

  // StockLot
  { area: "Inventory", item: "StockLot", tc: "Lot created on GRN receive", steps: "Receive a PO line; inspect StockLot rows", expected: "One StockLot per (bin, batch) with qtyOnHand and expiryDate", type: "Functional", priority: "High" },
  { area: "Inventory", item: "StockLot (FEFO)", tc: "Issue / pick consumes earliest-expiry first", steps: "Create two lots same product, different expiry; pick less than total", expected: "Earliest-expiry lot drains first; later lot untouched until needed", type: "Integration", priority: "High" },
  { area: "Inventory", item: "StockLot", tc: "Lot detached when bin deleted", steps: "Delete a bin that held a StockLot (no qty)", expected: "StockLot.binId nullified, lot survives", type: "Edge", priority: "Medium" },

  // Customer / payments
  { area: "Customers", item: "Customer", tc: "Create customer with credit limit", steps: "Customers → add with credit limit & terms", expected: "Saved; credit limit enforced on orders", type: "Functional", priority: "High" },
  { area: "Customers", item: "CustomerPayment / Allocation", tc: "Record payment & allocate", steps: "Customer → Record Payment; allocate to invoices", expected: "Open balance reduces; allocations tracked", type: "Integration", priority: "High" },
  { area: "Customers", item: "CustomerAccount", tc: "AR statement accuracy", steps: "Open AR statement after invoices + payments", expected: "Open balance, available credit computed correctly", type: "Functional", priority: "High" },

  // Pricing
  { area: "Pricing", item: "PriceList / Item", tc: "Create price list & items", steps: "Price Lists → create list, add item prices (selling/cost basis)", expected: "Prices apply on quotes/orders per basis", type: "Functional", priority: "High" },
  { area: "Pricing", item: "PriceListItem", tc: "Effective date / overlap", steps: "Add overlapping price entries", expected: "Correct price resolved by precedence", type: "Edge", priority: "Medium" },

  // BOM
  { area: "Manufacturing", item: "Bom / BomItem", tc: "Create simple BOM via NewBomModal", steps: "BOM page → New BOM → pick product → pick variant (or 'all') → editor opens", expected: "BOM created in draft state for the chosen scope; existing BOM detection offers Open instead", type: "Functional", priority: "High" },
  { area: "Manufacturing", item: "Bom / BomItem", tc: "Multi-level BOM explosion", steps: "Create finished BOM referencing a semi BOM; release MO", expected: "explodeBom resolves leaves with correct qty; shortages computed against leaves", type: "Integration", priority: "High" },
  { area: "Manufacturing", item: "BomOperation", tc: "Add operations / steps", steps: "Open BOM → BomOperationsPanel → add operations with sequence, machine, capacity per hour", expected: "Operations saved with seq; lines list shows them in order", type: "Functional", priority: "High" },
  { area: "Manufacturing", item: "BomOperation (split)", tc: "Split operation across machines", steps: "Open operation → Split → SplitOperationModal → choose 3 machines, allocate qty", expected: "Work orders created with splitSeq + plannedSplitQty; allowParallel honored", type: "Integration", priority: "High" },
  { area: "Manufacturing", item: "BomItem", tc: "Map item to a specific operation", steps: "Edit BomItem → assign bomOperationId", expected: "Issue / consumption respects the operation; reports group correctly", type: "Functional", priority: "Medium" },

  // ProductionOrder / WorkOrder
  { area: "Manufacturing", item: "ProductionOrder", tc: "Create MO from BOM", steps: "Create MO, set plan qty, link facility/line/machine", expected: "MO created in planned/draft status; default WOs scaffolded", type: "Functional", priority: "High" },
  { area: "Manufacturing", item: "ProductionOrder", tc: "Release MO computes shortages + TOs", steps: "Release MO with insufficient line stock", expected: "Replenishment TOs auto-created for shortages only; notes are human-readable (no raw StockRule:<id>)", type: "Integration", priority: "High" },
  { area: "Manufacturing", item: "ProductionOrder", tc: "Issue materials strict to line WH", steps: "Issue materials with requireMoReleaseBeforeIssue on", expected: "Consumes only from production-line warehouse; clear error if short", type: "Integration", priority: "High" },
  { area: "Manufacturing", item: "ProductionOrder", tc: "Complete MO lands FG with rule routing", steps: "Complete MO whose FG putaway rule points to STR zone PR; production WH ≠ STR", expected: "FG landed in line WH; putaway TO auto-created to STR.PR.<SKU>.00; ledger updated", type: "Integration", priority: "High" },
  { area: "Manufacturing", item: "ProductionOrder", tc: "Complete MO with same-warehouse rule (no TO)", steps: "Vacuum-pack MO at WC-VACUUM (production WH = STR) with rule → STR zone PR", expected: "FG lands directly into STR.PR.<SKU>.00; NO putaway TO is created", type: "Integration", priority: "High" },
  { area: "Manufacturing", item: "ProductionOrder", tc: "Cancel MO rolls back stock", steps: "Cancel an issued / partially produced MO", expected: "Consumed materials restored; FG produced removed; ledger paired entries", type: "Edge", priority: "High" },
  { area: "Manufacturing", item: "WorkOrder (material gate)", tc: "Start WO blocked until materials issued", steps: "Try Start on a WO before Issue Materials; then issue and retry", expected: "First attempt rejected with materials_not_issued (UI shows amber banner + Locked button); after issue, Start succeeds", type: "Integration", priority: "High" },
  { area: "Manufacturing", item: "WorkOrder (material gate)", tc: "Complete WO blocked until materials issued", steps: "Repeat the gate for Complete action", expected: "Same gate; BOMs with zero consumables bypass (service-only)", type: "Integration", priority: "High" },
  { area: "Manufacturing", item: "WorkOrder", tc: "QA capture on completion", steps: "Complete WO with QA result + notes", expected: "qaStatus and qaNotes persisted; visible in MO detail", type: "Functional", priority: "Medium" },
  { area: "Manufacturing", item: "WorkOrder (blocking)", tc: "Sequential blocking via blockedByWorkOrderId", steps: "Set WO2.blockedByWorkOrderId = WO1.id; try Start WO2 before WO1 done", expected: "Rejected with blocked_by_prior_wo; succeeds after WO1 complete", type: "Integration", priority: "High" },
  { area: "Manufacturing", item: "ProductionFacility", tc: "Create facility with production WH + zone", steps: "Settings → Production facilities → add facility; set productionLineWarehouse + productionZone", expected: "Facility saved; MO release/complete uses the zone for landing/issuing", type: "Functional", priority: "High" },
  { area: "Manufacturing", item: "ProductionFacility", tc: "Replenish-from list", steps: "Set replenishWarehouseCodes (csv) on facility", expected: "MO release picks materials from listed WHs in priority order", type: "Integration", priority: "High" },
  { area: "Manufacturing", item: "ProductionLine / Machine", tc: "Create line + machines", steps: "Add line; add machines linked to line", expected: "Selectable on WOs; machine busy status updates as WOs run", type: "Functional", priority: "Medium" },

  // Workforce
  { area: "Workforce", item: "Worker / Attendance", tc: "Mark attendance", steps: "Productivity → record attendance in/out", expected: "Attendance saved; productivity metrics update", type: "Functional", priority: "Medium" },

  // Putaway / Transfers
  { area: "Transfers", item: "PutawayRule", tc: "Create variant & product rules", steps: "Settings → Putaway rules → add variant-level and product-level rule", expected: "Saved; barcode + variant columns populate; @@unique honored", type: "Functional", priority: "High" },
  { area: "Transfers", item: "PutawayRule (zone-only)", tc: "Create zone-only rule (toZone=PR, no bin)", steps: "Add rule with destination zone PR and no bin", expected: "Saved; list shows 'Zone PR · auto-slot'; bin selector disabled when zone is set", type: "Functional", priority: "High" },
  { area: "Transfers", item: "PutawayRule (zone-only)", tc: "Zone-only rule routes FG into per-product slot", steps: "Complete MO for a product with zone-PR rule", expected: "Stock lands at STR.PR.<SKU>.00 (auto-created); not in zone _", type: "Integration", priority: "High" },
  { area: "Transfers", item: "PutawayRule", tc: "Resolution waterfall", steps: "Variant rule + product rule + fallback present; complete variant MO", expected: "Variant rule wins → product rule → fallback storage WH", type: "Integration", priority: "High" },
  { area: "Transfers", item: "PutawayRule (semi skip)", tc: "Semi products don't get rules", steps: "Re-run seed-stock-room-zone-pr; audit by type", expected: "Only finished products carry rules; semi/raw/packaging untouched", type: "Functional", priority: "Medium" },
  { area: "Transfers", item: "TransferOrder", tc: "Manual transfer creation", steps: "Transfers page → Create Transfer with lines", expected: "TO created kind=manual, status ready", type: "Functional", priority: "High" },
  { area: "Transfers", item: "TransferOrder", tc: "Pick decrements source", steps: "Mobile → claim → pick from source bin", expected: "Source Bin.qty down; ledger 'out'; status in_transit", type: "Integration", priority: "High" },
  { area: "Transfers", item: "TransferOrder", tc: "Drop increments destination", steps: "Mobile → drop into destination bin", expected: "Dest Bin.qty up; ledger 'in'; status done", type: "Integration", priority: "High" },
  { area: "Transfers", item: "TransferOrder (release)", tc: "Release claim back to pool", steps: "Claim a TO, then tap 'Release for another worker' on mobile", expected: "assignedToId cleared; TO returns to /m/tasks Available; another worker can claim", type: "Functional", priority: "High" },
  { area: "Transfers", item: "TransferOrder (release)", tc: "Only assignee / supervisor can release", steps: "Try /release as a different worker", expected: "403 forbidden", type: "Permission", priority: "High" },
  { area: "Transfers", item: "TransferOrder (refresh)", tc: "Refresh source bins after stock arrives", steps: "Open TO with empty source bins → tap 'Refresh source bins' after stock is adjusted in", expected: "/resolve-source-bins picks best bins; line fromBinId set; UI updates without re-creating the TO", type: "Functional", priority: "High" },
  { area: "Transfers", item: "TransferOrder", tc: "Cancel releases reservation", steps: "Cancel a ready/draft TO", expected: "Status cancelled; reservedQty released", type: "Functional", priority: "High" },
  { area: "Transfers", item: "TransferOrderItem", tc: "Partial pick/drop", steps: "Pick less than requested then drop", expected: "qtyPicked/qtyDropped tracked; variance visible", type: "Edge", priority: "Medium" },
  { area: "Transfers", item: "TransferOrder", tc: "Auto-replenish TO notes are readable", steps: "Trigger a stock-rule-driven transfer; inspect notes on the TO", expected: "Notes show product, qty, source→dest in plain text; StockRule:<id> marker only appears at the end (used internally)", type: "Functional", priority: "Medium" },

  // Stock ledger
  { area: "Inventory", item: "StockLedger", tc: "Every movement writes a ledger row", steps: "Perform GRN, issue, transfer, adjust, complete MO", expected: "Each produces in/out ledger entries with ref; balances tally", type: "Integration", priority: "High" },
  { area: "Inventory", item: "BinCount", tc: "Cycle count adjustment", steps: "Warehouse audit → count a bin, apply variance", expected: "Bin.qty corrected; adjustment ledger row", type: "Functional", priority: "Medium" },

  // Sales / fulfilment
  { area: "Sales", item: "Quote / Item / Revision", tc: "Create quote, revise, share", steps: "Quotes → create, edit to new revision, share public link", expected: "Revisions versioned; public link renders", type: "Functional", priority: "High" },
  { area: "Sales", item: "SalesOrder / Item", tc: "Convert quote → SO", steps: "Accept quote, generate SO", expected: "SO created with lines; status open", type: "Integration", priority: "High" },
  { area: "Fulfilment", item: "PickList / Item", tc: "Generate pick list from SO", steps: "Picking → create pick list", expected: "Pick lines with bin allocations; reservedQty set", type: "Integration", priority: "High" },
  { area: "Fulfilment", item: "PackingSlip / Item", tc: "Pack picked items", steps: "Packing → pack from completed pick", expected: "Packing slip created; qty reconciled", type: "Integration", priority: "High" },
  { area: "Fulfilment", item: "PackingContainer / ContainerType", tc: "Multi-container pack", steps: "Pack into 2+ containers with different types", expected: "Containers tracked; weights aggregated; print shows per-container labels", type: "Integration", priority: "Medium" },

  // Billing
  { area: "Billing", item: "Invoice / Item", tc: "Generate invoice from SO/packing", steps: "Billing → create invoice", expected: "Invoice totals, tax computed; AR updated", type: "Integration", priority: "High" },
  { area: "Billing", item: "Invoice", tc: "Public invoice share link", steps: "Share invoice, open /share/invoice/:token", expected: "Read-only invoice renders for token", type: "Functional", priority: "Medium" },

  // Transport
  { area: "Transport", item: "DispatchOrder / Trip", tc: "Create dispatch & trip", steps: "Transport → create dispatch, assign to trip", expected: "Trip groups dispatches; status flow valid", type: "Functional", priority: "Medium" },

  // Returns / credit
  { area: "Returns", item: "CustomerReturn / Item", tc: "Create return", steps: "Returns → create against invoice/SO, add items", expected: "Return recorded; stock optionally restocked", type: "Functional", priority: "Medium" },
  { area: "Returns", item: "CreditNote / Item", tc: "Issue credit note", steps: "Generate credit note from return", expected: "Credit applied to customer balance", type: "Integration", priority: "Medium" },

  // Stock rules
  { area: "Inventory", item: "StockRule (MO trigger)", tc: "MO drafted when bin below min", steps: "Set rule with triggerType=mo, BOM linked; drain bin below min", expected: "Draft MO created; honors orderMultiple; visible in Manufacturing", type: "Integration", priority: "High" },
  { area: "Inventory", item: "StockRule (Transfer)", tc: "Transfer drafted when bin below min", steps: "Set transfer rule; drain monitored bin", expected: "Replenishment TO created with sourceBin/toBin populated; notes readable", type: "Integration", priority: "High" },
  { area: "Inventory", item: "StockRule (PO trigger)", tc: "PO grouped per vendor", steps: "Multiple rules with triggerType=po and same vendor; trigger them in one cycle", expected: "Single draft PO per vendor with all lines; vendor catalog price applied", type: "Integration", priority: "High" },
  { area: "Inventory", item: "StockRule (Supply Outlook)", tc: "Outlook column reflects pipelines", steps: "Open Settings → Stock rules", expected: "Outlook shows on-hand + open PO + open MO totals; effective vs min visualized", type: "UI", priority: "Medium" },
  { area: "Inventory", item: "StockRule UI columns", tc: "Barcode + variant columns", steps: "Open Stock rules table", expected: "Columns: Product, Barcode, Variant, Variant BC, Monitor bin, Min, Supply outlook, Trigger, Action/tags, Status", type: "UI", priority: "Medium" },

  // Approvals / audit / sync
  { area: "Governance", item: "Approval", tc: "Approval request & decision", steps: "Trigger approvable action, approve/reject", expected: "Status updates; gated action proceeds only on approve", type: "Functional", priority: "Medium" },
  { area: "Governance", item: "AuditLog", tc: "Sensitive actions logged", steps: "Edit price/credit limit, inspect audit log", expected: "Entry with actor, before/after captured", type: "Functional", priority: "Medium" },
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

  // Products
  { area: "Page", item: "Products", tc: "List, search, CRUD, variants", steps: "Search, add/edit/delete product, manage variants", expected: "All operations reflect immediately", type: "Functional", priority: "High" },
  { area: "Page", item: "Products", tc: "Supply outlook panel", steps: "Open product detail → Supply outlook tab", expected: "Effective stock, on-hand, PO + MO pipelines, lines rendered", type: "UI", priority: "High" },

  // Procurement
  { area: "Page", item: "Procurement", tc: "PO & GRN workflow", steps: "Create PO, receive GRN partial then full", expected: "Stock & statuses update; vendor catalog auto-fills prices", type: "Functional", priority: "High" },
  { area: "Page", item: "Procurement", tc: "Close PO confirm modal", steps: "Click Close on a partially received PO", expected: "ClosePoConfirmModal explains residual qty; confirming closes PO", type: "UI", priority: "Medium" },
  { area: "Page", item: "Procurement", tc: "Vendor detail modal", steps: "Open vendor row", expected: "VendorDetailModal shows performance, catalog items, recent POs", type: "UI", priority: "Medium" },
  { area: "Page", item: "Procurement", tc: "GRN multi-bin allocation", steps: "Receive a GRN line → GrnLineAllocation → split across bins with batches", expected: "Total = ordered qty; each split lands in correct bin with lot row", type: "Functional", priority: "High" },

  // Pricing
  { area: "Page", item: "PriceLists", tc: "Manage price lists", steps: "Create list, add/edit items", expected: "Prices saved and applied", type: "Functional", priority: "High" },

  // Customers
  { area: "Page", item: "Customers", tc: "Customer & AR management", steps: "CRUD customer, record payment, open statement", expected: "Balances accurate", type: "Functional", priority: "High" },

  // Sales
  { area: "Page", item: "Quotes", tc: "Quote lifecycle & share", steps: "Create/revise/share/accept", expected: "Revisions & sharing work", type: "Functional", priority: "High" },
  { area: "Page", item: "SalesOrders", tc: "SO management", steps: "Create SO, edit lines, progress status", expected: "SO flows to fulfilment", type: "Functional", priority: "High" },

  // Fulfilment
  { area: "Page", item: "Picking", tc: "Pick list generation & tracking", steps: "Generate, assign, monitor", expected: "Pick lines & status correct", type: "Functional", priority: "High" },
  { area: "Page", item: "Packing", tc: "Packing slip workflow", steps: "Pack from pick, print slip", expected: "Packing slip created/printable", type: "Functional", priority: "High" },
  { area: "Page", item: "Returns", tc: "Returns & credit notes", steps: "Create return, issue credit", expected: "Return & credit reflected", type: "Functional", priority: "Medium" },

  // Inventory / Warehouse
  { area: "Page", item: "Inventory", tc: "Stock view & adjust", steps: "View on-hand, adjust qty, view ledger", expected: "Adjustments tracked in ledger", type: "Functional", priority: "High" },
  { area: "Page", item: "Inventory (location guard)", tc: "Adjust into placeholder zone blocked", steps: "Try Adjust Stock at warehouse-level for a WH with zones", expected: "409 with explanatory message + list of zones to pick from", type: "Validation", priority: "High" },
  { area: "Page", item: "Warehouse", tc: "Bin tree collapses placeholders", steps: "Browse Stock Room tree", expected: "Zone PR / zone A/B/C shown; no `Zone _` or `Zone WH` nodes; bin/shelf-level stock renders as a leaf with qty", type: "UI", priority: "High" },
  { area: "Page", item: "Warehouse", tc: "Zone PR shows SKU leaves only", steps: "Expand STR → Zone PR", expected: "Per-product leaves like 'WHET (100 kg)'; no shelf or bin sub-folders", type: "UI", priority: "High" },
  { area: "Page", item: "Warehouse", tc: "Transfers button navigates", steps: "Click 'Transfers' in toolbar", expected: "Routes to /transfers", type: "UI", priority: "High" },

  // Transfers page
  { area: "Page", item: "Transfers", tc: "KPI row counts", steps: "Open /transfers", expected: "Pending/In-Transit/Done today/Cancelled correct", type: "Functional", priority: "High" },
  { area: "Page", item: "Transfers", tc: "Tab filtering", steps: "Switch All/Putaway/Replenishment/Manual", expected: "Table filters; tab counts correct", type: "Functional", priority: "High" },
  { area: "Page", item: "Transfers", tc: "Row detail slide-over", steps: "Click a row", expected: "Slide-over shows items, pick/drop timestamps, meta", type: "UI", priority: "High" },
  { area: "Page", item: "Transfers", tc: "Create Transfer modal", steps: "Create TO with warehouses + product lines", expected: "Validates warehouses & lines; TO created; list refreshes", type: "Functional", priority: "High" },
  { area: "Page", item: "Transfers", tc: "Admin assign / reassign", steps: "From slide-over, assign TO to a worker; then reassign", expected: "Assignment + note recorded; worker sees TO under /m/tasks Claimed", type: "Functional", priority: "Medium" },
  { area: "Page", item: "Transfers", tc: "Cancel from slide-over", steps: "Cancel a draft/ready TO", expected: "Cancelled; list refreshes; closed panel", type: "Functional", priority: "High" },

  // Warehouse audit
  { area: "Page", item: "WarehouseAudit", tc: "Cycle count flow", steps: "Count bins, apply variances", expected: "Counts recorded; stock corrected", type: "Functional", priority: "Medium" },

  // Manufacturing
  { area: "Page", item: "Manufacturing", tc: "MO list filters", steps: "Filter by status, facility, line, machine", expected: "Table filters apply; counts correct", type: "Functional", priority: "High" },
  { area: "Page", item: "Manufacturing", tc: "Create MO modal (NewMoModal)", steps: "Open New MO → pick BOM → set qty → optional line/machine + due date", expected: "MO created in planned; default WOs pre-scaffolded from BOM operations", type: "Functional", priority: "High" },
  { area: "Page", item: "Manufacturing", tc: "Release MO + see shortages", steps: "Release MO with insufficient line stock", expected: "Shortage list shown; auto-replenishment TOs created with readable notes", type: "Integration", priority: "High" },
  { area: "Page", item: "Manufacturing", tc: "Issue materials", steps: "Issue once stock at line; verify consumption rows in ledger", expected: "Materials consumed from production WH only; SOH decremented", type: "Integration", priority: "High" },
  { area: "Page", item: "Manufacturing", tc: "Work orders panel", steps: "MO detail → MoWorkOrdersPanel → start a WO before issuing; then issue and start", expected: "First Start rejected; after issue, Start succeeds; QA fields editable on complete", type: "Integration", priority: "High" },
  { area: "Page", item: "Manufacturing", tc: "Complete MO + putaway TO", steps: "Log good qty; complete MO", expected: "FG landed; putaway TO created for non-vacuum rooms; ledger entries created", type: "Integration", priority: "High" },
  { area: "Page", item: "Manufacturing", tc: "Cancel MO", steps: "Cancel a partially completed MO", expected: "All consumptions/productions reversed; status cancelled", type: "Edge", priority: "High" },

  // BOM
  { area: "Page", item: "BOMs", tc: "Sortable table renders", steps: "Open /boms", expected: "Columns: Product, Variant, Revision, Type, Items, Output, Status, Actions; filterable", type: "UI", priority: "High" },
  { area: "Page", item: "BOMs", tc: "Search by SKU / variant / revision", steps: "Type in the search box", expected: "Table narrows live; counts update", type: "UI", priority: "High" },
  { area: "Page", item: "BOMs", tc: "New BOM modal — two step", steps: "New BOM → step 1 pick product → step 2 pick variant or product-level → opens BomEditor", expected: "Modal warns if BOM already exists for the scope and offers Open; otherwise creates and routes to editor", type: "Functional", priority: "High" },
  { area: "Page", item: "BomEditor", tc: "Add / edit / remove items", steps: "Open BOM → add items with qty + uom + scrap%", expected: "Lines saved; outputQty + uom edits persist", type: "Functional", priority: "High" },
  { area: "Page", item: "BomEditor", tc: "Map item to a BomOperation", steps: "Per line, pick the operation it belongs to", expected: "Line carries bomOperationId; consumption respects operation", type: "Functional", priority: "Medium" },
  { area: "Page", item: "BomOperationsPanel", tc: "Add operations and reorder", steps: "Add steps with sequence, machine, capacity per hour, allowParallel", expected: "Operations listed in sequence; drag-reorder updates seq", type: "Functional", priority: "High" },
  { area: "Page", item: "SplitOperationModal", tc: "Split operation across machines", steps: "Choose 3 machines; allocate qty per machine", expected: "Work orders created with splitSeq; capacity totals match; release schedules them in parallel", type: "Integration", priority: "High" },

  // Productivity / Transport / Billing
  { area: "Page", item: "Productivity", tc: "Attendance & metrics", steps: "Record attendance, view productivity", expected: "Metrics compute", type: "Functional", priority: "Medium" },
  { area: "Page", item: "Transport", tc: "Dispatch & trips", steps: "Create dispatch, build trip", expected: "Trip management works", type: "Functional", priority: "Medium" },
  { area: "Page", item: "Billing", tc: "Invoice & payment", steps: "Create invoice, record payment", expected: "AR & invoice status update", type: "Functional", priority: "High" },

  // Reports / approvals
  { area: "Page", item: "Reports", tc: "Render all reports", steps: "Open each report incl. transfer throughput, SKUs missing putaway rules, vendor performance, MO efficiency", expected: "Data renders; filters work", type: "Functional", priority: "Medium" },
  { area: "Page", item: "Approvals", tc: "Approve/reject queue", steps: "Process approval items", expected: "Decisions persist & gate actions", type: "Functional", priority: "Medium" },

  // Settings
  { area: "Page", item: "Settings → Putaway rules", tc: "All columns visible", steps: "Open Settings → Putaway rules", expected: "Columns: Product, Barcode, Variant, Variant BC, Destination WH, Bin, Priority, Status, Actions", type: "UI", priority: "High" },
  { area: "Page", item: "Settings → Putaway rules", tc: "Add zone-only rule", steps: "Add rule → fill product + destination zone PR (no bin)", expected: "Saved with toZone='PR'; row shows 'Zone PR · auto-slot'", type: "Functional", priority: "High" },
  { area: "Page", item: "Settings → Putaway rules", tc: "Add fixed-bin rule", steps: "Add rule → pick destination bin (no zone)", expected: "Saved with toBinId; row shows the bin path", type: "Functional", priority: "High" },
  { area: "Page", item: "Settings → Stock rules", tc: "Barcode + variant columns", steps: "Open Settings → Stock rules", expected: "Columns: Product, Barcode, Variant, Variant BC, Monitor bin, Min, Supply outlook, Trigger, Action/tags, Status", type: "UI", priority: "High" },
  { area: "Page", item: "Settings → Production facilities", tc: "Set productionZone + replenish list", steps: "Edit facility → productionZone='A'; replenishWarehouseCodes='STR,WH-STO-COLD-1'", expected: "Persisted; MO release uses listed WHs in order; MO complete lands at zone A when production WH = STR", type: "Functional", priority: "High" },
  { area: "Page", item: "Settings", tc: "All settings sections", steps: "UOMs, Warehouses, Work centers/facilities, Putaway rules, Stock rules, Users, Company profile", expected: "Each section CRUD works", type: "Functional", priority: "High" },

  // Store / share / print
  { area: "Page", item: "Store", tc: "Storefront browse", steps: "Open /store, browse catalog", expected: "Catalog renders", type: "UI", priority: "Low" },
  { area: "Page", item: "Public share pages", tc: "Quote/Invoice/SO/PackingSlip share", steps: "Open each /share/* token URL", expected: "Read-only docs render; invalid token handled", type: "Functional", priority: "Medium" },
  { area: "Page", item: "Print pages", tc: "Pick list & packing slip print", steps: "Open /print/pick-list/:id and /print/packing-slip/:id", expected: "Print-friendly layout renders", type: "UI", priority: "Low" },
];

// =============================================================================
// 3. WAREHOUSE MOBILE PWA (/m/*)
// =============================================================================
const mobile: Row[] = [
  { area: "Mobile", item: "MobileLogin", tc: "Login on device", steps: "Open /m/login, sign in with PIN; select warehouse", expected: "Token stored; routed to /m/tasks; device pinned to chosen WH", type: "Functional", priority: "High" },
  { area: "Mobile", item: "MobileTasks", tc: "Pick/Pack/Move tabs & counts", steps: "Open /m/tasks, switch tabs", expected: "Claimed & available buckets correct incl. transfers", type: "Functional", priority: "High" },
  { area: "Mobile", item: "MobileTasks", tc: "Claim task", steps: "Claim a pick/pack/transfer", expected: "Moves to 'Mine'; assignment recorded server-side", type: "Functional", priority: "High" },
  { area: "Mobile", item: "MobilePick / MobilePickLine", tc: "Pick line scan-confirm", steps: "Open pick, scan bin & product, confirm qty", expected: "Lines complete; reservation consumed", type: "Functional", priority: "High" },
  { area: "Mobile", item: "MobilePack", tc: "Pack confirm", steps: "Open pack, confirm items", expected: "Packing slip progresses", type: "Functional", priority: "High" },

  // Transfer + the new actions
  { area: "Mobile", item: "MobileTransfer", tc: "Sequential pick → drop", steps: "Open /m/transfers/:id, pick from source then drop to dest", expected: "Bin qty moves; TO done", type: "Functional", priority: "High" },
  { area: "Mobile", item: "MobileTransfer (refresh)", tc: "Refresh source bins button", steps: "Open a TO whose source bins are empty; adjust stock in; tap 'Refresh source bins'", expected: "Backend re-resolves bins; success/partial/full-miss message; UI updates without losing the TO", type: "Functional", priority: "High" },
  { area: "Mobile", item: "MobileTransfer (release)", tc: "Release for another worker", steps: "Claim a TO; tap 'Release for another worker'; confirm", expected: "TO returns to Available; navigates back to /m/tasks; another worker can claim", type: "Functional", priority: "High" },
  { area: "Mobile", item: "MobileTransfer", tc: "Cancel transfer", steps: "Cancel an in-progress TO", expected: "TO cancelled; stock consistent", type: "Edge", priority: "Medium" },
  { area: "Mobile", item: "MobileTransfer (notes)", tc: "Auto-replenish notes look clean", steps: "Open an incoming TO triggered by stock rule", expected: "No raw 'StockRule:<id>' visible; notes show product/qty/source→dest", type: "UI", priority: "Medium" },

  // GRN mobile
  { area: "Mobile", item: "MobileGrn", tc: "Receive with multi-bin allocation", steps: "Open a GRN, allocate split across bins, capture batch + expiry", expected: "StockLot rows created per bin/batch; bin qty incremented", type: "Integration", priority: "High" },
  { area: "Mobile", item: "MobileBulkZone", tc: "Bulk zone scan + reassign", steps: "Scan zone, reassign multiple bins quickly", expected: "Each reassignment writes a BinCount row", type: "Functional", priority: "Medium" },

  // Scan / lookups
  { area: "Mobile", item: "MobileScan", tc: "Barcode scan routing", steps: "Scan product/bin/zone barcode", expected: "Resolves to correct entity screen; logs ScanEvent", type: "Functional", priority: "Medium" },
  { area: "Mobile", item: "MobileLocation", tc: "Location lookup with collapsible list", steps: "Open /m/loc/:code; expand groupings", expected: "CollapsibleLocationList renders zone → shelf → bin counts", type: "UI", priority: "Medium" },
  { area: "Mobile", item: "MobileBin", tc: "Bin detail", steps: "Open /m/bin/:binId", expected: "Bin contents & actions render", type: "Functional", priority: "Low" },
  { area: "Mobile", item: "MobileProfile", tc: "Profile & logout", steps: "Open /m/profile, logout", expected: "Session cleared; back to /m/login", type: "Functional", priority: "Medium" },
  { area: "Mobile", item: "Offline/Sync", tc: "Offline action then sync", steps: "Go offline, perform action, reconnect", expected: "Queued action syncs; conflicts surfaced", type: "Integration", priority: "High" },
];

// =============================================================================
// 4. MANUFACTURING PWA (/mfg/*) — NEW
// =============================================================================
const mfg: Row[] = [
  { area: "Mfg PWA", item: "MfgLogin", tc: "Login flow: Who → PIN → Room", steps: "Open /mfg/login → pick user → enter PIN → choose production facility", expected: "Token stored; device pinned to production facility (useDeviceFacility persists in localStorage)", type: "Functional", priority: "High" },
  { area: "Mfg PWA", item: "MfgShell", tc: "Header shows facility + greeting", steps: "After login, inspect header", expected: "Facility code (small caps) above greeting + worker first name; blue brand color (#003087)", type: "UI", priority: "High" },
  { area: "Mfg PWA", item: "MfgShell", tc: "Bottom tabs: Room / Transfers / Profile", steps: "Tap each tab", expected: "Navigates to /mfg/room, /mfg/transfers, /mfg/profile; active tab highlighted", type: "UI", priority: "High" },
  { area: "Mfg PWA", item: "MfgShell", tc: "Online/offline pill", steps: "Go offline; observe header", expected: "Pill flips to offline indicator; sync paused", type: "UI", priority: "Medium" },

  // Room dashboard
  { area: "Mfg PWA", item: "MfgRoom", tc: "MO buckets render", steps: "Open /mfg/room", expected: "MOs grouped as 'Up next', 'In progress', 'Quality check', 'Done today'; counts correct", type: "Functional", priority: "High" },
  { area: "Mfg PWA", item: "MfgRoom", tc: "Tap MO opens detail", steps: "Tap any MO card", expected: "Navigates to /mfg/mo/:id", type: "UI", priority: "High" },

  // MO detail
  { area: "Mfg PWA", item: "MfgMo", tc: "Materials requirements visible", steps: "Open MO detail; review Materials section", expected: "Required, issued, shortage qty shown per line", type: "Functional", priority: "High" },
  { area: "Mfg PWA", item: "MfgMo (Release)", tc: "Release for production triggers TOs", steps: "Tap 'Release for production' on an MO with shortages", expected: "/release called; auto TOs created for shortages; banner refreshes; missing materials listed", type: "Integration", priority: "High" },
  { area: "Mfg PWA", item: "MfgMo (Custom request)", tc: "Material Request Modal", steps: "Tap 'Custom material request' → choose source WH → adjust line qty → submit", expected: "Manual TO created (kind=manual) linked to MO; appears in /mfg/transfers", type: "Functional", priority: "High" },
  { area: "Mfg PWA", item: "MfgMo (Issue)", tc: "Issue materials to MO", steps: "Tap 'Issue materials to this MO' after stock at line", expected: "/issue-materials consumes from production WH only; SOH decremented; requirements.materialsIssued=true", type: "Integration", priority: "High" },
  { area: "Mfg PWA", item: "MfgMo (WO gate)", tc: "Start/Done locked until materials issued", steps: "Try Start on WO before issue; amber banner; issue; retry", expected: "Buttons show 'Locked' until materialsIssued is true; then Start succeeds", type: "Integration", priority: "High" },
  { area: "Mfg PWA", item: "MfgMo (Log output)", tc: "Log good + scrap qty", steps: "Log output form → good=X, scrap=Y", expected: "Production rows posted; aggregate actualQty grows; FG slot increments per putaway rule", type: "Integration", priority: "High" },
  { area: "Mfg PWA", item: "MfgMo (Complete)", tc: "Complete MO", steps: "Tap 'Complete MO' after WOs done", expected: "MO status=completed; FG landed; putaway TO created if rule WH ≠ production WH; no TO when same WH (vacuum pack)", type: "Integration", priority: "High" },

  // Transfers
  { area: "Mfg PWA", item: "MfgTransfers", tc: "Incoming TO list by status", steps: "Open /mfg/transfers", expected: "Sorted: Ready, In transit, Draft, Done, Cancelled; notes use prettyNotes (no StockRule:<id> tokens)", type: "UI", priority: "High" },
  { area: "Mfg PWA", item: "MfgTransfers", tc: "Tap TO opens MobileTransfer screen", steps: "Tap a Ready TO", expected: "Routes into the shared /m/transfers/:id flow with the blue PWA shell", type: "Functional", priority: "High" },

  // Profile
  { area: "Mfg PWA", item: "MfgProfile", tc: "Switch room", steps: "/mfg/profile → pick another facility → confirm", expected: "useDeviceFacility writes new facility; room dashboard reloads against new facility", type: "Functional", priority: "High" },
  { area: "Mfg PWA", item: "MfgProfile", tc: "Forget room", steps: "Tap 'Forget this room'", expected: "facility cleared; user prompted to choose a room next login", type: "Functional", priority: "Medium" },
  { area: "Mfg PWA", item: "MfgProfile", tc: "Sign out", steps: "Tap 'Sign out'", expected: "auth.clear() runs; routed to /mfg/login", type: "Functional", priority: "Medium" },
];

// =============================================================================
// 5. API ROUTE GROUPS
// =============================================================================
const routes: Row[] = [
  { area: "API", item: "auth", tc: "Login/refresh/logout", steps: "Hit auth endpoints", expected: "Tokens issued/cleared; 401 on bad creds", type: "Functional", priority: "High" },
  { area: "API", item: "settings", tc: "Company profile & masters", steps: "GET/PATCH settings", expected: "Admin-only; values persist", type: "Permission", priority: "High" },
  { area: "API", item: "uoms", tc: "UOM CRUD", steps: "CRUD uoms", expected: "Validations enforced", type: "Functional", priority: "Medium" },
  { area: "API", item: "catalog", tc: "Product/variant catalog", steps: "GET products, by-barcode", expected: "Correct data & lookups", type: "Functional", priority: "High" },
  { area: "API", item: "catalog", tc: "Product supply outlook", steps: "GET /products/:id/supply-outlook", expected: "Returns on-hand + PO + MO pipelines with row breakdown", type: "Integration", priority: "High" },
  { area: "API", item: "pricing", tc: "Price list endpoints", steps: "CRUD price lists/items", expected: "Pricing resolution correct", type: "Functional", priority: "High" },
  { area: "API", item: "procurement", tc: "PO & GRN", steps: "Create PO, post GRN (with multi-bin allocation)", expected: "Stock & status update; StockLot rows per allocation", type: "Integration", priority: "High" },
  { area: "API", item: "procurement", tc: "Vendor catalog endpoints", steps: "CRUD /vendors/:id/catalog", expected: "Catalog persisted; PO lines autofill from catalog", type: "Functional", priority: "Medium" },
  { area: "API", item: "inventory", tc: "Stock query & adjust", steps: "GET stock, POST adjust", expected: "Ledger rows written", type: "Integration", priority: "High" },
  { area: "API", item: "inventory (guard)", tc: "Adjust placeholder zone rejected", steps: "POST adjust against `_/<SKU>/00` slot when WH has zones", expected: "409 location_level_blocked with `level` and `available` payload", type: "Validation", priority: "High" },
  { area: "API", item: "locations", tc: "/me/tasks buckets", steps: "GET /me/tasks", expected: "pick/pack/transfer claimed+available counts correct", type: "Functional", priority: "High" },

  // Transfers including new endpoints
  { area: "API", item: "transfers", tc: "Putaway rules CRUD + toZone", steps: "POST/PATCH /putaway-rules with toZone='PR'; GET", expected: "Returned rows carry toZone; auto-uppercased server side", type: "Functional", priority: "High" },
  { area: "API", item: "transfers", tc: "TO lifecycle: create/claim/pick/drop/cancel", steps: "Run the full lifecycle", expected: "State transitions atomic; ledger consistent", type: "Integration", priority: "High" },
  { area: "API", item: "transfers", tc: "POST /transfer-orders/:id/release", steps: "Claim a TO; POST /release as assignee", expected: "200; TO assignedToId cleared; status remains 'ready'", type: "Functional", priority: "High" },
  { area: "API", item: "transfers", tc: "Release perms", steps: "POST /release as another worker", expected: "403 forbidden", type: "Permission", priority: "High" },
  { area: "API", item: "transfers", tc: "Release status guard", steps: "POST /release on an in_transit TO", expected: "409 invalid_status", type: "Edge", priority: "High" },
  { area: "API", item: "transfers", tc: "POST /transfer-orders/:id/resolve-source-bins", steps: "Call against a TO with null fromBinId after stock arrives", expected: "200; response carries resolved + stillMissing arrays; TO items updated", type: "Functional", priority: "High" },
  { area: "API", item: "transfers", tc: "Resolve-source-bins status guard", steps: "Call once status is in_transit", expected: "409 invalid_status", type: "Edge", priority: "Medium" },

  // Manufacturing
  { area: "API", item: "manufacturing", tc: "BOM CRUD with operations", steps: "POST /boms, /boms/:id/operations", expected: "BOM persists with items + operations; explodeBom respects mappings", type: "Functional", priority: "High" },
  { area: "API", item: "manufacturing", tc: "Split operation endpoint", steps: "POST /boms/:id/operations/:opId/split", expected: "Creates parallel WO records with splitSeq + plannedSplitQty", type: "Integration", priority: "High" },
  { area: "API", item: "manufacturing", tc: "MO release", steps: "POST /production-orders/:id/release", expected: "Creates shortages + replenishment TOs; releases machines/queues", type: "Integration", priority: "High" },
  { area: "API", item: "manufacturing", tc: "MO requirements", steps: "GET /production-orders/:id/requirements", expected: "Returns per-line required/issued/shortage; materialsIssued flag", type: "Functional", priority: "High" },
  { area: "API", item: "manufacturing", tc: "MO issue materials (line WH strict)", steps: "POST /production-orders/:id/issue-materials", expected: "Consumes only from production line WH; 409 if short", type: "Integration", priority: "High" },
  { area: "API", item: "manufacturing", tc: "WO start blocked w/o materials", steps: "POST /work-orders/:id/start before issue", expected: "409 materials_not_issued (except zero-consumable service BOMs)", type: "Integration", priority: "High" },
  { area: "API", item: "manufacturing", tc: "WO complete + QA", steps: "POST /work-orders/:id/complete with QA fields", expected: "qaStatus/qaNotes persisted; machine released if no other open WO", type: "Integration", priority: "High" },
  { area: "API", item: "manufacturing", tc: "MO log output", steps: "POST /production-orders/:id/log-output", expected: "Production ledger row; FG bin updated via putaway rule", type: "Integration", priority: "High" },
  { area: "API", item: "manufacturing", tc: "MO complete + same-WH skip TO", steps: "POST /production-orders/:id/complete for vacuum-pack MO", expected: "FG lands at STR.PR.<SKU>.00; no putaway TO row created", type: "Integration", priority: "High" },
  { area: "API", item: "manufacturing", tc: "MO complete + cross-WH TO", steps: "Complete an MO whose rule destination ≠ production WH", expected: "Putaway TO created kind='putaway' linked to MO; ready for pick on mobile", type: "Integration", priority: "High" },
  { area: "API", item: "manufacturing", tc: "MO cancel rollback", steps: "POST /production-orders/:id/cancel after partial output", expected: "Ledger reversals written; bin qty restored; status cancelled", type: "Edge", priority: "High" },

  // Production facility
  { area: "API", item: "production-facilities", tc: "List / update", steps: "GET / PATCH /production-facilities/:id", expected: "Returns code, productionLineWarehouseId, productionZone, replenishWarehouseCodes", type: "Functional", priority: "High" },

  // Workforce / sales / fulfilment / billing / payments
  { area: "API", item: "workforce", tc: "Workers & attendance", steps: "CRUD workers, attendance", expected: "Persisted correctly", type: "Functional", priority: "Medium" },
  { area: "API", item: "sales", tc: "Quotes & sales orders", steps: "Create/convert", expected: "Lifecycle correct", type: "Integration", priority: "High" },
  { area: "API", item: "fulfilment", tc: "Pick & pack", steps: "Generate pick, pack", expected: "Reservations & statuses correct", type: "Integration", priority: "High" },
  { area: "API", item: "billing", tc: "Invoices", steps: "Create invoice, list", expected: "Totals & AR correct", type: "Integration", priority: "High" },
  { area: "API", item: "customer-payments", tc: "Payments & allocations", steps: "Record & allocate", expected: "Balances correct", type: "Integration", priority: "High" },
  { area: "API", item: "returns", tc: "Returns & credit notes", steps: "Create return/credit", expected: "Stock/credit correct", type: "Functional", priority: "Medium" },
  { area: "API", item: "trips", tc: "Dispatch & trips", steps: "CRUD trips", expected: "Grouping correct", type: "Functional", priority: "Medium" },
  { area: "API", item: "reports", tc: "Report endpoints", steps: "GET transfer-throughput, skus-missing-putaway-rules, mo-efficiency, vendor-performance", expected: "Aggregations correct", type: "Functional", priority: "Medium" },
  { area: "API", item: "approvals", tc: "Approval workflow", steps: "Create/decide approvals", expected: "Gating works", type: "Functional", priority: "Medium" },
  { area: "API", item: "share", tc: "Public document tokens", steps: "GET share endpoints", expected: "Read-only; invalid token 404", type: "Permission", priority: "Medium" },
  { area: "API", item: "sync", tc: "Delta sync", steps: "Pull/push changes", expected: "ChangeLog/Tombstone/cursor correct; conflicts recorded", type: "Integration", priority: "High" },

  // Stock rules
  { area: "API", item: "stock-rules", tc: "CRUD + barcode include", steps: "GET /stock-rules", expected: "Product + variant include barcodes; UI columns populated", type: "Functional", priority: "Medium" },
  { area: "API", item: "stock-rules", tc: "Trigger pipeline", steps: "POST /stock-rules/run-pipeline", expected: "Pipeline emits MOs/TOs/PO drafts as configured", type: "Integration", priority: "High" },
];

// 6. END-TO-END FLOWS — see test-plan-e2e-flows.ts (expanded step-by-step scripts)

// =============================================================================
// 7. UPGRADE / MIGRATION CHECKS
// =============================================================================
const upgrade: Row[] = [
  { area: "Migration", item: "20260615180000 add_stock_lots", steps: "Run prisma migrate", tc: "StockLot table exists", expected: "Table + indexes present; existing GRNs survive (legacy stock unattributed lots)", type: "Functional", priority: "High" },
  { area: "Migration", item: "20260615190000 facility_production_zone", steps: "Run prisma migrate", tc: "ProductionFacility.productionZone column", expected: "Column added; existing rows default to null; UI editable", type: "Functional", priority: "High" },
  { area: "Migration", item: "20260623100000 facility_replenish_sources", steps: "Run prisma migrate", tc: "replenishWarehouseCodes column", expected: "Column added; legacy facilities can be edited to set list", type: "Functional", priority: "High" },
  { area: "Migration", item: "20260624100000 bom_operations", steps: "Run prisma migrate", tc: "BomOperation table + WO fields", expected: "New table created; WorkOrder gains bomOperationId, splitSeq, plannedSplitQty, blockedByWorkOrderId, qaStatus, qaNotes; existing WOs unaffected", type: "Functional", priority: "High" },
  { area: "Migration", item: "20260624120000 vendor_catalog", steps: "Run prisma migrate", tc: "VendorCatalog + Items", expected: "Tables present; vendor detail panel reads them", type: "Functional", priority: "High" },
  { area: "Migration", item: "20260624140000 stock_rule_po_trigger", steps: "Run prisma migrate", tc: "StockRule PO trigger fields", expected: "vendorId/maxQty/orderMultiple operational; pipeline emits POs", type: "Integration", priority: "High" },
  { area: "Migration", item: "20260624160000 grn_multi_bin_lots", steps: "Run prisma migrate", tc: "GRN multi-bin allocation supported", expected: "GrnItem can split across bins with batches; one StockLot per allocation", type: "Integration", priority: "High" },
  { area: "Migration", item: "20260625000000 putaway_rule_zone", steps: "Run prisma migrate / db execute", tc: "PutawayRule.toZone column", expected: "Column added; UI exposes 'Destination zone'; resolver routes zone-only rules into per-product slot in the zone", type: "Integration", priority: "High" },
  { area: "Ops Script", item: "seed-stock-room-zone-pr", steps: "npx tsx src/scripts/seed-stock-room-zone-pr.ts --apply", tc: "Seeds rules for all FG; migrates `_` placeholders", expected: "440-ish finished rules; legacy _ bins moved to STR.PR.<SKU>.00 with paired Transfer ledger; counts reported in summary", type: "Integration", priority: "High" },
  { area: "Ops Script", item: "purge-semi-putaway-rules", steps: "npx tsx src/scripts/purge-semi-putaway-rules.ts --apply", tc: "Removes rules for type=semi", expected: "All semi/Sambhava/SOAP-PROC rules deleted; audit script shows only finished", type: "Functional", priority: "High" },
  { area: "Ops Script", item: "clear-warehouse-placeholders", steps: "npx tsx src/scripts/clear-warehouse-placeholders.ts --warehouse=STR --apply", tc: "Cleans empty placeholders, force-deletes named slots", expected: "Only empty + unreferenced placeholders deleted by default; --force-codes=A,B writes Adjust ledger + deletes; refs detached safely", type: "Edge", priority: "High" },
];

// =============================================================================
// Role/permission matrix (separate sheet)
// =============================================================================
const ROLES = ["admin", "supervisor", "procurement", "billing", "warehouse", "worker"] as const;
const navMatrix: { page: string; roles: Record<(typeof ROLES)[number], boolean> }[] = [
  { page: "Dashboard", roles: { admin: true, supervisor: true, procurement: true, billing: true, warehouse: true, worker: true } },
  { page: "Products", roles: { admin: true, supervisor: true, procurement: true, billing: false, warehouse: false, worker: false } },
  { page: "Procurement", roles: { admin: true, supervisor: false, procurement: true, billing: false, warehouse: false, worker: false } },
  { page: "Price Lists", roles: { admin: true, supervisor: false, procurement: true, billing: false, warehouse: false, worker: false } },
  { page: "Customers", roles: { admin: true, supervisor: true, procurement: false, billing: true, warehouse: false, worker: false } },
  { page: "Quotes", roles: { admin: true, supervisor: true, procurement: false, billing: true, warehouse: false, worker: false } },
  { page: "Sales Orders", roles: { admin: true, supervisor: true, procurement: false, billing: true, warehouse: false, worker: false } },
  { page: "Picking", roles: { admin: true, supervisor: true, procurement: false, billing: true, warehouse: true, worker: false } },
  { page: "Packing", roles: { admin: true, supervisor: true, procurement: false, billing: true, warehouse: true, worker: false } },
  { page: "Returns", roles: { admin: true, supervisor: true, procurement: false, billing: true, warehouse: true, worker: false } },
  { page: "Inventory", roles: { admin: true, supervisor: true, procurement: true, billing: false, warehouse: true, worker: false } },
  { page: "Warehouse", roles: { admin: true, supervisor: true, procurement: false, billing: false, warehouse: true, worker: false } },
  { page: "Transfers", roles: { admin: true, supervisor: true, procurement: false, billing: false, warehouse: true, worker: true } },
  { page: "WH Audit", roles: { admin: true, supervisor: false, procurement: false, billing: false, warehouse: true, worker: false } },
  { page: "BOMs", roles: { admin: true, supervisor: true, procurement: false, billing: false, warehouse: false, worker: false } },
  { page: "Manufacturing (desktop)", roles: { admin: true, supervisor: true, procurement: false, billing: false, warehouse: false, worker: false } },
  { page: "Manufacturing PWA (/mfg/*)", roles: { admin: true, supervisor: true, procurement: false, billing: false, warehouse: true, worker: true } },
  { page: "Warehouse PWA (/m/*)", roles: { admin: true, supervisor: true, procurement: false, billing: false, warehouse: true, worker: true } },
  { page: "Productivity", roles: { admin: true, supervisor: true, procurement: false, billing: false, warehouse: false, worker: false } },
  { page: "Transport", roles: { admin: true, supervisor: true, procurement: false, billing: false, warehouse: true, worker: false } },
  { page: "Billing", roles: { admin: true, supervisor: false, procurement: false, billing: true, warehouse: false, worker: false } },
  { page: "Reports", roles: { admin: true, supervisor: true, procurement: true, billing: true, warehouse: false, worker: false } },
  { page: "Approvals", roles: { admin: true, supervisor: true, procurement: false, billing: true, warehouse: false, worker: false } },
  { page: "Settings", roles: { admin: true, supervisor: false, procurement: false, billing: false, warehouse: false, worker: false } },
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

  const styleSheet = (
    ws: ExcelJS.Worksheet,
    rows: Row[],
    fill: (p: string) => string
  ) => {
    const header = ws.getRow(1);
    header.height = 22;
    header.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
      c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      c.border = { bottom: { style: "thin", color: { argb: NAVY } } };
    });
    ws.eachRow((row, idx) => {
      if (idx === 1) return;
      const r = rows[idx - 2];
      row.alignment = { vertical: "top", wrapText: true };
      if (idx % 2 === 0) {
        row.eachCell((c) => {
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
        });
      }
      const priCell = row.getCell(8);
      if (r) {
        priCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill(r.priority) } };
        priCell.alignment = { vertical: "top", horizontal: "center" };
        priCell.font = { bold: true };
      }
      const stCell = row.getCell(9);
      stCell.alignment = { vertical: "top", horizontal: "center" };
    });
    ws.autoFilter = { from: "A1", to: `J1` };
    for (let i = 2; i <= rows.length + 1; i++) {
      ws.getCell(`I${i}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"Not Run,Pass,Fail,Blocked,N/A"'],
      };
    }
  };

  const buildTestSheet = (name: string, prefix: string, rows: Row[]) => {
    reseq();
    const ws = wb.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    ws.columns = [
      { header: "ID", key: "id", width: 10 },
      { header: "Area", key: "area", width: 22 },
      { header: "Module / Item", key: "item", width: 32 },
      { header: "Test Case", key: "tc", width: 52 },
      { header: "Steps", key: "steps", width: 72 },
      { header: "Expected Result", key: "expected", width: 62 },
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

  // Overview sheet
  const ov = wb.addWorksheet("Overview");
  ov.columns = [{ width: 28 }, { width: 90 }];
  const title = ov.addRow(["PVS ERP — Master Test Plan", ""]);
  title.getCell(1).font = { bold: true, size: 16, color: { argb: NAVY } };
  ov.addRow([]);
  ov.addRow(["Generated", new Date().toISOString().slice(0, 10)]);
  ov.addRow([
    "Scope",
    "All Prisma models, ERP portal pages, the warehouse PWA, the manufacturing PWA, API route groups, recent feature work (BOM operations + split, zone-PR putaway, WO material gate, TO refresh + release, multi-bin GRN with lots, stock-rule PO trigger), end-to-end flows, and migration / ops-script verification.",
  ]);
  ov.addRow([]);
  const lh = ov.addRow(["Worksheet", "Purpose"]);
  lh.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
  });
  [
    ["1. Models", "Backend / database model behaviour & integrity"],
    ["2. ERP Pages", "Desktop portal page-level functional & UI tests"],
    ["3. Warehouse PWA", "Warehouse mobile app (/m/*) screen tests"],
    ["4. Manufacturing PWA", "Manufacturing mobile app (/mfg/*) screen tests"],
    ["5. API Routes", "Backend route-group contract & permission tests"],
    ["6. E2E Flows", "100+ detailed step-by-step scripts incl. low-stock TO/PO/MO auto-generation"],
    ["7. Migrations & Ops", "Prisma migrations + ops scripts to verify before sign-off"],
    ["8. Role Matrix", "Which role can access which page (RBAC reference)"],
  ].forEach((r) => ov.addRow(r));
  ov.addRow([]);
  const legend = ov.addRow(["Legend", ""]);
  legend.getCell(1).font = { bold: true, size: 12, color: { argb: NAVY } };
  [
    ["Status values", "Not Run / Pass / Fail / Blocked / N/A (dropdown in Status column)"],
    ["Priority", "High (red), Medium (amber), Low (blue)"],
    ["Type", "Functional / Validation / Permission / Edge / UI / Integration"],
    ["Roles", "admin, supervisor, procurement, billing, warehouse, worker"],
  ].forEach((r) => {
    const row = ov.addRow(r);
    row.getCell(1).font = { bold: true };
  });

  // Test sheets
  buildTestSheet("1. Models", "MDL", models);
  buildTestSheet("2. ERP Pages", "PG", pages);
  buildTestSheet("3. Warehouse PWA", "MOB", mobile);
  buildTestSheet("4. Manufacturing PWA", "MFG", mfg);
  buildTestSheet("5. API Routes", "API", routes);
  buildTestSheet("6. E2E Flows", "E2E", flows);
  buildTestSheet("7. Migrations & Ops", "OPS", upgrade);

  // Role matrix sheet
  const rm = wb.addWorksheet("8. Role Matrix", { views: [{ state: "frozen", ySplit: 1, xSplit: 1 }] });
  rm.columns = [
    { header: "Page", key: "page", width: 28 },
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
  const total =
    models.length + pages.length + mobile.length + mfg.length + routes.length + flows.length + upgrade.length;
  console.log(`Wrote ${OUT}`);
  console.log(`Total test cases: ${total}`);
  console.log(
    `  Models: ${models.length} | Pages: ${pages.length} | Warehouse PWA: ${mobile.length} | Mfg PWA: ${mfg.length} | API: ${routes.length} | E2E: ${flows.length} | Ops: ${upgrade.length}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
