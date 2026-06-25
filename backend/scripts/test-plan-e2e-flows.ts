/**
 * Detailed end-to-end test scripts for sheet "6. E2E Flows".
 * Imported by generate-test-plan-xlsx.ts — edit here to expand E2E coverage only.
 */
import type { E2eRow } from "./test-plan-e2e-helpers.js";
import { stockAutomationFlows } from "./test-plan-e2e-stock-automation.js";
import { processFlows } from "./test-plan-e2e-process-flows.js";

export type { E2eRow };

const coreFlows: E2eRow[] = [
  // ── Environment & access ──────────────────────────────────────────────────
  {
    area: "E2E",
    item: "Go-live setup",
    tc: "Verify test environment, users, and seed data before functional runs",
    steps:
      "1) Confirm backend health at /health and portal loads at /dashboard.\n" +
      "2) Login once as each role: admin, supervisor, procurement, billing, warehouse, worker (PIN set for mobile).\n" +
      "3) Settings → Users: confirm each tester account is active with correct role badge.\n" +
      "4) Settings → Warehouses: confirm STR (Stock Room) has zones A, B, C, PR visible in tree.\n" +
      "5) Settings → Production facilities: confirm Milling Room (WH-PROD-MILL) and Vacuum Pack (WC-VACUUM) exist with production WH + zone set.\n" +
      "6) Products: search WHET, WHFL, RAGI — confirm SKUs, barcodes, and at least one variant where needed.\n" +
      "7) Open Inventory → confirm on-hand totals are non-negative; note starting qty for WHET in STR for later FEFO test.\n" +
      "8) Warehouse PWA: /m/login as warehouse worker, pick STR.\n" +
      "9) Manufacturing PWA: /mfg/login as worker, pick Milling Room.",
    expected:
      "All logins succeed; nav items match Role Matrix sheet per role; master data present; both PWAs reach their home screens without console errors.",
    type: "Integration",
    priority: "High",
  },
  {
    area: "E2E",
    item: "RBAC",
    tc: "Role-based route access across portal and both PWAs",
    steps:
      "1) As procurement: open Products, Procurement, Price Lists, Inventory — all load.\n" +
      "2) As procurement: attempt /customers, /billing, /manufacturing — expect block or redirect.\n" +
      "3) As billing: open Customers, Quotes, Sales Orders, Picking, Packing, Billing, Reports — all load.\n" +
      "4) As billing: attempt /procurement, /settings — blocked.\n" +
      "5) As warehouse: open Inventory, Warehouse, Transfers, WH Audit; /m/tasks loads on mobile.\n" +
      "6) As warehouse: attempt /products, /manufacturing/boms — blocked on desktop.\n" +
      "7) As supervisor: open Manufacturing, BOMs, Productivity, Transport, Approvals.\n" +
      "8) As worker: /m/login and /mfg/login succeed; desktop /dashboard loads but manufacturing nav hidden.\n" +
      "9) As admin: every nav item + Settings + Putaway rules route loads.",
    expected:
      "Allowed pages render data; disallowed routes redirect or show access denied; mobile PWAs respect same auth token; behaviour matches sheet 8. Role Matrix.",
    type: "Permission",
    priority: "High",
  },

  // ── Master data & products ────────────────────────────────────────────────
  {
    area: "E2E",
    item: "Products lifecycle",
    tc: "Create product, variants, barcode, and supply outlook",
    steps:
      "1) Login as supervisor → /products.\n" +
      "2) Click Add product: SKU=TEST-FG-01, name='Test Flour 1kg', type=finished, base UOM=kg, category as appropriate.\n" +
      "3) Save; confirm row appears in list.\n" +
      "4) Open product detail → Variants tab → add variant: size='1 kg pack', SKU=TEST-FG-01-1KG, barcode=8900000000001.\n" +
      "5) Open Supply outlook tab — note on-hand=0, effective=0.\n" +
      "6) Settings → Putaway rules → add rule: product TEST-FG-01 → STR, toZone=PR (no bin).\n" +
      "7) Inventory → Adjust stock: +10 kg into STR zone A bin (pick a real bin, not warehouse level).\n" +
      "8) Return to product Supply outlook — on-hand should show +10; effective updates.\n" +
      "9) /m/scan → scan barcode 8900000000001 — resolves to correct variant screen.",
    expected:
      "Product + variant CRUD persists; barcode scan resolves; supply outlook reflects adjustment; putaway rule saved with 'Zone PR · auto-slot'.",
    type: "Integration",
    priority: "High",
  },
  {
    area: "E2E",
    item: "Price lists",
    tc: "Create price list and verify on quote line",
    steps:
      "1) Login as procurement → /price-lists.\n" +
      "2) Create list 'Retail 2026', basis=selling, currency=INR, active=true.\n" +
      "3) Add item: product WHFL (or TEST-FG-01), price=55 per kg.\n" +
      "4) Add second item with a variant line if WHFL has variants.\n" +
      "5) Save list.\n" +
      "6) Login as billing → /quotes → New quote.\n" +
      "7) Add customer, add line for WHFL — confirm unit price autofills from list (55 or configured price).\n" +
      "8) Change qty to 20; confirm line total = qty × price.",
    expected:
      "Price list saved; quote line pulls correct unit price; totals compute; no manual price entry needed when list applies.",
    type: "Integration",
    priority: "High",
  },

  // ── Procurement ───────────────────────────────────────────────────────────
  {
    area: "E2E",
    item: "Vendor & catalog",
    tc: "Vendor catalog drives PO pricing and lead time",
    steps:
      "1) Login as procurement → /procurement → Vendors tab.\n" +
      "2) Open an existing vendor (or create 'Test Vendor Pvt Ltd').\n" +
      "3) VendorDetailModal → Catalog section → Add item: WHET, vendor SKU=V-WHET, price=35/kg, lead time=7 days.\n" +
      "4) Save catalog entry.\n" +
      "5) Performance section: note current on-time % (baseline).\n" +
      "6) Create new PO for this vendor → Add line WHET 500 kg.\n" +
      "7) Confirm unit price autofills 35 from catalog; promised date ≈ today + 7 days.\n" +
      "8) Save PO as draft; note PO number.",
    expected:
      "Catalog item persisted; PO line price and promised date autofilled; vendor detail shows catalog row and performance metrics.",
    type: "Integration",
    priority: "High",
  },
  {
    area: "E2E",
    item: "Procure-to-Stock (multi-bin GRN)",
    tc: "PO → split GRN across bins with lots → FEFO consumption",
    steps:
      "1) Continue from vendor PO (WHET 500 kg @ 35) or create fresh PO.\n" +
      "2) Procurement → Receive GRN against PO.\n" +
      "3) GrnReceiveModal / GrnLineAllocation: split line into:\n" +
      "   • 300 kg → bin STR.A.S01.01 (or equivalent), batch B-A, expiry = today + 30 days\n" +
      "   • 200 kg → bin STR.A.S01.02, batch B-B, expiry = today + 90 days\n" +
      "4) Post GRN; open GRN detail — both allocations visible.\n" +
      "5) Inventory → filter WHET → confirm total on-hand +500 across two bins.\n" +
      "6) Inspect StockLot rows (via bin detail or inventory drill-down): two lots with distinct batch + expiry.\n" +
      "7) Create manual transfer or pick 150 kg WHET out of STR (any outbound).\n" +
      "8) Verify consumption: batch B-A (earlier expiry) qty drops first; B-B untouched until A exhausted.\n" +
      "9) Receive remaining PO qty if partial; Close PO via ClosePoConfirmModal when fully received.",
    expected:
      "Two StockLot rows; ledger 'in' references batches; FEFO drains earliest expiry first; PO status moves partial → received → closed; vendor performance updates on receive.",
    type: "Integration",
    priority: "High",
  },
  {
    area: "E2E",
    item: "GRN on warehouse mobile",
    tc: "Receive PO on /m/grn with multi-bin allocation",
    steps:
      "1) Create draft PO (WHET 100 kg) on desktop; leave unreceived.\n" +
      "2) Warehouse worker → /m/grn → find the PO.\n" +
      "3) Tap PO → MobileGrnReceive: enter received qty 100.\n" +
      "4) Split allocation: 60 kg bin A/S01/01 batch M-GRN-1; 40 kg A/S01/02 batch M-GRN-2; set expiries.\n" +
      "5) Submit receive.\n" +
      "6) Desktop Procurement → confirm GRN posted; Inventory shows +100.\n" +
      "7) /m/loc/STR.A (or scan zone barcode) → CollapsibleLocationList shows updated bin qtys.",
    expected:
      "Mobile GRN mirrors desktop capability; stock increments in both bins; lots created; desktop GRN detail matches mobile allocations.",
    type: "Integration",
    priority: "High",
  },
  {
    area: "E2E",
    item: "Stock-rule PO trigger",
    tc: "Bin below min → grouped vendor PO drafted",
    steps:
      "1) Admin → Settings → Stock rules → create rule: product=raw item from vendor X, monitor bin=STR.A.S01.03, min=50, trigger=PO, vendor=X, maxQty=500, orderMultiple=25.\n" +
      "2) Create second rule for another item from same vendor X with same trigger settings.\n" +
      "3) Inventory → adjust monitored bin qty to 10 (below min).\n" +
      "4) Settings → Stock rules → Run pipeline (or POST /stock-rules/run-pipeline).\n" +
      "5) Procurement → PO list → find new draft PO for vendor X.\n" +
      "6) Open PO: both lines present; qtys rounded to orderMultiple; prices from vendor catalog.\n" +
      "7) Product Supply outlook for each item shows open PO in pipeline.",
    expected:
      "Single draft PO per vendor with all triggered lines; qty respects orderMultiple and maxQty; no duplicate PO on second pipeline run without qty change.",
    type: "Integration",
    priority: "High",
  },

  // ── Sales & fulfilment ────────────────────────────────────────────────────
  {
    area: "E2E",
    item: "Customers & AR",
    tc: "Customer credit limit, invoice, payment, statement",
    steps:
      "1) Login as billing → /customers → Add customer 'Test Retailer', credit limit=50000, payment terms=30 days.\n" +
      "2) Save; open customer detail → AR statement shows zero balance.\n" +
      "3) Create a small invoice manually (Billing) or via SO flow for ₹10,000.\n" +
      "4) Customer detail → Record Payment ₹5,000.\n" +
      "5) Allocate ₹5,000 to the open invoice.\n" +
      "6) Re-open AR statement: open balance ₹5,000; available credit updated.\n" +
      "7) Attempt SO/quote exceeding credit limit (optional edge) — expect warning or block per policy.",
    expected:
      "Customer saved; invoice increases AR; partial payment + allocation reduces open balance correctly; statement math consistent.",
    type: "Integration",
    priority: "High",
  },
  {
    area: "E2E",
    item: "Enquiry → Quote",
    tc: "Enquiry kanban through to formal quote",
    steps:
      "1) /enquiries → create enquiry for Test Retailer: subject='Bulk flour order', estimated value, assign owner.\n" +
      "2) Move card across kanban stages (New → Qualified → Proposal).\n" +
      "3) From enquiry actions, Convert to Quote (or create linked quote).\n" +
      "4) /quotes → open the new quote; add 3 lines: WHFL product-level, WHFL variant (if any), packaging item.\n" +
      "5) Set validity date; save draft.\n" +
      "6) Revise quote (Rev 2): change qty on line 1; confirm revision history shows Rev 1 and Rev 2.\n" +
      "7) Share → copy public link; open in incognito /share/quote/:token.\n" +
      "8) Accept quote → Sales Order generated.",
    expected:
      "Enquiry stages persist; quote linked; revisions versioned; public share renders read-only; accept creates SO with matching lines and prices.",
    type: "Integration",
    priority: "High",
  },
  {
    area: "E2E",
    item: "Order-to-Cash",
    tc: "Quote → SO → Pick → Pack → Invoice → Payment (full desktop + mobile)",
    steps:
      "PREP: Ensure WHFL (or TEST-FG-01) has ≥30 kg in STR zone PR or pickable bin.\n" +
      "1) Billing → /quotes → create quote for Test Retailer: 3 lines incl. one variant, total ~₹15,000.\n" +
      "2) Revise once; Share → open /share/quote/:token in private window — verify read-only layout.\n" +
      "3) Accept quote → note SO number on /sales-orders.\n" +
      "4) /picking → Generate pick list from SO → assign warehouse worker.\n" +
      "5) Worker /m/login → /m/tasks → Pick tab → Claim pick list.\n" +
      "6) /m/picks/:id → for each line: scan bin barcode → scan product barcode → enter qty → Confirm.\n" +
      "7) Complete pick; desktop Picking shows status picked; bin reservedQty consumed, qty decremented.\n" +
      "8) /packing → Pack from completed pick → assign pack task if needed.\n" +
      "9) Worker /m/packs/:id → confirm items; optionally split into 2 containers with different container types.\n" +
      "10) Print packing slip /print/packing-slip/:id — layout print-friendly.\n" +
      "11) /billing → Generate invoice from SO/packing → verify tax + totals.\n" +
      "12) Share invoice link /share/invoice/:token.\n" +
      "13) Customers → Record Payment → allocate to invoice → AR balance zero.",
    expected:
      "End-to-end chain intact: reservations released on pick; packing slip qty matches pick; invoice totals match SO; payment clears AR; share links valid; ledger shows out movements for each pick line.",
    type: "Integration",
    priority: "High",
  },
  {
    area: "E2E",
    item: "Returns & credit",
    tc: "Invoice → Return → Credit note → restock + AR",
    steps:
      "1) Use invoiced SO from Order-to-Cash (or create fresh invoice for 10 units WHFL).\n" +
      "2) /returns → New return against invoice/SO → select 3 units WHFL, reason='Damaged packaging'.\n" +
      "3) Choose restock policy (restock to STR zone A bin or scrap per workflow).\n" +
      "4) Submit return; confirm return number.\n" +
      "5) Issue credit note for return amount.\n" +
      "6) Customers → AR statement: credit reduces balance.\n" +
      "7) Inventory: if restocked, +3 kg in destination bin; ledger shows 'in' with return ref.\n" +
      "8) Mobile /m/returns → find return → MobileReturnDetail confirms status.",
    expected:
      "Return recorded; credit note reduces AR; stock restocked when policy says so; desktop and mobile return views consistent.",
    type: "Integration",
    priority: "Medium",
  },

  // ── Inventory & warehouse ─────────────────────────────────────────────────
  {
    area: "E2E",
    item: "Inventory adjust & ledger",
    tc: "Stock adjustment with full ledger audit trail",
    steps:
      "1) /inventory → search WHET → note starting on-hand total.\n" +
      "2) Click Adjust → select bin STR.A.S01.01 → +5 kg, reason='Cycle count correction'.\n" +
      "3) Save; on-hand increases by 5.\n" +
      "4) Open ledger view / drill-down for WHET → latest row type=adjust, qty=+5, ref includes reason.\n" +
      "5) Adjust same bin −2 kg → net +3 from start.\n" +
      "6) Attempt adjust at warehouse level (STR, no zone) → expect error listing zones A/B/C/PR.",
    expected:
      "Adjustments write ledger rows; on-hand math correct; warehouse-level adjust blocked with location_level_blocked message.",
    type: "Integration",
    priority: "High",
  },
  {
    area: "E2E",
    item: "Warehouse tree & Zone PR",
    tc: "Browse STR tree; verify Zone PR SKU leaves and no placeholders",
    steps:
      "1) /warehouse → select Stock Room (STR).\n" +
      "2) Expand tree: confirm zones A, B, C, PR visible — no 'Zone _' or 'Zone WH' placeholder nodes.\n" +
      "3) Expand Zone PR → per-SKU leaves e.g. WHFL (qty kg), WHET (qty kg) — no shelf/bin sub-folders under PR.\n" +
      "4) Expand Zone A → shelves → bins with qty badges.\n" +
      "5) Click a bin leaf → side panel shows contents, last movement.\n" +
      "6) Toolbar → Transfers button routes to /transfers.\n" +
      "7) /m/loc/STR.PR.WHFL (scan or type) → mobile location view shows qty matching desktop.",
    expected:
      "Tree matches physical layout policy; Zone PR is flat per SKU; placeholders collapsed/hidden; desktop and mobile qty agree.",
    type: "UI",
    priority: "High",
  },
  {
    area: "E2E",
    item: "Placeholder bin prevention",
    tc: "Block parent-level storage when child zones exist",
    steps:
      "1) Confirm STR has zones A, B, C, PR.\n" +
      "2) /inventory → Adjust → attempt destination at STR warehouse root (no zone/shelf/bin).\n" +
      "3) UI shows error: pick one of zones A, B, C, PR.\n" +
      "4) Repeat via API: POST /inventory/adjust with locationCode STR only.\n" +
      "5) Inspect warehouse tree — no new STR._/<SKU>/00 bin created.",
    expected:
      "409 location_level_blocked; available zones listed; no phantom placeholder bins; stock only lands at valid leaf locations.",
    type: "Edge",
    priority: "High",
  },
  {
    area: "E2E",
    item: "Transfers — manual TO",
    tc: "Create, assign, execute manual transfer on mobile",
    steps:
      "1) /transfers → KPI row loads (Pending/In-Transit/Done today).\n" +
      "2) Create Transfer → kind implied manual: from STR.A.S01.01 to STR.B.S02.01, line WHET 25 kg.\n" +
      "3) TO appears in list status=ready; open slide-over → assign to warehouse worker.\n" +
      "4) Worker /m/tasks → Move tab → Claim TO.\n" +
      "5) /m/transfers/:id → Pick 25 kg from source (scan bin + product).\n" +
      "6) Drop 25 kg at destination bin.\n" +
      "7) TO status=done; desktop slide-over shows pick/drop timestamps.\n" +
      "8) Inventory: source −25, dest +25; ledger paired out/in rows.",
    expected:
      "Manual TO lifecycle complete; assignment visible on mobile; bin qty moves atomically; KPI counts update.",
    type: "Integration",
    priority: "High",
  },
  {
    area: "E2E",
    item: "Transfers — replenishment TO",
    tc: "Stock rule transfer trigger → readable notes → mobile execution",
    steps:
      "1) Settings → Stock rule: monitor bin STR.A.S01.03, min=100, trigger=Transfer, source=STR cold/storage bin, dest=STR.A.S01.03.\n" +
      "2) Adjust monitored bin to 20 (below min).\n" +
      "3) Run stock-rule pipeline.\n" +
      "4) /transfers → Replenishment tab → new TO; open slide-over.\n" +
      "5) Notes show plain text: product name, qty, source→dest (StockRule:id only at end if present).\n" +
      "6) Mobile: claim → pick → drop; verify dest bin reaches target level.",
    expected:
      "Auto TO created with populated fromBin/toBin; notes human-readable on desktop and mobile; stock replenished to monitored bin.",
    type: "Integration",
    priority: "High",
  },
  {
    area: "E2E",
    item: "Raw replenishment (refresh + release)",
    tc: "MO shortage TO with empty source → refresh → release → second worker completes",
    steps:
      "1) Ensure production line WH for Milling Room is empty for WHET.\n" +
      "2) Desktop or Mfg PWA: create MO for WHFL 50 kg at Milling Room; Release MO.\n" +
      "3) Auto replenishment TO created; lines may have null fromBinId if storage empty.\n" +
      "4) Procurement/adjust: add WHET stock into source storage bin (not line WH).\n" +
      "5) Worker A → /m/transfers/:id → tap 'Refresh source bins' → fromBinId populated.\n" +
      "6) Worker A → 'Release for another worker' → confirm.\n" +
      "7) Worker B → Claim same TO → pick → drop at line WH.\n" +
      "8) Manufacturing → Issue materials to MO → succeeds.",
    expected:
      "Refresh resolves bins after stock arrives; release clears assignee without cancelling TO; Worker B completes; issue consumes from line WH only.",
    type: "Integration",
    priority: "High",
  },
  {
    area: "E2E",
    item: "WH Audit / cycle count",
    tc: "Cycle count variance adjustment",
    steps:
      "1) Login as warehouse → /warehouse-audit.\n" +
      "2) Start count for bin STR.A.S01.01.\n" +
      "3) Enter counted qty different from system qty (e.g. system 100, count 97).\n" +
      "4) Apply variance −3 kg with reason 'Cycle count'.\n" +
      "5) /inventory → confirm bin qty reduced by 3.\n" +
      "6) Ledger shows adjustment row linked to count.\n" +
      "7) Mobile /m/count → repeat count on another bin (optional parallel path).",
    expected:
      "Count recorded; variance posts adjustment; bin qty matches physical count; audit trail in ledger.",
    type: "Functional",
    priority: "Medium",
  },
  {
    area: "E2E",
    item: "Bulk zone reassignment",
    tc: "Mobile bulk zone scan workflow",
    steps:
      "1) /m/bulk-zone → scan zone barcode STR.B (or equivalent).\n" +
      "2) List shows bins in zone with current products/qtys.\n" +
      "3) Select multiple bins → reassign product/qty per workflow (or confirm counts).\n" +
      "4) Submit; each change writes BinCount / adjustment as designed.\n" +
      "5) Desktop /warehouse tree → verify updated bin contents.",
    expected:
      "Bulk operations apply without corrupting reservedQty; tree reflects changes; no parent-level bins created.",
    type: "Functional",
    priority: "Medium",
  },

  // ── Manufacturing & BOM ───────────────────────────────────────────────────
  {
    area: "E2E",
    item: "BOM authoring (simple)",
    tc: "Create a simple BOM via NewBomModal end-to-end",
    steps:
      "1) Login as supervisor → /manufacturing/boms.\n" +
      "2) Click 'New BOM'.\n" +
      "3) Step 1: search WHFL (wheat flour); select product.\n" +
      "4) Step 2: choose 'Product-level default' (all variants).\n" +
      "5) BomEditor opens: set outputQty=10, uom=kg, name='WHFL standard 10kg batch'.\n" +
      "6) Add components: WHET 10.5 kg (scrap 5%), salt 0.1 kg.\n" +
      "7) Set status active; Save.\n" +
      "8) BOM list: filter/search WHFL — row shows Items=2, Output=10 kg, Status=active.\n" +
      "9) New BOM again for WHFL same scope → modal warns 'BOM already exists' with Open button.",
    expected:
      "BOM saved with scrap calc; table sortable; duplicate scope blocked with Open shortcut; explode on MO uses WHET 10.5 kg per 10 kg output.",
    type: "Integration",
    priority: "High",
  },
  {
    area: "E2E",
    item: "BOM authoring (multi-step + split)",
    tc: "Operations, machine mapping, and split across pulverizers",
    steps:
      "1) Open RAGI flour BOM (or create).\n" +
      "2) BomOperationsPanel → Add operations in order:\n" +
      "   • Seq 1 Destone — machine MCH-MILL-DSTONE-01, capacity 200 kg/hr\n" +
      "   • Seq 2 Hulling — MCH-MILL-HULL-01, 150 kg/hr\n" +
      "   • Seq 3 Pulverize — MCH-FLOUR-PULV-S-3-01, allowParallel=true\n" +
      "3) SplitOperationModal on Pulverize → machines -01 and -02, split 60/40 of planned qty.\n" +
      "4) Map each BomItem to its operation (RAGI grain → Destone, etc.).\n" +
      "5) Save BOM.\n" +
      "6) Manufacturing → New MO from this BOM, plan qty 100 kg.\n" +
      "7) MO detail → MoWorkOrdersPanel shows WOs per operation; Pulverize shows 2 split WOs with plannedSplitQty 60/40.\n" +
      "8) Release MO (do not complete) — verify WO scaffold matches operations.",
    expected:
      "Operations persisted in sequence; split creates two WOs with splitSeq 1 & 2; BOM items tied to ops; MO release scaffolds correct WO set.",
    type: "Integration",
    priority: "High",
  },
  {
    area: "E2E",
    item: "Manufacturing desktop — full MO cycle",
    tc: "Planned → Release → Replenish → Issue → WOs → Complete → Putaway TO",
    steps:
      "PREP: Putaway rule WHFL → STR toZone=PR; WHET stock in replenishment source WH.\n" +
      "1) /manufacturing → New MO: BOM=WHFL, qty=50 kg, facility=Milling Room, due date tomorrow.\n" +
      "2) MO status=planned; open detail → MoWorkOrdersPanel lists ops from BOM.\n" +
      "3) Release MO → shortage banner lists WHET; /transfers shows replenishment TO(s) with readable notes.\n" +
      "4) Warehouse mobile: execute replenishment TO to line WH (WH-PROD-MILL).\n" +
      "5) Manufacturing → Issue materials → requirements show materialsIssued=true.\n" +
      "6) Try Start WO before issue (on a fresh MO) → blocked; after issue → Start each WO → Complete with QA pass/fail + notes.\n" +
      "7) Log output: good=49, scrap=1.\n" +
      "8) Complete MO.\n" +
      "9) /transfers Putaway tab: TO to STR zone PR for WHFL.\n" +
      "10) /warehouse STR → Zone PR → WHFL qty increased by 49 (or 50 per scrap policy).",
    expected:
      "Material gate enforced on WOs; consumption from line WH only; FG putaway TO when production WH ≠ STR; ledger production + transfer rows; MO status=completed.",
    type: "Integration",
    priority: "High",
  },
  {
    area: "E2E",
    item: "FG Putaway via Zone PR",
    tc: "Mill MO → putaway TO → mobile pick/drop → FG at STR.PR.WHFL.00",
    steps:
      "1) Confirm putaway rule: WHFL → STR, toZone=PR (no fixed bin).\n" +
      "2) Complete mill MO (50 kg) with production WH = WH-PROD-MILL (≠ STR).\n" +
      "3) /transfers → Putaway TO: from mill WH → STR, product WHFL.\n" +
      "4) Worker /m/tasks Move → Claim → /m/transfers/:id.\n" +
      "5) Pick from mill WH bin; Drop at STR (destination resolves to STR.PR.WHFL.00).\n" +
      "6) /warehouse → STR → Zone PR → leaf 'WHFL (50 kg)' — no shelf children.\n" +
      "7) Inventory ledger: out from mill, in to STR.PR.WHFL.00.",
    expected:
      "Auto-slot STR.PR.<SKU>.00 created on drop; tree flat under Zone PR; TO kind=putaway linked to MO; qty matches good output.",
    type: "Integration",
    priority: "High",
  },
  {
    area: "E2E",
    item: "FG Putaway (same warehouse, no TO)",
    tc: "Vacuum-pack MO at WC-VACUUM — direct landing in STR.PR",
    steps:
      "1) Settings → Production facilities → WC-VACUUM: productionLineWarehouse=STR, productionZone=A (or PR per config).\n" +
      "2) Putaway rule for packed variant → STR toZone=PR.\n" +
      "3) Create MO at Vacuum Pack facility; Release → Issue → Complete WOs → Log output → Complete MO.\n" +
      "4) /transfers → filter Putaway — no new TO for this MO.\n" +
      "5) /warehouse STR → Zone PR → variant SKU leaf shows new qty immediately.\n" +
      "6) Ledger 'Production' rows reference MO orderNo without transfer pair.",
    expected:
      "Same-WH optimization skips putaway TO; FG lands directly in STR.PR.<SKU>.00; inventory correct without mobile move step.",
    type: "Integration",
    priority: "High",
  },
  {
    area: "E2E",
    item: "Manufacturing PWA — full room cycle",
    tc: "Worker runs MO end-to-end from /mfg/*",
    steps:
      "1) /mfg/login → pick worker → PIN → facility=Milling Room.\n" +
      "2) /mfg/room: MO under 'Up next' — note material/work badges.\n" +
      "3) Tap MO → /mfg/mo/:id.\n" +
      "4) Tap 'Release for production' → shortages listed; /mfg/transfers shows new TOs.\n" +
      "5) Tap 'Custom material request' → MaterialRequestModal: add extra consumable line from STR → submit.\n" +
      "6) Execute incoming TO(s) via /mfg/transfers → tap TO → shared MobileTransfer pick/drop.\n" +
      "7) Back to MO → 'Issue materials to this MO'.\n" +
      "8) Work orders: buttons were Locked → now Start → Done on each (QA optional).\n" +
      "9) Log output good + scrap.\n" +
      "10) 'Complete MO'.\n" +
      "11) /mfg/transfers → putaway TO listed if cross-WH.\n" +
      "12) /mfg/profile → switch room to Vacuum Pack → room dashboard reloads different MOs.",
    expected:
      "Full cycle without desktop; material gate on WOs; custom TRF creates manual TO; header shows facility code + greeting; tab counts update live.",
    type: "Integration",
    priority: "High",
  },
  {
    area: "E2E",
    item: "MO cancel rollback",
    tc: "Cancel issued MO restores materials and removes FG",
    steps:
      "1) Create MO 20 kg; Release → Issue → Log partial output 10 kg (do not complete).\n" +
      "2) Note bin qtys for consumed raw and produced FG.\n" +
      "3) Manufacturing → Cancel MO → confirm.\n" +
      "4) Inventory: raw materials restored to line WH; FG output removed.\n" +
      "5) Ledger shows reversal rows paired with original issue/production.\n" +
      "6) Open TOs linked to MO — cancelled or cleaned up per policy.",
    expected:
      "Cancel is atomic rollback; bin qty matches pre-issue state for uncompleted portion; MO status=cancelled; no orphan reservations.",
    type: "Edge",
    priority: "High",
  },
  {
    area: "E2E",
    item: "Stock-rule MO trigger",
    tc: "FG bin below min → draft MO from BOM",
    steps:
      "1) Settings → Stock rule: monitor STR.PR.WHFL (or FG bin), min=100, trigger=MO, link WHFL BOM, orderMultiple=10.\n" +
      "2) Adjust WHFL in Zone PR to 30 kg (below min).\n" +
      "3) Run stock-rule pipeline.\n" +
      "4) /manufacturing → new draft/planned MO for WHFL qty rounded to multiple (e.g. 70 or 80 to reach min).\n" +
      "5) Supply outlook on WHFL shows open MO in pipeline.",
    expected:
      "MO auto-created with correct BOM link; qty honors orderMultiple; effective stock outlook includes draft MO.",
    type: "Integration",
    priority: "High",
  },

  // ── Workforce, transport, billing, reports ────────────────────────────────
  {
    area: "E2E",
    item: "Productivity & attendance",
    tc: "Record worker attendance and view metrics",
    steps:
      "1) Supervisor → /productivity.\n" +
      "2) Select worker → Mark IN at start of shift (timestamp now).\n" +
      "3) Mark OUT at end of shift.\n" +
      "4) View productivity metrics / summary for the day.\n" +
      "5) Repeat IN without OUT (edge) — expect warning or overwrite per policy.",
    expected:
      "Attendance rows saved; duration computed; metrics dashboard updates without error.",
    type: "Functional",
    priority: "Medium",
  },
  {
    area: "E2E",
    item: "Transport & dispatch",
    tc: "Packing slip → dispatch order → trip",
    steps:
      "1) Use packed SO from Order-to-Cash (status packed).\n" +
      "2) /transport → Create dispatch order linked to packing slip / SO.\n" +
      "3) Create trip (vehicle, driver, date).\n" +
      "4) Assign dispatch to trip.\n" +
      "5) Progress trip status: planned → in transit → delivered (or equivalent workflow).\n" +
      "6) Confirm dispatch appears on trip detail; SO/fulfilment status reflects dispatch.",
    expected:
      "Dispatch groups under trip; status transitions valid; no duplicate dispatch on same slip.",
    type: "Functional",
    priority: "Medium",
  },
  {
    area: "E2E",
    item: "Billing cycle",
    tc: "Standalone invoice, partial payment, allocation, share",
    steps:
      "1) /billing → New invoice for Test Retailer without SO (manual lines).\n" +
      "2) Add 2 lines with tax; save → status open.\n" +
      "3) Share → /share/invoice/:token in incognito.\n" +
      "4) Record payment 50% → allocate to invoice.\n" +
      "5) Invoice status partial paid; AR shows remainder.\n" +
      "6) Second payment clears balance → status paid.",
    expected:
      "Tax totals correct; share link read-only; partial then full payment updates status and AR.",
    type: "Integration",
    priority: "High",
  },
  {
    area: "E2E",
    item: "Reports suite",
    tc: "Run each report with filters and export if available",
    steps:
      "1) /reports → open each report: transfer throughput, SKUs missing putaway rules, MO efficiency, vendor performance, stock valuation (as available).\n" +
      "2) Apply date filter last 30 days → data loads without error.\n" +
      "3) /reports/containers → container utilisation report.\n" +
      "4) Cross-check one MO efficiency row against a known completed MO from manufacturing tests.\n" +
      "5) Export CSV where button exists (e.g. transfer throughput).",
    expected:
      "All reports render; filters apply; numbers plausible vs known test data; CSV export downloads valid file.",
    type: "Functional",
    priority: "Medium",
  },
  {
    area: "E2E",
    item: "Approvals workflow",
    tc: "Submit, approve, and reject gated actions",
    steps:
      "1) Trigger an approvable action (e.g. quote discount above threshold, credit limit override — per your config).\n" +
      "2) /approvals → item appears in pending queue.\n" +
      "3) Open detail → Approve → confirm gated action proceeds (quote saves, SO releases, etc.).\n" +
      "4) Trigger second item → Reject → confirm action blocked with reason visible to submitter.",
    expected:
      "Approval queue reflects pending items; approve unlocks action; reject prevents it; audit log captures decision.",
    type: "Functional",
    priority: "Medium",
  },

  // ── Settings & admin ──────────────────────────────────────────────────────
  {
    area: "E2E",
    item: "Settings — putaway & stock rules",
    tc: "Configure zone-PR putaway and stock rule with full column UI",
    steps:
      "1) Admin → /settings → Putaway rules.\n" +
      "2) Verify columns: Product, Barcode, Variant, Variant BC, Destination WH, Bin/Zone, Priority, Status.\n" +
      "3) Add zone-only rule: TEST-FG-01 → STR, toZone=PR, priority=10.\n" +
      "4) Add fixed-bin rule: packaging item → STR.A.S01.99 (pick real bin).\n" +
      "5) Stock rules tab → verify columns incl. Supply outlook.\n" +
      "6) Create MO-trigger rule tied to monitor bin; save.\n" +
      "7) Toggle rule inactive → pipeline skips it.",
    expected:
      "Both rule types save; UI columns populated from API barcodes; inactive rules ignored by pipeline.",
    type: "Functional",
    priority: "High",
  },
  {
    area: "E2E",
    item: "Settings — facilities & company profile",
    tc: "Production facility zones and MO issue gate toggle",
    steps:
      "1) Settings → Production facilities → edit Milling Room: productionZone=A, replenishWarehouseCodes='STR,WH-STO-COLD-1'.\n" +
      "2) Save; create/release test MO — replenishment pulls from listed WHs in order.\n" +
      "3) Company profile → toggle requireMoReleaseBeforeIssue ON.\n" +
      "4) Attempt Issue on unreleased MO → blocked.\n" +
      "5) Release MO → Issue succeeds.\n" +
      "6) Toggle gate OFF → Issue on planned MO per policy.",
    expected:
      "Facility fields drive MO behaviour; company profile gate enforced immediately; no server restart needed.",
    type: "Functional",
    priority: "High",
  },
  {
    area: "E2E",
    item: "Settings — users & UOMs",
    tc: "Admin master data CRUD smoke test",
    steps:
      "1) Settings → UOMs → add category 'Test' with unit 'test-kg' factor 1.\n" +
      "2) Settings → Users → add user role=warehouse, set PIN 1234.\n" +
      "3) Logout → /m/login with new user + PIN — succeeds.\n" +
      "4) Deactivate user → login fails.\n" +
      "5) Reactivate user → login succeeds.",
    expected:
      "UOM available in product picker; new mobile user works; inactive blocks auth.",
    type: "Functional",
    priority: "Medium",
  },

  // ── Mobile & sync ─────────────────────────────────────────────────────────
  {
    area: "E2E",
    item: "Warehouse PWA — task hub",
    tc: "Pick, pack, move tabs; claim; profile logout",
    steps:
      "1) /m/login → warehouse worker, PIN, WH=STR.\n" +
      "2) /m/tasks → verify Pick / Pack / Move tabs and badge counts.\n" +
      "3) Claim one task from each category (if available).\n" +
      "4) /m/scan → scan product then bin barcodes — routes correctly.\n" +
      "5) /m/profile → switch warehouse if multi-WH user → task list refreshes.\n" +
      "6) Sign out → returns to /m/login; token cleared.",
    expected:
      "Task buckets accurate; claim assigns server-side; scan routing works; logout clears session.",
    type: "Integration",
    priority: "High",
  },
  {
    area: "E2E",
    item: "Mobile offline sync",
    tc: "Offline pick confirmation then reconnect sync",
    steps:
      "1) Open /m/picks/:id with pending lines.\n" +
      "2) Enable airplane mode (or DevTools offline).\n" +
      "3) Confirm one pick line — UI queues action (offline indicator in header).\n" +
      "4) Reconnect network.\n" +
      "5) Wait for sync — pick line shows confirmed on server.\n" +
      "6) Desktop /picking → same line marked picked.\n" +
      "7) If conflict test desired: edit same pick on desktop while offline on mobile — sync surfaces conflict.",
    expected:
      "Offline queue persists; sync applies ChangeLog; server and mobile converge; conflicts flagged not silently lost.",
    type: "Integration",
    priority: "High",
  },
  {
    area: "E2E",
    item: "Public documents & print",
    tc: "Share links and print views for fulfilment docs",
    steps:
      "1) From completed quote → copy /share/quote/:token → incognito: read-only, no edit controls.\n" +
      "2) From invoice → /share/invoice/:token.\n" +
      "3) From SO → /share/sales-order/:token.\n" +
      "4) From packing slip → /share/packing-slip/:token.\n" +
      "5) Invalid token URL → friendly error.\n" +
      "6) /print/pick-list/:id and /print/packing-slip/:id → print CSS, no nav chrome.",
    expected:
      "All four share types render; invalid token handled; print pages suitable for paper/PDF.",
    type: "Functional",
    priority: "Medium",
  },
  {
    area: "E2E",
    item: "Command palette & workspace",
    tc: "Desktop navigation shortcuts and multi-tab workflow",
    steps:
      "1) Login desktop → Ctrl+K (or Cmd+K) open Command palette.\n" +
      "2) Search 'Transfers' → navigate.\n" +
      "3) Open Products in new workspace tab (middle-click nav or palette).\n" +
      "4) Switch tabs — each page retains state.\n" +
      "5) Close tab → returns to previous tab.",
    expected:
      "Palette finds all major modules; workspace tabs isolate state; no full page reload on tab switch.",
    type: "UI",
    priority: "Low",
  },
];

/** All E2E cases: core journeys + stock automation + granular process flows (100+). */
export const flows: E2eRow[] = [...coreFlows, ...stockAutomationFlows, ...processFlows];
