# NovaERP — High-Performance Manufacturing ERP (Web Portal)

A keyboard-first, scanner-first manufacturing ERP web portal built with React + TypeScript + Tailwind, applying the **Trust Blue Pay** design system. This is the React management portal slice of the multi-platform PRD (the full vision also includes Avalonia desktop + mobile and a Node.js backend).

## What's included

The application demonstrates every core module specified in the PRD:

| Module | Highlights |
|---|---|
| **Shell** | Top command bar, collapsible left navigation, multi-tab workspace with detach/close, bottom status bar with sync, queue, latency, scanner, branch |
| **Login** | Username/password + 6-digit PIN keypad + biometric/badge stubs |
| **Dashboard** | KPI strip, sales trend (area), procurement pie, production bar chart, station load, live activity, pending approvals |
| **Products** | Filterable grid with master/detail side panel, lifecycle, attributes, batch tracking |
| **Inventory** | Live ledger with txn types (GRN/Sale/Issue/Production/Transfer/Adjust), valuation grid, batch tracker with FEFO |
| **Warehouse** | Bin-tree split view (Warehouse → Zone → Rack → Shelf → Bin), color-coded occupancy, **Fast Transfer** (Scan → Source → Destination → Qty → F8) |
| **Manufacturing** | 3-pane production console: orders list, current MO + work order stages + BOM consumption, workers + machine status |
| **Procurement** | PO grid with progress bars, vendor master with rating/lead time/spend, GRN queue, QC results |
| **Productivity** | Worker grid with efficiency bars, shift filters, line output chart, attendance heatmap |
| **Billing / POS** | Barcode scan-to-cart, qty stepper, payment methods (UPI/Card/Cash/Split), invoice list with status |
| **Transport** | Dispatch queue, multi-step delivery flow, OTP/signature/photo proof, vehicle health |
| **Reports** | Grouped report library, sales/spend/production charts, drilldown grid |
| **Approvals** | Master/detail with approval chain, attachments, F8 to approve |
| **Settings** | Company, users & roles, security, scanner, **SMSIdea**, **CCAvenue**, sync/offline, backups, notifications, appearance, mobile, language |

## Keyboard / scanner UX

- `Ctrl + K` — Command palette (search products, vendors, invoices, workers, MOs; jump to any screen; quick actions)
- `Ctrl + B` — Open scanner overlay with live product matching
- `Esc` — Close any overlay
- Inline search bars, sortable headers, keyboard-driven row interactions throughout

## Trust Blue Pay design system

Tokens are configured in `tailwind.config.js`:

- Colors: `primary` (#003087), `secondary` (#009CDE), `success` (#019C34), `warning` (#F5BA2E), `danger` (#D20000), `canvas` (#F5F7FA), `surface` (#FFFFFF), `ink` (#1A1A2E), `border` (#CBD2D6)
- Typography: Inter (display/body) + JetBrains Mono (code/SKUs/IDs); financial values use tabular nums (`.tnum`)
- Elevation: e1 / e2 / e3 navy-tinted shadows
- Radius: 4 / 8 / 12 / 16 / 9999
- Components built per spec: `Button`, `Input`, `Card` (with status accent borders), `Chip`, `DataTable`, `Kpi`, `Toolbar`

## Stack

- **React 18 + TypeScript** with Vite
- **Tailwind CSS 3** for styling (Trust Blue Pay tokens)
- **react-router-dom 6** for routing
- **recharts** for analytics
- **lucide-react** for icons
- All data is **mocked** in `src/data/mockData.ts` for offline demoability

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle in dist/
```

## Project structure

```
src/
  App.tsx                  # Routes
  main.tsx                 # Entry
  components/
    common/                # Button, Card, Chip, DataTable, Input, Kpi, Toolbar
    shell/                 # TopCommandBar, LeftNavigation, WorkspaceTabs,
                           # BottomStatusBar, CommandPalette, ScannerOverlay, Shell
  pages/                   # Dashboard, Products, Inventory, Warehouse,
                           # Manufacturing, Procurement, Productivity, Billing,
                           # Transport, Reports, Approvals, Settings, Login
  data/
    mockData.ts            # Seeded demo data (products, vendors, MOs, workers, etc.)
    types.ts
  hooks/
    useHotkey.ts
    useWorkspace.tsx       # Multi-tab workspace context
  lib/
    cn.ts
    format.ts              # INR, number, date helpers (en-IN)
  styles/
    globals.css
```

## Next steps (out of scope for this build)

- **Avalonia Desktop / Mobile**: same tokens applied to a `.NET` app for warehouse/floor stations
- **Node.js API + PostgreSQL + Redis** wired in place of mock data
- **SQLite local cache + sync engine** with conflict resolution and delta sync
- **CCAvenue** payment integration and **SMSIdea** SMS event hooks
- **Auto-update** for desktop, **Android-first** mobile rollout
