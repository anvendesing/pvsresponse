/**
 * E2E cases: stock rules, low-stock automation, TO/PO/MO auto-generation.
 */
import { e2e } from "./test-plan-e2e-helpers.js";

export const stockAutomationFlows = [
  // ── Transfer TO — low stock replenishment ─────────────────────────────────
  e2e(
    "Stock rule → Transfer TO",
    "Monitor bin drops below min → replenishment TO auto-created",
    "PREP: Raw item WHET in STR; monitor bin STR.A.S01.03; source bin STR.A.S01.01 has stock.\n" +
      "1) Admin → Settings → Stock rules → New rule:\n" +
      "   • Product: WHET (raw wheat)\n" +
      "   • Monitor bin: STR.A.S01.03\n" +
      "   • Min qty: 100 kg\n" +
      "   • Trigger: Transfer\n" +
      "   • Source bin: STR.A.S01.01\n" +
      "   • Destination: monitor bin STR.A.S01.03\n" +
      "   • Active: yes\n" +
      "2) Inventory → set monitor bin STR.A.S01.03 qty to 40 kg (below min).\n" +
      "3) Settings → Stock rules → Run pipeline (or POST /stock-rules/run-pipeline).\n" +
      "4) /transfers → Replenishment tab → locate new TO.\n" +
      "5) Open slide-over: verify kind=replenishment, status=ready, line WHET qty ≈ 60 kg (100−40).\n" +
      "6) Notes field: plain text with product name, qty, source→dest (no raw JSON).\n" +
      "7) Supply outlook on WHET: effective stock still below min until TO executed.",
    "Replenishment TO created once; line qty targets min gap; fromBin=source, toBin=monitor; notes human-readable."
  ),
  e2e(
    "Stock rule → Transfer TO",
    "Stock above min after pipeline → rule skipped (above_min)",
    "1) Using same WHET transfer rule from prior case.\n" +
      "2) Inventory → adjust monitor bin STR.A.S01.03 to 150 kg (above min 100).\n" +
      "3) Run stock-rule pipeline.\n" +
      "4) /transfers → confirm NO new replenishment TO for WHET on this bin.\n" +
      "5) Settings → Stock rules row: Supply outlook column shows effective ≥ min (green/ok indicator).",
    "Pipeline returns skippedReason=above_min; no duplicate TO; rule row shows adequate supply.",
    { priority: "High" }
  ),
  e2e(
    "Stock rule → Transfer TO",
    "Open draft PO in pipeline counts toward effective — no TO when PO covers gap",
    "1) Create PO-trigger or manual draft PO: WHET 200 kg status=draft (unreceived).\n" +
      "2) Set monitor bin on-hand to 30 kg; min=100 → gap 70 but PO pipeline 200.\n" +
      "3) Run pipeline for transfer rule on same bin.\n" +
      "4) Confirm no replenishment TO created.\n" +
      "5) Product Supply outlook: poPipeline=200, effective=230.",
    "Effective stock = on-hand + open PO qty; transfer rule suppressed when pipeline covers min.",
    { priority: "High" }
  ),
  e2e(
    "Stock rule → Transfer TO",
    "Open planned MO in pipeline counts toward effective — no TO for FG monitor bin",
    "1) Stock rule on finished WHFL monitor bin STR.PR.WHFL with trigger=Transfer (if configured) OR test MO trigger separately.\n" +
      "2) Create planned MO for WHFL 80 kg (not completed).\n" +
      "3) Set WHFL on-hand in monitor bin to 25 kg; min=100.\n" +
      "4) Run pipeline.\n" +
      "5) Supply outlook: moPipeline=80, effective=105 → no new auto-MO/TO.",
    "MO pipeline included in effective stock; automation does not over-order when MO already planned.",
    { priority: "High" }
  ),
  e2e(
    "Stock rule → Transfer TO",
    "Transfer line qty respects orderMultiple rounding",
    "1) Edit transfer stock rule: orderMultiple=25 kg.\n" +
      "2) Set monitor bin qty=10 kg, min=100 → raw gap 90.\n" +
      "3) Run pipeline.\n" +
      "4) Open TO line qty — expect 100 kg (4×25) not 90.",
    "Requested transfer qty rounded UP to nearest orderMultiple.",
    { priority: "High" }
  ),
  e2e(
    "Stock rule → Transfer TO",
    "Transfer line capped by maxQty on rule",
    "1) Set rule maxQty=50 kg, min=100, monitor bin=20 kg.\n" +
      "2) Run pipeline.\n" +
      "3) TO line qty = 50 (not 80 gap).",
    "maxQty limits single auto-transfer line even when gap is larger.",
    { priority: "Medium" }
  ),
  e2e(
    "Stock rule → Transfer TO",
    "Source bin empty → TO created with null fromBinId (await refresh)",
    "1) Empty source bin STR.A.S01.01 (qty=0).\n" +
      "2) Monitor bin below min; run pipeline.\n" +
      "3) TO created status=ready but line fromBinId=null.\n" +
      "4) GRN or Adjust +100 kg into source bin.\n" +
      "5) Mobile /m/transfers/:id → Refresh source bins.\n" +
      "6) fromBinId populated; worker can pick.",
    "TO not blocked by empty source; refresh resolves after stock lands.",
    { priority: "High" }
  ),
  e2e(
    "Stock rule → Transfer TO",
    "Re-run pipeline does not duplicate open replenishment TO",
    "1) Trigger transfer TO (monitor below min).\n" +
      "2) Leave TO in status=ready (do not execute).\n" +
      "3) Run pipeline again without qty change.\n" +
      "4) Count open replenishment TOs for same rule/product — still 1.",
    "Duplicate suppression while an open TO covers the shortage.",
    { priority: "High" }
  ),
  e2e(
    "Stock rule → Transfer TO",
    "Inactive transfer rule does not generate TO",
    "1) Set monitor bin below min.\n" +
      "2) Deactivate stock rule (active=false).\n" +
      "3) Run pipeline.\n" +
      "4) No new TO.",
    "Inactive rules ignored entirely.",
    { priority: "Medium" }
  ),
  e2e(
    "Stock rule → Transfer TO",
    "Execute replenishment TO → monitor bin reaches min",
    "1) From auto-created replenishment TO: assign worker.\n" +
      "2) /m/transfers/:id → pick from source → drop at monitor bin.\n" +
      "3) TO status=done.\n" +
      "4) Monitor bin qty ≥ min.\n" +
      "5) Run pipeline again → skipped (above_min).",
    "Physical execution closes loop; subsequent pipeline run clean.",
    { priority: "High" }
  ),
  e2e(
    "Stock rule → Transfer TO",
    "Variant-scoped rule triggers only for matching variant stock",
    "1) Product with 2 variants; create stock rule scoped to variant A monitor bin.\n" +
      "2) Drain variant A bin below min; keep variant B above min.\n" +
      "3) Run pipeline → TO only for variant A SKU.\n" +
      "4) TO line carries correct variantId.",
    "Variant-level monitor bin + rule isolation.",
    { priority: "Medium" }
  ),
  e2e(
    "Stock rule → Transfer TO",
    "Two active rules on different monitor bins both trigger",
    "1) Rule A: monitor STR.A.S01.03 min=100.\n" +
      "2) Rule B: monitor STR.B.S02.01 min=50 (different product or same).\n" +
      "3) Drain both below min.\n" +
      "4) Run pipeline once.\n" +
      "5) /transfers shows 2 replenishment TOs (or 1 TO with 2 lines if grouped — verify actual behaviour).",
    "Independent rules fire independently; both shortages addressed.",
    { priority: "Medium" }
  ),
  e2e(
    "Stock rule → Transfer TO",
    "Desktop /transfers Replenishment tab count matches created TOs",
    "1) Trigger 3 replenishment TOs via pipeline.\n" +
      "2) /transfers KPI Pending increments.\n" +
      "3) Replenishment tab filter shows exactly those 3.\n" +
      "4) All tab also lists them with kind badge.",
    "UI counts stay in sync with server-side auto-generation.",
    { priority: "Medium" }
  ),
  e2e(
    "Stock rule → Transfer TO",
    "Mobile Move tab lists replenishment TO with pretty notes",
    "1) Auto TO from stock rule.\n" +
      "2) Worker /m/tasks → Move → Available.\n" +
      "3) Card shows product, qty, source→dest in notes.\n" +
      "4) No visible 'StockRule:uuid' except optionally at end of note.",
    "Mobile UX matches desktop note cleanup.",
    { priority: "Medium" }
  ),
  e2e(
    "Stock rule → Transfer TO",
    "Cancel auto replenishment TO → re-run pipeline recreates",
    "1) Trigger TO; cancel from /transfers slide-over.\n" +
      "2) Monitor bin still below min.\n" +
      "3) Run pipeline.\n" +
      "4) New replenishment TO created.",
    "Cancelled TO does not permanently suppress automation.",
    { priority: "Medium" }
  ),

  // ── PO generation — low stock procurement ─────────────────────────────────
  e2e(
    "Stock rule → PO",
    "Single raw item below min → draft PO created for linked vendor",
    "1) Settings → Stock rule:\n" +
      "   • Product: raw item (e.g. WHET)\n" +
      "   • Trigger: PO\n" +
      "   • Vendor: linked vendor with catalog entry\n" +
      "   • Min qty: 500 kg (global/bin-less rule OR monitor bin rule)\n" +
      "   • Monitor: appropriate bin or global PO rule\n" +
      "2) Drain effective stock below 500 (adjust bins + no open PO).\n" +
      "3) Run pipeline.\n" +
      "4) /procurement → PO list → new status=draft PO for vendor.\n" +
      "5) Line: WHET, qty covers gap rounded to orderMultiple.",
    "Draft PO appears; vendor correct; line qty addresses shortage."
  ),
  e2e(
    "Stock rule → PO",
    "Two products same vendor below min → one grouped draft PO",
    "1) Rule 1: product A, vendor X, trigger=PO, min=100.\n" +
      "2) Rule 2: product B, vendor X, trigger=PO, min=50.\n" +
      "3) Drain both products below mins.\n" +
      "4) Run pipeline once.\n" +
      "5) Single draft PO vendor X with lines A and B.",
    "PO grouping by vendorId in checkGlobalPoStockRules.",
    { priority: "High" }
  ),
  e2e(
    "Stock rule → PO",
    "Two products different vendors → two draft POs",
    "1) Product A → vendor X; Product B → vendor Y; both below min.\n" +
      "2) Run pipeline.\n" +
      "3) Two draft POs, one per vendor.",
    "No cross-vendor grouping.",
    { priority: "High" }
  ),
  e2e(
    "Stock rule → PO",
    "PO line qty uses orderMultiple (e.g. 25 kg bags)",
    "1) Rule orderMultiple=25, gap=73 kg.\n" +
      "2) Run pipeline.\n" +
      "3) PO line qty=75 (3×25).",
    "Rounded up to multiple.",
    { priority: "High" }
  ),
  e2e(
    "Stock rule → PO",
    "PO line capped by maxQty",
    "1) Rule maxQty=200, gap=500.\n" +
      "2) Run pipeline.\n" +
      "3) PO line qty=200.",
    "maxQty respected on auto-draft line.",
    { priority: "Medium" }
  ),
  e2e(
    "Stock rule → PO",
    "Vendor catalog price autofills on auto-draft PO line",
    "1) Vendor catalog: WHET @ ₹35/kg.\n" +
      "2) Trigger PO via pipeline.\n" +
      "3) Open PO editor → unit price=35 without manual entry.",
    "Catalog integration on auto-generated PO.",
    { priority: "High" }
  ),
  e2e(
    "Stock rule → PO",
    "Promised date on auto PO uses vendor catalog lead time",
    "1) Catalog lead time=7 days.\n" +
      "2) Trigger PO today.\n" +
      "3) Line promised date ≈ today+7.",
    "Lead time drives promised date.",
    { priority: "Medium" }
  ),
  e2e(
    "Stock rule → PO",
    "Existing open draft PO in pipeline suppresses duplicate PO line",
    "1) Trigger PO → draft PO 100 kg WHET.\n" +
      "2) Run pipeline again without consumption.\n" +
      "3) Still one PO; no duplicate 100 kg line.",
    "Open PO qty counts in effective stock / duplicate guard.",
    { priority: "High" }
  ),
  e2e(
    "Stock rule → PO",
    "Partial GRN receive → pipeline tops up remaining gap",
    "1) Auto PO 200 kg WHET.\n" +
      "2) GRN receive 80 kg → PO partial.\n" +
      "3) Effective still below min.\n" +
      "4) Run pipeline → either new PO or amended line for remaining (verify: no over-order beyond min).",
    "Pipeline reacts to partial receipt; total pipeline aligns with min target.",
    { priority: "High" }
  ),
  e2e(
    "Stock rule → PO",
    "Close PO when fully received → pipeline can re-trigger if stock drops again",
    "1) Receive full PO; Close PO.\n" +
      "2) Pick/issue stock until below min.\n" +
      "3) Run pipeline → new draft PO.",
    "Closed PO no longer in pipeline; new shortage creates new PO.",
    { priority: "High" }
  ),
  e2e(
    "Stock rule → PO",
    "Global PO rule (no monitor bin) evaluates total product on-hand",
    "1) Create PO trigger rule with monitorBinId=null (global) if supported, or product-level monitor.\n" +
      "2) Sum on-hand across all bins below min.\n" +
      "3) Run pipeline → PO created.",
    "Global PO rules in checkGlobalPoStockRules fire correctly.",
    { priority: "High" }
  ),
  e2e(
    "Stock rule → PO",
    "Supply outlook shows open auto-draft PO in pipeline",
    "1) Trigger auto PO.\n" +
      "2) Products → WHET → Supply outlook tab.\n" +
      "3) Pipeline section lists draft PO qty.\n" +
      "4) Effective = on-hand + poPipeline.",
    "UI outlook matches server pipeline math.",
    { priority: "Medium" }
  ),
  e2e(
    "Stock rule → PO",
    "Procurement user can approve and receive auto-draft PO end-to-end",
    "1) Auto draft PO from pipeline.\n" +
      "2) Procurement → open PO → approve (if workflow).\n" +
      "3) Receive GRN full qty into STR bin.\n" +
      "4) Inventory on-hand restored above min.\n" +
      "5) Run pipeline → no new PO.",
    "Auto-generated PO flows through normal procurement lifecycle.",
    { priority: "High" }
  ),
  e2e(
    "Stock rule → PO",
    "Inactive PO rule skipped on pipeline run",
    "1) Below min with inactive PO rule.\n" +
      "2) Run pipeline → no PO.",
    "active=false respected.",
    { priority: "Medium" }
  ),
  e2e(
    "Stock rule → PO",
    "Stock rules UI: PO trigger row shows vendor + outlook before run",
    "1) /settings → Stock rules.\n" +
      "2) Locate PO rule row: columns Product, Barcode, Monitor bin, Min, Supply outlook, Trigger=PO.\n" +
      "3) Outlook column shows on-hand vs min before manual pipeline.",
    "Columns populated; outlook preview accurate.",
    { priority: "Medium" }
  ),

  // ── MO generation — low stock manufacturing ───────────────────────────────
  e2e(
    "Stock rule → MO",
    "Finished goods below min → draft/planned MO from linked BOM",
    "1) Stock rule: product WHFL, trigger=MO, min=100 kg, monitor bin STR.PR.WHFL, BOM linked.\n" +
      "2) Set WHFL in Zone PR to 30 kg.\n" +
      "3) Run pipeline.\n" +
      "4) /manufacturing → new MO for WHFL qty ≈ 70+ (rounded to orderMultiple).\n" +
      "5) MO status planned; BOM attached.",
    "Auto-MO created via createAutoMo."
  ),
  e2e(
    "Stock rule → MO",
    "MO qty respects orderMultiple on auto-MO",
    "1) Rule orderMultiple=10, gap=73.\n" +
      "2) Run pipeline.\n" +
      "3) MO plannedQty=80.",
    "MO qty rounded up.",
    { priority: "High" }
  ),
  e2e(
    "Stock rule → MO",
    "Open planned MO prevents duplicate auto-MO",
    "1) Existing planned MO 50 kg WHFL.\n" +
      "2) On-hand 30, min 100 → gap 70 but moPipeline 50.\n" +
      "3) Run pipeline → at most one additional MO for remaining 20 (or skip if effective OK).",
    "MO pipeline deduplication via effective stock.",
    { priority: "High" }
  ),
  e2e(
    "Stock rule → MO",
    "Auto-MO uses BOM default facility and scaffolds WOs",
    "1) Trigger auto-MO.\n" +
      "2) Open MO detail → facility = BOM defaultFacility.\n" +
      "3) MoWorkOrdersPanel lists operations from BOM.",
    "Default facility/machine from BOM applied.",
    { priority: "High" }
  ),
  e2e(
    "Stock rule → MO",
    "Complete auto-MO → FG stock rises → pipeline skips",
    "1) Execute auto-MO through release/issue/complete.\n" +
      "2) WHFL in Zone PR ≥ min.\n" +
      "3) Run pipeline → no new MO.",
    "Production closes FG shortage.",
    { priority: "High" }
  ),
  e2e(
    "Stock rule → MO",
    "Variant-specific BOM on variant monitor rule",
    "1) Rule scoped to variant; BOM for that variant.\n" +
      "2) Drain variant stock below min.\n" +
      "3) Auto-MO uses correct variant BOM scope.",
    "VariantId honoured on rule + MO.",
    { priority: "Medium" }
  ),
  e2e(
    "Stock rule → MO",
    "Supply outlook MO pipeline column after auto-MO",
    "1) Trigger auto-MO 60 kg.\n" +
      "2) Product supply outlook: moPipeline=60.",
    "Outlook reflects open MO.",
    { priority: "Medium" }
  ),
  e2e(
    "Stock rule → MO",
    "Cancel auto-MO → re-trigger if still below min",
    "1) Cancel planned auto-MO.\n" +
      "2) Stock still below min.\n" +
      "3) Run pipeline → new MO.",
    "Cancel clears pipeline contribution.",
    { priority: "Medium" }
  ),

  // ── MO release replenishment (distinct from stock rules) ──────────────────
  e2e(
    "MO release → Replenishment TO",
    "Release MO with raw shortage → auto replenishment TO to line WH",
    "1) Create MO WHFL 50 kg at Milling Room; line WH empty.\n" +
      "2) Release MO.\n" +
      "3) /transfers Replenishment tab: TO(s) for WHET/raw components.\n" +
      "4) Destination = production line WH (WH-PROD-MILL).\n" +
      "5) Notes readable: 'Replenish WHET 52.5 kg from STR…'.",
    "MO release shortage explosion creates TOs separate from stock rules."
  ),
  e2e(
    "MO release → Replenishment TO",
    "Multiple BOM components short → multiple TO lines or TOs",
    "1) BOM with WHET + salt + packaging all short.\n" +
      "2) Release MO.\n" +
      "3) Verify each shortage appears (lines or separate TOs).\n" +
      "4) Execute all before Issue materials.",
    "All exploded leaf shortages addressed.",
    { priority: "High" }
  ),
  e2e(
    "MO release → Replenishment TO",
    "Facility replenishWarehouseCodes priority order",
    "1) Facility replenishWarehouseCodes='WH-STO-COLD-1,STR'.\n" +
      "2) Stock in both; release MO.\n" +
      "3) TO source picks first WH in list with sufficient qty.",
    "Replenish source priority from facility config.",
    { priority: "High" }
  ),
  e2e(
    "MO release → Replenishment TO",
    "Partial stock at line → TO qty = shortage only",
    "1) Line WH has 20 kg WHET; MO needs 52.5 kg.\n" +
      "2) Release → TO line ≈ 32.5 kg not full 52.5.",
    "Net shortage after line on-hand.",
    { priority: "High" }
  ),
  e2e(
    "MO release → Replenishment TO",
    "Execute MO replenishment TO then Issue materials succeeds",
    "1) Release → TO → mobile pick/drop to line WH.\n" +
      "2) Manufacturing → Issue materials.\n" +
      "3) requirements.materialsIssued=true.",
    "Issue gate cleared after replenishment.",
    { priority: "High" }
  ),
  e2e(
    "MO release → Replenishment TO",
    "Custom material request creates manual TO linked to MO",
    "1) Mfg PWA → Custom material request extra line.\n" +
      "2) /transfers Manual or Replenishment → TO kind=manual linked to MO.\n" +
      "3) Execute → issue includes extra qty.",
    "Ad-hoc material TO path.",
    { priority: "High" }
  ),

  // ── MO complete → Putaway TO ────────────────────────────────────────────
  e2e(
    "MO complete → Putaway TO",
    "Cross-warehouse MO complete → putaway TO kind=putaway auto-created",
    "1) Production WH = WH-PROD-MILL; putaway rule WHFL → STR zone PR.\n" +
      "2) Complete MO 50 kg good output.\n" +
      "3) /transfers Putaway tab: TO from mill WH → STR.\n" +
      "4) Linked to MO orderNo in meta.",
    "Putaway TO on cross-WH completion."
  ),
  e2e(
    "MO complete → Putaway TO",
    "Same production WH as destination → NO putaway TO (vacuum pack)",
    "1) WC-VACUUM production WH = STR; rule → STR zone PR.\n" +
      "2) Complete MO.\n" +
      "3) No putaway TO; FG in STR.PR.<SKU>.00 immediately.",
    "Same-WH optimization.",
    { priority: "High" }
  ),
  e2e(
    "MO complete → Putaway TO",
    "Putaway TO destination resolves to STR.PR.<SKU>.00 zone slot",
    "1) Zone-only putaway rule.\n" +
      "2) Execute putaway TO on mobile.\n" +
      "3) Drop → bin STR.PR.WHFL.00 created/updated.\n" +
      "4) Warehouse tree Zone PR → WHFL leaf.",
    "Zone PR auto-slot on drop.",
    { priority: "High" }
  ),
  e2e(
    "MO complete → Putaway TO",
    "Fixed-bin putaway rule pins destination bin on TO",
    "1) Putaway rule with explicit toBinId (not zone-only).\n" +
      "2) Complete MO → TO destination = that bin.\n" +
      "3) Mobile drop must target pinned bin.",
    "Fixed bin rule honoured.",
    { priority: "Medium" }
  ),
  e2e(
    "MO complete → Putaway TO",
    "Variant putaway rule wins over product-level rule",
    "1) Product rule → STR zone PR.\n" +
      "2) Variant rule → STR zone A fixed bin.\n" +
      "3) Complete variant MO → destination follows variant rule.",
    "Putaway resolution waterfall.",
    { priority: "Medium" }
  ),

  // ── Combined pipeline scenarios ───────────────────────────────────────────
  e2e(
    "Stock rule pipeline",
    "Full pipeline run processes all active rules in one click",
    "1) Configure 1 transfer rule, 2 PO rules (same vendor), 1 MO rule — all below min.\n" +
      "2) Settings → Run pipeline once.\n" +
      "3) Verify: replenishment TO + grouped PO + planned MO all created.\n" +
      "4) Check response/summary if UI shows counts.",
    "checkAllStockRules aggregates bin-scoped + global PO rules."
  ),
  e2e(
    "Stock rule pipeline",
    "Pick/issue draining bin triggers check on bin update (if wired)",
    "1) Monitor bin at min exactly.\n" +
      "2) Pick 1 kg from monitor bin via sales pick or transfer out.\n" +
      "3) If auto-check enabled: replenishment TO appears; else manual pipeline run creates it.",
    "Document whether bin qty change auto-fires rules or requires manual pipeline.",
    { priority: "Medium" }
  ),
  e2e(
    "Stock rule pipeline",
    "Reports: SKUs missing putaway rules lists finished goods without rules",
    "1) /reports → SKUs missing putaway rules.\n" +
      "2) Cross-check against Settings putaway list.\n" +
      "3) Add missing rule → re-run report → SKU drops off.",
    "Report drives putaway completeness before go-live.",
    { priority: "Medium" }
  ),
];
