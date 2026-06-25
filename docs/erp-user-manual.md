# PVS ERP — User Manual & Training Guide

**Version:** 1.0 · **Site:** Kothavaripalle, AP  
**Portal:** ERP Portal (desktop) + Mobile Warehouse PWA  
**Audience:** Supervisors, procurement, warehouse staff, billing, and administrators

---

## Table of contents

1. [Introduction](#1-introduction)
2. [Getting started](#2-getting-started)
3. [Roles and access](#3-roles-and-access)
4. [Physical layout and terminology](#4-physical-layout-and-terminology)
5. [Desktop navigation](#5-desktop-navigation)
6. [Dashboard](#6-dashboard)
7. [Products and catalog](#7-products-and-catalog)
8. [Procurement](#8-procurement)
9. [Inventory and stock](#9-inventory-and-stock)
10. [Warehouse and locations](#10-warehouse-and-locations)
11. [Transfer orders](#11-transfer-orders)
12. [Manufacturing](#12-manufacturing)
13. [Sales, quotes, and fulfilment](#13-sales-quotes-and-fulfilment)
14. [Billing and POS](#14-billing-and-pos)
15. [Transport and dispatch](#15-transport-and-dispatch)
16. [Returns and credit notes](#16-returns-and-credit-notes)
17. [Approvals](#17-approvals)
18. [Reports](#18-reports)
19. [Settings and administration](#19-settings-and-administration)
20. [Mobile warehouse app](#20-mobile-warehouse-app)
21. [Automation: stock rules](#21-automation-stock-rules)
22. [End-to-end scenarios](#22-end-to-end-scenarios)
23. [Glossary](#23-glossary)
24. [Tips and troubleshooting](#24-tips-and-troubleshooting)

---

## 1. Introduction

PVS ERP is an integrated system for a food-processing plant. It connects:

- **Buying** raw materials (procurement, GRN)
- **Making** products (manufacturing orders, BOMs, work orders)
- **Storing** stock (warehouses, bins, transfers)
- **Selling** to customers (quotes, sales orders, invoices)
- **Shipping** (pick, pack, trips)

The same stock ledger powers desktop screens and the **mobile warehouse app** used on the shop floor with barcode scanning.

### Two applications

| Application | URL (dev) | Who uses it |
|-------------|-----------|-------------|
| **ERP Portal** (desktop) | `http://localhost:5173/` | Office, supervisors, procurement, billing |
| **Mobile PWA** | `/m/` on same host | Warehouse workers, floor staff |

Workers typically log in on mobile with a **6-digit PIN**. Office staff use **username + password**.

---

## 2. Getting started

### 2.1 Logging in (desktop)

1. Open the ERP Portal.
2. Enter **username** and **password**.
3. You land on the **Dashboard**.

Your role controls which menu items you see. If a module is missing from the left menu, your account does not have access — ask an administrator.

### 2.2 Workspace tabs

Each item you open from the left navigation opens in a **tab** at the top. You can keep several modules open (e.g. Manufacturing + Inventory) and switch between tabs without losing your place.

### 2.3 Command Palette (power users)

Press **`Ctrl+K`** or **`Ctrl+/`** to open the Command Palette.

Use it to:

- **Jump** to any module (Dashboard, Products, Procurement, Manufacturing, …)
- **Search** products, invoices, vendors, workers, production orders
- **Quick actions:** New Invoice, New Purchase Order, Stock Transfer, New Production Order

### 2.4 Barcode scanner overlay

Press **`Ctrl+B`** from the desktop top bar to open the scanner overlay for quick product or location lookup.

### 2.5 Signing out

Use **Sign out** in the top command bar. On mobile, use **Profile → Sign out**.

---

## 3. Roles and access

| Role | Typical users | Main modules |
|------|---------------|--------------|
| **Admin** | IT, plant manager | Everything including **Settings** |
| **Supervisor** | Production/plant supervisor | Manufacturing, BOMs, Productivity, most ops, Approvals |
| **Procurement** | Purchase team | Products, Procurement, Price lists, Inventory (read/adjust) |
| **Billing** | Sales counter, accounts | Customers, Quotes, SOs, Billing, Returns, Picking/Packing (office view) |
| **Warehouse** | Storekeepers | Inventory, Warehouse, Transfers, Picking, Packing, WH Audit, mobile |
| **Worker** | Floor operators | **Mobile app only** — tasks, scan, count |

**Admin** bypasses all restrictions. Other roles see only the nav items listed in the system configuration.

---

## 4. Physical layout and terminology

Understanding *where* stock lives is essential before using inventory or manufacturing modules.

### 4.1 Warehouse types

| Type | Examples | Purpose |
|------|----------|---------|
| **Storage (godowns)** | WH-STOR (Big Godown), WH-GDNW (New Godown), WH-STO-OILSEEDS, WH-RAW | Long-term bulk raw materials |
| **Production** | WH-PROD-OIL, WH-PROD-MILL, WH-PROD-SOAP, … | Shop-floor buffer: materials staged here before/during MO; temporary FG before putaway |
| **Finished goods** | **STR** (Stock Room) | Retail-ready products; vacuum/manual packing zone A |

### 4.2 Production facilities (rooms)

Each facility is a physical area with one or more **production lines** and a linked **production warehouse**:

| Facility | Production WH | Typical work |
|----------|---------------|--------------|
| Oil Extraction | WH-PROD-OIL | Seed → oil extract → filter → fill variants |
| Milling Room | WH-PROD-MILL | Destone, hull, rice/ragi → semi-finished |
| Manual Cleaning | WH-PROD-MCLEAN | Grade/clean semi → bulk for STR |
| Flour Mill | WH-PROD-FLOUR | Flour, spice, ravva grinding |
| Soap Room | WH-PROD-SOAP | Soap process |
| Snacks Room | WH-PROD-SNACKS | Snacks production |
| Stock Room Packing | STR zone A | Vacuum and manual retail packing |

### 4.3 Location hierarchy

Stock is always stored in **bins**:

```
Warehouse → Zone → Shelf → Bin
Example:   STR → A → S17 → 03
```

- **Godowns** are often scanned at **shelf** level (bin `00` = whole shelf).
- **Stock Room** uses full bin labels on every slot.

### 4.4 Key document types

| Code prefix | Name | Meaning |
|-------------|------|---------|
| PO- | Purchase order | Order to a vendor |
| GRN- | Goods receipt | Physical receipt against a PO |
| MO- | Manufacturing order | Production run |
| TRF- | Transfer order | Warehouse move (pick → drop) |
| SO- | Sales order | Customer order |
| INV- | Invoice | Bill to customer |
| TRP- | Trip | Truck dispatch plan |

---

## 5. Desktop navigation

Left menu groups (top to bottom):

**Overview:** Dashboard  

**Catalog & buying:** Products, Procurement, Price lists  

**Sales:** Customers, Enquiries, Quotes, Sales orders, Picking, Packing, Returns  

**Stock:** Inventory, Warehouse, Transfers  

**Production:** Manufacturing, BOMs, Productivity  

**Logistics:** Transport  

**Finance:** Billing  

**Analytics:** Reports, Container reports  

**Bottom:** Approvals, Settings (admin)

---

## 6. Dashboard

**Purpose:** Plant-wide snapshot at login.

**What you see:**

- Production efficiency, active workers, delayed MOs
- Low-stock alerts (below reorder level)
- Sales vs COGS chart (14 days)
- Procurement spend by category
- Planned vs actual production
- Station load (work centres)
- Enquiry pipeline widget

**Actions:** Click KPIs or chart segments to drill into Manufacturing, Inventory, Enquiries, etc.

---

## 7. Products and catalog

**Path:** Products  
**Roles:** Supervisor, Procurement, Admin

### 7.1 Product types

| Type | Example | Used for |
|------|---------|----------|
| Raw | WSS (white sesame seeds) | Purchased inputs |
| Semi | GOIL-UNFILT | Intermediate manufacturing output |
| Finished | GOIL, RAGI | Sold products (bulk or packed) |
| Consumable | Packaging, chemicals | Used but not sold |
| Service | Labour, freight | Non-stock lines |

### 7.2 Variants

A **parent product** (e.g. Groundnut Oil) can have **variants** (500 ml, 1 L, 5 L). Each variant has its own SKU, barcode, and stock counter.

### 7.3 Common tasks

**Create a product**

1. Click **New product**.
2. Enter SKU, name, type, UoM (kg, L, pc), category, prices.
3. Add variants if needed (size, pack size, barcode).
4. Save.

**Edit / upload image**

1. Select product in the list.
2. Use the detail panel → **Edit** or drag an image.

**Supply outlook**

Select a product → **Supply outlook** panel shows:

- On-hand stock
- Open purchase orders (incoming)
- Open manufacturing orders (pipeline)
- Stock rules and replenishment hints

**Export**

Use **Export CSV** for a spreadsheet of products or variants.

**Find a SKU quickly**

Use the search box above the list. If a SKU does not appear in dropdowns elsewhere, ensure it is active and the list limit includes it.

---

## 8. Procurement

**Path:** Procurement  
**Roles:** Procurement, Admin

Three tabs: **PO**, **Vendors**, **GRN**.

### 8.1 Vendors

**Add vendor:** Vendors tab → **Add vendor** → code, name, GST, contact, payment terms, lead time.

**Vendor catalog:** Link vendor part numbers and pack sizes to internal SKUs (used for PO lines and auto-reorder).

**Vendor detail:** View performance metrics and catalog from the vendor row.

### 8.2 Purchase orders (PO)

**Create PO**

1. PO tab → **New PO**.
2. Select vendor, add lines (product, qty, rate).
3. Set expected delivery date.
4. Save as **draft**.

**Approve PO**

1. Open draft PO → **Approve**.
2. Status becomes **approved** — lines are locked (notes only).
3. Share PO with vendor via **Share** link if needed.

**PO statuses**

```
draft → approved → partial → received
                 ↘ closed (manual)
draft → cancelled (only if no GRNs)
```

| Status | Meaning |
|--------|---------|
| draft | Being prepared |
| approved | Sent to vendor; awaiting delivery |
| partial | Some goods received |
| received | Fully received |
| closed | Manually closed (short-ship, write-off) |
| cancelled | Voided before receipt |

### 8.3 Goods receipt (GRN)

**Receive against PO (desktop)**

1. Open approved PO → **Receive** (or GRN tab → receive from PO).
2. Enter accepted qty, rejected qty, batch/expiry if applicable.
3. **Allocate bins** — split qty across one or more destination bins (putaway).
4. Post GRN.

**GRN QC**

After receipt, QC status is set per GRN:

| QC status | Meaning |
|-----------|---------|
| pending | Awaiting inspection |
| pass | Accepted into stock |
| rework | Needs rework before use |
| reject | Rejected; qty not added to usable stock |

**Close PO**

When all lines are received (or you accept short-ship), use **Close PO** with confirmation preview.

### 8.4 Procurement workflow summary

```
Need stock → Create PO → Approve → Vendor delivers
    → GRN receive + bin allocation → Stock in bins → PO received/closed
```

Stock rules can also **auto-draft POs** when global raw stock falls below minimum (Settings → Stock rules, trigger type **PO**).

---

## 9. Inventory and stock

**Path:** Inventory  
**Roles:** Supervisor, Warehouse, Procurement, Admin

### 9.1 Tabs

| Tab | Purpose |
|-----|---------|
| **Locations** | Find stock by product, warehouse, or bin; adjust qty |
| **Ledger** | Full audit trail of movements |
| **Valuation** | Inventory value snapshot |
| **Batches** | Lot/batch traceability (FIFO) |

### 9.2 Finding stock

1. Locations tab → search by SKU, product name, or bin code.
2. Expand warehouse → zone → shelf → bin.
3. See qty, reserved qty, and product assignment.

### 9.3 Adjust stock

1. Select a bin or use **Adjust stock** from product context.
2. Choose **delta** (+/− qty) or **count** (set absolute qty).
3. Enter reason (physical match, damage, spillage, etc.).
4. Save — ledger row is written automatically.

**Deep link from Manufacturing:** When an MO shows a shortage, use the link to Inventory with `adjust=1` pre-filled.

### 9.4 Stock ledger transaction types

| Type | Typical source |
|------|----------------|
| GRN | Goods receipt |
| Sale | Invoice / dispatch |
| Issue | MO material issue |
| Production | MO output / complete |
| Transfer | Transfer order pick/drop |
| Adjust | Manual adjustment or cycle count |

### 9.5 Reserved quantity

**Reserved qty** on a bin means stock is earmarked for an open **pick list** or **in-transit transfer** but not yet finally consumed. Free stock = `qty − reservedQty`.

---

## 10. Warehouse and locations

**Path:** Warehouse  
**Roles:** Supervisor, Warehouse, Admin

### 10.1 Tree navigation

Browse **Warehouse → Zone → Shelf → Bin**. Occupancy indicators (green / amber / red) show how full a bin is relative to capacity.

### 10.2 Bin operations

| Action | When to use |
|--------|-------------|
| **Edit bin** | Change capacity, notes |
| **Bin layout** | Bulk-create bins for a new zone/shelf |
| **Rename/delete zone or shelf** | Layout changes (must be empty first) |
| **Bulk zone stock** | Mass update qty across a zone |

### 10.3 WH Audit

**Path:** WH Audit  
**Roles:** Warehouse, Admin

Supervisor review of floor activity:

- **Variance tab** — cycle counts flagged as abnormal (>10% or >50 units difference)
- **Scans tab** — scan events where outcome was not OK

Use this to follow up with workers after mobile recounts.

---

## 11. Transfer orders

**Path:** Transfers  
**Roles:** Supervisor, Warehouse, Admin

### 11.1 What is a transfer order?

A **transfer order (TO)** is a structured move: worker **picks** from source bin(s), carries stock, then **drops** at destination bin(s). Every pick and drop updates the stock ledger.

### 11.2 Transfer kinds

| Kind | Created by | Typical flow |
|------|------------|--------------|
| **Replenishment** | MO release or stock rule | Godown → production WH |
| **Putaway** | MO complete or GRN | Production WH / dock → STR or rule bin |
| **Manual** | User | Any warehouse-to-warehouse move |

### 11.3 Transfer status flow

```
ready → [worker claims] → ready (assigned)
     → [pick confirmed]  → in_transit
     → [drop confirmed]  → done

Any non-done → cancel → cancelled
```

### 11.4 Desktop actions

- Filter by kind: All, Putaway, Replenishment, Manual
- Open detail slide-over to see lines, bins, linked MO
- **Cancel** (supervisor/admin) while draft or ready
- Assign worker (admin/supervisor)

### 11.5 Pick and drop rules

- Each line should have a **source bin** (`fromBinId`) before pick.
- If auto-created TO has no source bin, supervisor must assign one (or re-release MO after godown stock is seeded).
- On drop, destination bin may be auto-selected if empty bin exists in destination warehouse.

### 11.6 Putaway rules

**Path:** Settings → Putaway rules (or `/putaway-rules`, admin only)

Define: *When product X arrives, default destination = warehouse Y, bin Z.*

Used by GRN receive hints and MO complete putaway TOs.

---

## 12. Manufacturing

**Path:** Manufacturing, BOMs  
**Roles:** Supervisor, Admin

See also: `docs/manufacturing-multi-step-bom.md`, `docs/soap-manufacturing-process.md`

### 12.1 Concepts

| Term | Meaning |
|------|---------|
| **BOM** | Bill of Materials — recipe (components, scrap, by-products, operations) |
| **MO** | Manufacturing Order — a planned production run |
| **WO** | Work Order — one shop-floor step (operation) on an MO |
| **Release** | Check materials at production WH; create replenishment TOs if short |
| **Issue materials** | Consume components from bins (FIFO lots) |
| **Log output** | Record good/scrap/rework qty mid-run |
| **Complete** | Post finished goods to inventory; close WOs; may create putaway TO |

### 12.2 BOMs

**Path:** Manufacturing → BOMs (or `/manufacturing/boms`)

**Create/edit BOM**

1. Select product (and variant if variant-specific).
2. Add **components** with qty and UoM.
3. Add **operations** (sequence, line, machine, duration, QA flag) for multi-step processes.
4. Set default **facility** and **line**.
5. Set output qty per batch (e.g. 100 L per extract run).

**BOM tools**

- **Tree view** — nested sub-assemblies
- **Explode** — total raw materials for a planned qty
- **Where used** — which parent BOMs use this component

**Pack BOMs** are often auto-generated for retail variants (Rev-Pack revision).

### 12.3 Manufacturing orders

**Create MO**

1. Manufacturing → **New MO** (or Command Palette).
2. Select BOM, planned qty, facility/line, dates.
3. Save → status **planned**.

**Release MO** (planned only)

1. Select MO → **Release**.
2. System checks component stock at **production warehouse**.
3. If short → creates **replenishment TO** (one TO with all shortage lines).
4. If no shortage → MO moves to **in-progress**.

**Issue materials**

1. MO must be in-progress (or release with stock already at line).
2. **Issue materials** — consumes BOM explosion from bins; writes ledger.
3. First issue typically sets MO to **in-progress**.

**Work orders (multi-step)**

For BOMs with operations (oil extract/filter, grain mill/clean):

- Panel shows WOs per operation sequence.
- **Start** → **Log output** → **QA** (if required) → next operation.
- **Split operation** — divide work across parallel lines (e.g. six oil extractors).

**Complete MO**

1. All WOs complete (or single-step MO ready).
2. **Complete** (shortcut **F8**) — posts FG (+ by-products) to facility WH or putaway bin.
3. If putaway rule points to STR → auto **putaway TO** created.

### 12.4 MO status flow

```
planned → in-progress → [qc] → completed
         ↘ delayed (flag)
         ↘ cancelled
```

| Status | Meaning |
|--------|---------|
| planned | Created; not yet released or issued |
| in-progress | Materials issued or production started |
| qc | Optional quality hold |
| completed | FG posted; WOs closed |
| delayed | Schedule flag (non-blocking) |
| cancelled | Voided |

### 12.5 Oil extraction example (three BOMs)

1. **Extract BOM** — seeds → unfiltered semi + press cake  
2. **Filter BOM** — unfiltered semi → bulk filtered oil  
3. **Pack BOM** (auto) — bulk oil → retail variants (500 ml, 1 L, …)

Each stage can be a separate MO linked to the appropriate facility line.

### 12.6 Grain milling example

1. **Mill MO** — raw grain → semi at WH-PROD-MILL  
2. **Transfer** — semi mill → manual cleaning (stock rule or manual TO)  
3. **Clean MO** — semi → bulk FG  
4. **Putaway TO** — bulk → STR for retail packing  

---

## 13. Sales, quotes, and fulfilment

**Roles:** Supervisor, Billing (varies by screen)

### 13.1 CRM — Enquiries

**Path:** Enquiries

**Pipeline view:** Drag cards between stages:

```
new → contacted → qualified → proposal → won / lost
```

**Actions:** Log activities, set follow-up tasks, convert to customer, mark lost (requires reason).

### 13.2 Quotes

**Path:** Quotes

1. **Create quote** → add customer, lines, validity date.
2. **Submit** → formal quote (revision history on edits).
3. **Accept** → creates sales order (or triggers **credit approval** if over limit).
4. **Share** → customer link for print/PDF view.

**Quote statuses:** draft, submitted, accepted, converted, expired, rejected

### 13.3 Sales orders

**Path:** Sales orders

**Create from:** Accepted quote, manual entry, or **ecommerce** (prepaid web order).

**Fulfilment path (mandatory sequence):**

```
Sales order → Pick list → Packing slip → Invoice
```

There is no shortcut to invoice without pick/pack (except ecommerce auto-flow).

**SO statuses:** confirmed, partially_invoiced, invoiced, on_hold, closed, cancelled

### 13.4 Picking

**Path:** Picking  
**Roles:** Supervisor, Warehouse, Billing

1. Create or auto-generate pick list from SO.
2. **Auto-pick** — system allocates bins (may warn on shortfall).
3. Print pick list (`/print/pick-list/:id`) or assign to mobile worker.
4. Complete pick → status **picked** → can create packing slip.

**Pick statuses:** draft, picking, picked, cancelled

### 13.5 Packing

**Path:** Packing

1. Open packing slip from picked SO.
2. Enter **packed qty** per line (may differ from picked — billing uses packed qty).
3. **Multi-container mode** — split lines across boxes/crates with weights.
4. Mark **packed** → ready for invoice.

**Pack statuses:** open, packed, invoiced, cancelled

### 13.6 Customer payments

**Path:** Customers → select customer → **Record payment**

Payments allocate FIFO to open invoices. Advances reduce credit exposure on new quotes.

---

## 14. Billing and POS

**Path:** Billing  
**Roles:** Billing, Admin

### 14.1 POS tab

Walk-in counter sales:

1. Search or scan products.
2. Add to cart; apply customer (optional) for price list.
3. Choose payment: cash, UPI, card, **credit** (requires customer with limit).
4. **Issue invoice** — stock decrements at invoice time.

### 14.2 Invoices tab

- List/filter invoices by status, date, customer.
- Open drawer for detail, payments, share link, dispatch assignment.
- Draw down remaining qty from open sales orders.

**Invoice statuses:** draft, issued, partial, paid, overdue

### 14.3 Keyboard shortcut

**F2** or Command Palette → **New Invoice**

---

## 15. Transport and dispatch

**Path:** Transport  
**Roles:** Supervisor, Warehouse

### 15.1 Trips

A **trip** is one truck + driver + date with multiple **invoice drops**.

**Workflow**

1. Create trip or **auto-schedule** for upcoming days.
2. Add invoices to trip (invoice picker).
3. **Start trip** → in_transit.
4. **Complete trip** when deliveries done.
5. **Cancel/reschedule** — rolls dispatches forward.

**Trip statuses:** scheduled, in_transit, completed, cancelled

Trips link to **Container reports** for manifest and throughput.

---

## 16. Returns and credit notes

**Path:** Returns  
**Roles:** Supervisor, Billing, Warehouse

### 16.1 Workflow

1. **Import** return lines from Excel template (customer, SKU, qty, reason).
2. Manager **approves/rejects** each line.
3. **Finalize** → credit note + payment allocation.

**Return statuses:** pending_approval, processed, cancelled

Mobile: **Returns** screen for field processing where enabled.

---

## 17. Approvals

**Path:** Approvals  
**Roles:** Supervisor, Billing

Central queue for policy gates:

| Type | Example |
|------|---------|
| Credit limit | Quote would exceed customer credit → approve to create SO |
| Stock adjustment | Large variance needs sign-off |
| PO amendment | Change to approved PO |
| Price override | Special pricing |

**Actions:** Approve or Reject (reject requires reason).

Priority shown: low, med, high.

---

## 18. Reports

**Path:** Reports, Container reports

### 18.1 Reports hub

Grouped catalog: Inventory, Production, Procurement, Workforce, Financial.

Live charts on hub:

- Production trend (14 days)
- Procurement spend split
- Sales trend
- Station load

Use **Export** where available on individual report pages.

### 18.2 Container reports

**Path:** Container reports

| Tab | Purpose |
|-----|---------|
| Pack manifest | Containers per packing slip |
| Item history | SKU/barcode → recent containers and trips |
| Trip manifest | All containers on a trip |
| Pack throughput | Daily slips/containers/weight |

---

## 19. Settings and administration

**Path:** Settings  
**Roles:** Admin only

| Section | Configure |
|---------|-----------|
| **Company** | Legal name, GSTIN, address, logo |
| **Warehouses** | Warehouse codes and kinds |
| **Putaway rules** | Product → destination bin |
| **Stock rules** | Auto MO / TO / PO triggers |
| **Production facilities** | Rooms, lines, machines |
| **Dispatch options** | Delivery methods |
| **Packing** | Defaults for packing slips |
| **Container types** | Box/crate definitions |
| **Categories** | Product categories |
| **Users & roles** | Accounts, PIN for mobile |
| **Security** | Password policies |
| **Scanner** | Barcode integration |
| **SMS / Payment** | Notifications, CCAvenue |
| **Sync & backup** | Offline sync, database backup |
| **Appearance / Language** | Branding, locale |

### 19.1 Users and PIN

1. Settings → Users & roles.
2. Create user with username, password, **role**.
3. Set **6-digit PIN** for mobile login.
4. Worker role users use mobile only.

### 19.2 Stock rules (admin)

See [Section 21](#21-automation-stock-rules).

---

## 20. Mobile warehouse app

**URL:** `/m/` (install as PWA on phone)

### 20.1 First login

1. Open mobile URL.
2. Login with PIN or password.
3. **Select warehouse** — device remembers choice (Tasks and scans are scoped to this WH).

### 20.2 Bottom tabs

| Tab | Purpose |
|-----|---------|
| **Tasks** | Pick, pack, transfer work queue |
| **Scan** | Camera barcode → location or product |
| **Count** | Cycle count / bin recount |
| **Verify** | Flagged counts needing review |
| **Profile** | Punch in/out, switch warehouse, sign out |

### 20.3 Tasks hub

**Segments:** Pick · Pack · Move (transfers) · More

- **My tasks** — work you claimed
- **Available** — unclaimed queue (refresh ~30s)

**Claim** a pick list, packing slip, or transfer before starting.

**More shortcuts:** GRN, GRN QC, Bulk zone, Returns

### 20.4 Pick (mobile)

1. Open claimed pick list.
2. Walk path — each line shows bin location.
3. Scan bin or confirm manually.
4. Enter qty picked.
5. Complete pick → may auto-create packing slip.

### 20.5 Pack (mobile)

1. Open packing slip.
2. Confirm packed qty per line.
3. **Multi-container:** assign lines to containers → seal → mark packed.

### 20.6 Transfer (mobile)

Two steps:

1. **Pick** — pull from source bin (must have `fromBin` assigned on line).
2. **Drop** — put away at destination (auto-suggests bin if not preset).

Statuses: ready → in_transit → done

**Error “No source bin assigned”:** Supervisor must assign source bin on desktop (Transfers detail) or re-release MO after godown stock exists.

### 20.7 GRN (mobile)

1. More → GRN → select open PO.
2. Enter received qty, rejects, batch.
3. Allocate to bins (with receive hints from putaway rules).
4. Post → optional QC queue.

### 20.8 GRN QC (mobile)

More → GRN QC → pending receipts → pass / rework / reject.

### 20.9 Count / bin detail

**Scan** or **Count** → scan bin:

- **Recount** — set new qty (variance flagged if large)
- **Reassign** — change product on bin
- **Quick adjust** — small correction

Reason codes: physical_match, damage, found_elsewhere, product_swap, spillage, expired, other.

### 20.10 Bulk zone

Mass-edit bins in a zone: filter zone/shelf, scan-to-row, update barcode and qty.

### 20.11 Profile and attendance

- **Punch in / out / break** — links to Productivity reports.
- **Switch warehouse** if you work across buildings.

---

## 21. Automation: stock rules

**Path:** Settings → Stock rules

Stock rules watch inventory and auto-create documents when stock falls below **minQty**.

### 21.1 Trigger types

| Trigger | Creates | Monitors |
|---------|---------|----------|
| **mo** | Manufacturing order | Bin qty (or effective stock incl. pipeline) |
| **transfer** | Replenishment TO | Monitor bin; pulls from **source bin** |
| **po** | Draft purchase order | Global product stock (no specific bin) |

### 21.2 Key fields

- **minQty** — reorder point (ROP); trigger when effective stock < min  
- **maxQty** — target level; MO/TO qty sized toward max  
- **monitorBin** — bin whose qty is watched (MO/transfer triggers)  
- **sourceBin** — where transfer pulls from (transfer triggers only)  
- **bomId** — which BOM to use for auto MO  

### 21.3 When rules run

- After **GRN**, **PO close**, **MO complete**, **transfer pick/drop**, **inventory adjust**
- **Periodic check** every 6 hours (server setting)
- Manual **Run all checks** (Settings → Stock rules)

### 21.4 Rule sets in this plant

| Tag | Count (typical) | Behaviour |
|-----|-----------------|-----------|
| **tally-jit** | ~126 | Retail variant low in STR → pack MO |
| **grain-milling** | ~61 | Mill/clean staging low → mill or clean MO |
| **raw-procurement** | varies | Global raw low → draft PO |

**Important:** A full rule scan can create **many MOs at once** if many monitor bins are below ROP. Open MOs count toward **effective** stock and prevent duplicate MOs for the same BOM.

### 21.5 Disabling auto MOs (testing)

- Deactivate specific rules in Settings.
- Set env `STOCK_RULES_CHECK_INTERVAL_MS=0` to disable periodic scan (server admin).
- Avoid **Check all stock rules** until staging bins are stocked.

---

## 22. End-to-end scenarios

### 22.1 Buy raw material and put in godown

```
Procurement: Create PO → Approve
GRN: Receive → allocate to WH-STOR bin
Stock visible in Inventory → Locations
```

### 22.2 Make oil (full chain)

```
Manufacturing: Create MO (extract BOM) → Release
  → Replenishment TO: seeds godown → WH-PROD-OIL (mobile pick/drop)
  → Issue materials → Run extract WO → Log output
  → Complete → semi on WH-PROD-OIL
Filter MO → issue semi → filter WO → complete → bulk oil
Pack MO (or tally-jit auto) → fill variants → STR bins
Putaway TO if FG lands on production WH first
```

### 22.3 Sell to shop customer

```
Billing POS: Scan products → Pay → Invoice (stock decrements)
```

### 22.4 Sell to dealer (order fulfilment)

```
Quote → Accept → Sales order
Picking: Auto-pick → mobile pick
Packing: Pack → containers
Billing: Invoice from SO
Transport: Add invoice to trip → dispatch
```

### 22.5 Ecommerce prepaid order

```
Customer pays on web store
  → Confirmed SO + invoice + draft pick list (automated)
Warehouse: Pick → Pack → dispatch
```

### 22.6 Replenish retail shelf (JIT)

```
STR variant bin drops below ROP (tally-jit rule)
  → Auto pack MO OR transfer from bulk bin (if rule configured)
Complete MO → FG to STR
```

---

## 23. Glossary

| Term | Definition |
|------|------------|
| **STR** | Stock Room — finished-goods warehouse |
| **Godown** | Bulk raw storage (Big Godown WH-STOR, New Godown WH-GDNW) |
| **Bin** | Smallest stock location (zone/shelf/bin) |
| **FIFO lot** | Oldest receipt batch consumed first on issue |
| **Effective stock** | On-hand + open PO pipeline + open MO pipeline |
| **Replenishment TO** | Move raw from storage to production WH for an MO |
| **Putaway TO** | Move FG from production WH to STR (or rule destination) |
| **WIP** | Work in progress on facility production warehouse |
| **Semi / Semi-FG** | Intermediate product between process steps |
| **By-product** | Secondary output (e.g. press cake from oil extraction) |
| **ATP** | Available-to-promise — stock check at quote time |
| **ROP** | Reorder point — minQty on stock rules |
| **GRN** | Goods Receipt Note |
| **MO / WO / TO / PO / SO** | Manufacturing / Work / Transfer / Purchase / Sales order |

---

## 24. Tips and troubleshooting

### 24.1 Common issues

| Problem | Likely cause | What to do |
|---------|--------------|------------|
| MO release creates TO but pick fails | No source bin on TO line | Assign bin on Transfers detail, or seed godown stock and re-release |
| Many MOs appeared at once | Stock rules batch scan | Review planned MOs; deactivate rules if testing; cancel unneeded MOs |
| SKU missing in dropdown | List limit or inactive product | Search in Products; use Find SKU on Inventory adjust |
| Pick list shortfall (409) | Insufficient free bin qty | Check reserved qty; complete or cancel other picks |
| Export button does nothing | Browser blocked download | Allow downloads; check console; use CSV export buttons on each page |
| Mobile “No source bin” | TO line missing fromBinId | Supervisor assigns on desktop or fix replenishment config |

### 24.2 Keyboard shortcuts (desktop)

| Shortcut | Action |
|----------|--------|
| Ctrl+K / Ctrl+/ | Command Palette |
| Ctrl+B | Scanner overlay |
| F2 | New invoice (Billing) |
| F8 | Complete MO (Manufacturing) |

### 24.3 Related technical docs

| Document | Topic |
|----------|-------|
| `docs/manufacturing-multi-step-bom.md` | Multi-operation BOMs |
| `docs/soap-manufacturing-process.md` | Soap room process |
| `docs/warehouse-location-barcodes.md` | Barcode labels and scanning |
| `docs/manufacturing-inventory-storage.md` | Storage model detail |

### 24.4 Training progression (recommended)

1. **Week 1 — Stock:** Products, Inventory locations, Warehouse tree, mobile Scan + Count  
2. **Week 2 — Inbound:** Procurement PO → GRN → putaway (desktop + mobile GRN)  
3. **Week 3 — Moves:** Transfers, mobile pick/drop, putaway rules  
4. **Week 4 — Production:** BOMs, MO release/issue/complete, work orders  
5. **Week 5 — Outbound:** Quotes, SO, pick, pack, invoice, trips  
6. **Week 6 — Admin:** Settings, stock rules, users, approvals  

---

*Document maintained for PVS ERP Portal. For deployment and server setup, see `DEPLOYMENT.md` in the repository root.*
