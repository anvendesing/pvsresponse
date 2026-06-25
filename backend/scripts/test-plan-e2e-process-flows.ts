/**
 * E2E cases: detailed process flows per portal module (sales, WH, mfg, etc.).
 */
import { e2e } from "./test-plan-e2e-helpers.js";

export const processFlows = [
  // ── Procurement detail ──────────────────────────────────────────────────────
  e2e("Procurement — PO lifecycle", "Draft → Approve → Partial GRN → Full receive → Close", "1) Create PO 3 lines.\n2) Save draft.\n3) Approve PO.\n4) GRN partial line 1.\n5) GRN remaining.\n6) Close PO modal.\n7) Verify no further receive allowed.", "Status transitions draft→approved→partial→received→closed; ledger matches.", { priority: "High" }),
  e2e("Procurement — PO lifecycle", "PO line promised date editable and persisted", "1) Edit line promised date.\n2) Save.\n3) Reopen PO — date unchanged.", "Promised dates persist.", { priority: "Medium" }),
  e2e("Procurement — GRN", "GRN over-receipt blocked or flagged", "1) PO line 100 kg.\n2) Attempt GRN 110 kg.\n3) Expect validation error or warning.", "Over-receipt policy enforced.", { priority: "Medium" }),
  e2e("Procurement — GRN", "GRN batch + expiry creates StockLot per allocation", "1) Split GRN 2 bins, 2 batches, 2 expiries.\n2) Query lots — 2 rows.", "StockLot fidelity.", { priority: "High" }),
  e2e("Procurement — GRN", "GRN QC mobile flow (if enabled)", "1) /m/grn-qc → list pending.\n2) Open detail → pass/fail.\n3) Desktop GRN reflects QC status.", "QC gate before stock live.", { priority: "Medium" }),
  e2e("Procurement — Vendor", "Vendor performance updates after late GRN", "1) Note vendor on-time %.\n2) Receive GRN with backdated late delivery.\n3) Performance card updates.", "Vendor score reflects delay.", { priority: "Low" }),

  // ── Sales & fulfilment detail ───────────────────────────────────────────────
  e2e("Quotes", "Quote revision diff — Rev 2 changes qty only", "1) Rev 1 three lines.\n2) Rev 2 change line 1 qty.\n3) History shows both revisions.", "Revision audit trail.", { priority: "Medium" }),
  e2e("Quotes", "Quote discount triggers approval if above threshold", "1) Apply discount > threshold.\n2) /approvals pending.\n3) Approve → quote saves.", "Discount gating.", { priority: "Medium" }),
  e2e("Sales Orders", "SO edit lines before pick — totals recalc", "1) Create SO.\n2) Edit qty on line 2.\n3) Header total updates.", "SO math live.", { priority: "High" }),
  e2e("Sales Orders", "SO status progresses open → picking → packed", "1) Generate pick.\n2) Complete pick.\n3) Pack.\n4) SO status reflects each step.", "Status machine correct.", { priority: "High" }),
  e2e("Picking", "Pick list bin allocation FEFO", "1) Same product 2 lots different expiry in 2 bins.\n2) Generate pick.\n3) Allocation picks earliest expiry bin first.", "FEFO in pick allocation.", { priority: "High" }),
  e2e("Picking", "Pick reservation blocks bin qty for other picks", "1) Pick list A reserves bin X.\n2) Pick list B same bin — partial or alternate bin.", "reservedQty prevents double-book.", { priority: "High" }),
  e2e("Picking", "Print pick list /print/pick-list/:id", "1) Complete pick list setup.\n2) Open print URL.\n3) Layout shows bins, products, qtys.", "Print view complete.", { priority: "Medium" }),
  e2e("Picking", "Cancel pick list releases reservations", "1) Generate pick.\n2) Cancel.\n3) reservedQty back to 0.", "Cleanup on cancel.", { priority: "High" }),
  e2e("Packing", "Multi-container pack with weights", "1) Pack into 2 containers.\n2) Enter weights.\n3) Packing slip shows per-container breakdown.", "Container tracking.", { priority: "Medium" }),
  e2e("Packing", "Pack cannot exceed picked qty", "1) Try pack qty > picked.\n2) Validation error.", "Qty guard.", { priority: "High" }),
  e2e("Billing", "Invoice tax lines per product category", "1) Invoice mixed tax rates.\n2) Verify tax subtotals.\n3) Grand total.", "Tax engine.", { priority: "High" }),
  e2e("Billing", "Partial payment then second payment clears invoice", "1) Invoice ₹10000.\n2) Pay ₹4000 allocate.\n3) Pay ₹6000.\n4) Status paid.", "Partial payment flow.", { priority: "High" }),
  e2e("Customers", "Credit limit blocks new SO when exceeded", "1) Customer limit ₹50000, open AR ₹48000.\n2) New SO ₹5000 — block/warn.", "Credit enforcement.", { priority: "High" }),

  // ── Inventory & transfers detail ──────────────────────────────────────────
  e2e("Inventory", "Ledger filter by ref type GRN / Transfer / Production", "1) Perform one of each movement.\n2) Ledger filter each ref type.\n3) Rows match.", "Ledger categorization.", { priority: "Medium" }),
  e2e("Inventory", "Negative adjust blocked or requires reason", "1) Adjust below zero.\n2) Expect error.", "Non-negative qty guard.", { priority: "High" }),
  e2e("Transfers", "Manual TO partial pick then complete drop", "1) TO 100 kg.\n2) Pick 60.\n3) Drop 60.\n4) Variance visible.", "Partial TO handling.", { priority: "Medium" }),
  e2e("Transfers", "Admin reassign TO from slide-over", "1) Assign worker A.\n2) Reassign worker B.\n3) B sees in Claimed; A does not.", "Reassignment.", { priority: "Medium" }),
  e2e("Transfers", "Cancel in_transit TO — stock rollback policy", "1) Pick started.\n2) Cancel.\n3) Source bin restored.", "Cancel mid-flight.", { priority: "High" }),
  e2e("Transfers", "Putaway tab filters only putaway kind", "1) Mix manual, replenishment, putaway TOs.\n2) Putaway tab shows only putaway.", "Tab filter accuracy.", { priority: "Medium" }),
  e2e("Warehouse tree", "Bin with zero qty hidden or greyed in tree", "1) Empty bin.\n2) Tree display policy.", "UI empty bin policy.", { priority: "Low" }),
  e2e("WH Audit", "Cycle count variance posts adjustment ledger", "1) Count −5 variance.\n2) Ledger row type adjust.", "Audit trail.", { priority: "Medium" }),

  // ── Manufacturing detail ────────────────────────────────────────────────────
  e2e("BOM", "Deactivate BOM — New MO blocked or warns", "1) Set BOM inactive.\n2) New MO for product — error or no BOM in list.", "Inactive BOM guard.", { priority: "Medium" }),
  e2e("BOM", "Scrap % increases component qty on MO release", "1) BOM WHET 10.5 kg with 5% scrap for 10 kg output.\n2) Release MO 100 kg output.\n3) Shortage WHET ≈ 1050×1.05 logic.", "Scrap in explosion.", { priority: "High" }),
  e2e("BOM", "Multi-level semi explosion on MO release", "1) FG BOM uses semi with own BOM.\n2) Release MO.\n3) Shortages list leaf raw materials.", "Multi-level explodeBom.", { priority: "High" }),
  e2e("Manufacturing", "Assign line/machine on NewMoModal persisted", "1) New MO pick line + machine.\n2) MO detail shows assignments.\n3) WOs inherit machine.", "Line/machine on MO.", { priority: "Medium" }),
  e2e("Manufacturing", "WO sequential block — WO2 after WO1", "1) BOM sequential ops.\n2) Try Start WO2 before WO1 done — blocked.\n3) Complete WO1 → WO2 starts.", "blockedByWorkOrderId.", { priority: "High" }),
  e2e("Manufacturing", "WO QA fail notes visible on MO detail", "1) Complete WO qaStatus=fail, notes='Out of spec'.\n2) MO detail shows QA badge.", "QA capture.", { priority: "Medium" }),
  e2e("Manufacturing", "Log output incrementally before complete", "1) Log 20 kg good.\n2) Log 10 kg good.\n3) actualQty=30 before Complete.", "Incremental output.", { priority: "High" }),
  e2e("Manufacturing", "Split WO parallel machines run concurrently", "1) Split pulverize op 60/40.\n2) Start both WOs.\n3) Both in progress.", "allowParallel split.", { priority: "High" }),
  e2e("Mfg PWA", "Release → Issue → WO gate visible on each WO row", "1) Before issue: Locked on all WOs.\n2) After issue: Start enabled.", "UI gate mirrors API.", { priority: "High" }),
  e2e("Mfg PWA", "Transfers tab count matches open TOs for facility", "1) Release MO creates 2 TOs.\n2) /mfg/transfers badge=2.", "Tab counts.", { priority: "Medium" }),
  e2e("Mfg PWA", "Switch room clears MO list context", "1) Milling Room MOs visible.\n2) Profile → Vacuum Pack.\n3) Different MO set.", "Facility scoping.", { priority: "Medium" }),

  // ── Mobile warehouse detail ─────────────────────────────────────────────────
  e2e("Warehouse PWA", "MobilePick scan wrong bin rejected", "1) Pick line expects bin A.\n2) Scan bin B.\n3) Error.", "Scan validation.", { priority: "High" }),
  e2e("Warehouse PWA", "MobileTransfer pick qty cannot exceed line qty", "1) Line 50 kg.\n2) Enter 60 — blocked.", "Pick qty cap.", { priority: "High" }),
  e2e("Warehouse PWA", "MobileGrn split validation totals must match received", "1) Received 100.\n2) Allocations 60+30 — error until 100.", "Allocation sum guard.", { priority: "High" }),
  e2e("Warehouse PWA", "MobileScan product routes to product detail", "1) Scan product barcode.\n2) Correct product screen.", "Scan routing.", { priority: "Medium" }),
  e2e("Warehouse PWA", "MobileVerify bin contents vs system", "1) /m/verify scan bin.\n2) Compare listed qty to desktop.", "Verify tool.", { priority: "Low" }),

  // ── Settings & reports detail ─────────────────────────────────────────────
  e2e("Settings", "Putaway rule priority — higher priority wins", "1) Two rules same product different dest.\n2) Complete MO — higher priority dest used.", "Priority waterfall.", { priority: "Medium" }),
  e2e("Settings", "Stock rule edit min qty affects next pipeline run", "1) min=100, stock=80 → TO.\n2) Change min=70.\n3) Pipeline skip.", "Live rule edit.", { priority: "Medium" }),
  e2e("Settings", "requireMoReleaseBeforeIssue enforced on API", "1) Toggle ON.\n2) POST issue before release — 409.\n3) Release then issue — 200.", "API gate.", { priority: "High" }),
  e2e("Reports", "Transfer throughput report matches executed TOs", "1) Execute 3 TOs today.\n2) Report count/qty matches.", "Report accuracy.", { priority: "Medium" }),
  e2e("Reports", "MO efficiency report for completed MO", "1) Complete known MO.\n2) Report row shows planned vs actual duration/qty.", "MO metrics.", { priority: "Medium" }),
  e2e("RBAC", "Warehouse role cannot access /settings", "1) Login warehouse.\n2) Navigate /settings — blocked.", "Settings admin-only.", { priority: "High" }),
  e2e("RBAC", "Billing role cannot access /procurement", "1) Login billing.\n2) /procurement blocked.", "Procurement isolation.", { priority: "High" }),
];
