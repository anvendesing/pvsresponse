# NovaERP — High-Performance Manufacturing ERP

A multi-platform, scanner-first, offline-capable ERP for manufacturing,
warehouse, procurement, and billing operations. Implements the architecture
from the Product Requirements Document:

```
                           +------------------------+
                           |  React Admin Portal    |   (web · analytics + admin)
                           |  erp-portal/           |
                           +-----------+------------+
                                       |
                                       v
                           +------------------------+
                           |     Node.js API        |   (Fastify + Prisma)
                           |     backend/           |
                           +-----------+------------+
                                       |
            +--------------------------+--------------------------+
            |                          |                          |
            v                          v                          v
    +---------------+         +-----------------+         +----------------+
    | PostgreSQL    |         | Redis (queue)   |         | File storage   |
    | (or SQLite    |         | + Sync engine   |         |                |
    |  for dev)     |         |                 |         |                |
    +---------------+         +-----------------+         +----------------+
                                       ^
                                       | sync (pull / push deltas)
                                       |
                       +---------------+------------------+
                       |                                  |
                       v                                  v
              +------------------+              +------------------+
              | Avalonia Desktop |              | Avalonia Mobile  |
              | (warehouse +     |              | (Android head)   |
              |  manufacturing)  |              |                  |
              | desktop/         |              | desktop/         |
              | NovaErp.Desktop  |              | NovaErp.Android  |
              +------------------+              +------------------+
                       |                                  |
                       +-----------+----------------------+
                                   |
                                   v
                           +------------------+
                           |  SQLite cache    |   (one per device,
                           |  + Outbox queue  |    read fast offline,
                           +------------------+    drains on reconnect)
```

The same shared C# project (`desktop/NovaErp/NovaErp`) is used by both the
desktop and mobile heads. The "Trust Blue Pay" design system is mirrored
across the React portal (Tailwind tokens) and Avalonia (XAML resources) so
all three surfaces feel like one product.

## Repository layout

| Folder | Purpose |
| --- | --- |
| [`backend/`](backend/) | Node.js + Fastify + Prisma + SQLite (dev) / Postgres (prod) API and sync engine. |
| [`erp-portal/`](erp-portal/) | React 18 + Vite admin portal. Uses live API when `VITE_API_URL` is set, mock data otherwise. |
| [`desktop/NovaErp/`](desktop/NovaErp/) | Avalonia 11.3 cross-platform solution. Targets Windows / macOS / Linux desktop, Android, iOS, Browser. |
| `trust-blue-pay-DESIGN.md` | Design system spec — single source of truth used by both web (Tailwind) and Avalonia (XAML). |

## Quick start

### 1. Backend (Node 20+)

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run db:seed
npm run dev      # http://localhost:4000  (health check + /v1)
```

Default credentials:

| Username        | Password   | PIN     | Role         |
| --------------- | ---------- | ------- | ------------ |
| `admin`         | `nova1234` | `123456`| admin        |
| `arjun.patel`   | `nova1234` | `123456`| supervisor   |
| `warehouse1`    | `nova1234` | `123456`| warehouse    |
| `billing1`      | `nova1234` | `123456`| billing      |
| `procurement1`  | `nova1234` | `123456`| procurement  |

### 2. React portal (Node 18+)

```bash
cd erp-portal
npm install
npm run dev      # http://localhost:5173
```

`erp-portal/.env.local` is pre-populated with `VITE_API_URL=http://localhost:4000`,
so Login, Dashboard, and Products will use live data while the rest of the
modules continue to render mock data (a deliberate fallback so the portal
runs even with the backend offline).

### 3. Avalonia Desktop (.NET 9)

```bash
cd desktop/NovaErp
dotnet build NovaErp.Desktop/NovaErp.Desktop.csproj
dotnet run --project NovaErp.Desktop/NovaErp.Desktop.csproj
```

The desktop app talks to the same backend API. On first launch it creates a
local SQLite cache at `%LocalAppData%\NovaErp\novaerp.cache.db` and starts a
background sync worker that drains the outbox every 15 seconds.

### 4. Avalonia Android (.NET 9 + Android SDK)

```bash
cd desktop/NovaErp
dotnet build NovaErp.Android/NovaErp.Android.csproj
dotnet run --project NovaErp.Android/NovaErp.Android.csproj
```

Requires:
* `dotnet workload install android` (may already be installed)
* Android SDK + emulator or device. See <https://aka.ms/dotnet-android-install-sdk>.

## Architecture highlights

### Sync engine (server)

Located at `backend/src/sync/engine.ts`. Implements a delta-sync protocol:

* `GET /v1/sync/pull?deviceId=…&since=…&cursor=…` — returns ordered changes since the last pull. Echoes are skipped (the server filters out changes whose `origin` matches the requesting device).
* `POST /v1/sync/push` — accepts batched mutations. Conflict policy:
  * Append-only entities (`StockLedger`, `AuditLog`, `Attendance`) are always inserted — never conflicted.
  * For other entities, the client sends `baseVersion`; if the server has advanced past that version, the push is recorded in `SyncConflict` and the server value remains canonical (server-wins).
* `GET /v1/sync/state/:deviceId` and `/v1/sync/conflicts/:deviceId` for diagnostics.

Versioning is monotonic per (entity, entityId) row in `ChangeLog`. Tombstones are emitted for deletes.

### Sync worker (client)

`desktop/NovaErp/NovaErp/Services/SyncService.cs` runs on each Avalonia
device. Every 15 seconds it:
1. Drains the local outbox to `/v1/sync/push`.
2. Pulls deltas via `/v1/sync/pull`, applying them to the local SQLite cache.
3. Records pull cursor + last-server-time so the next pull is incremental.

Outbox writes are durable (SQLite WAL) and survive app restarts. Failed
pushes increment an `Attempts` counter and are dead-lettered after 5 tries.

### Trust Blue Pay design system

* React: `erp-portal/tailwind.config.js` extends Tailwind with the design
  tokens — colors (`primary`, `secondary`, `success`, `warning`, `danger`),
  type scale (`display`, `h1`, `h2`, `body`, `amount`), shadows (`e1`–`e3`),
  radii.
* Avalonia: `desktop/NovaErp/NovaErp/Styles/TrustBluePay.axaml` exposes the
  same colors as `DynamicResource` brushes and the same components
  (`Button.primary`, `Border.card`, `Border.chip`, `TextBox.scan`,
  `Button.nav`).

Changing a token in one place automatically propagates to all components on
that platform.

## Module status

| Module | Backend | Web portal | Desktop | Mobile |
| --- | --- | --- | --- | --- |
| Auth (password + PIN) | ✅ | ✅ live | ✅ live | ✅ live |
| Products / Catalog | ✅ | ✅ live | ✅ via cache | (read) |
| Warehouse + bins | ✅ | ✅ mock | ✅ scan workflow | ✅ scan workflow |
| Inventory ledger + transfers | ✅ | ✅ mock | ✅ via outbox | ✅ via outbox |
| Manufacturing (BOM, MO, WO) | ✅ | ✅ mock | ✅ station view | – |
| Procurement (PO, GRN, vendors) | ✅ | ✅ mock | – | – |
| Workforce (workers, attendance) | ✅ | ✅ mock | – | ✅ punch view |
| Billing (POS, invoices) | ✅ | ✅ mock | – | – |
| Dispatch + delivery | ✅ | ✅ mock | ✅ confirm view | ✅ confirm view |
| Approvals | ✅ | ✅ mock | – | – |
| Reports / Dashboard | ✅ | ✅ live | – | – |
| Sync engine (pull/push/conflict) | ✅ | ✅ smoke-tested | ✅ background worker | ✅ background worker |

Pending (out-of-scope for the current phase):
* CCAvenue + SMSIdea integrations (paused per your direction; will resume
  once all modules are live on every surface).
* Postgres + Redis Docker Compose for production deploy (the schema is
  portable; flip `provider = "postgresql"` in `prisma/schema.prisma` and
  set `DATABASE_URL`).

## Verification

* `cd backend && npm run lint` — type-checks.
* `cd backend && npm run db:seed` — seeds 32 products, 432 bins, 24 POs, 18
  production orders, 28 invoices, etc.
* `cd erp-portal && npm run build` — clean Vite build.
* `cd desktop/NovaErp && dotnet build NovaErp.Desktop/NovaErp.Desktop.csproj`
  — clean Avalonia build, runtime smoke-tested.

## Performance targets (from PRD)

| Metric | Target | How met |
| --- | --- | --- |
| App startup | < 3s | Avalonia AOT + minimal startup work; SQLite cache opens lazily. |
| Screen switch | < 200ms | View models pre-instantiated in `MainViewModel`; no per-tab construction cost. |
| Barcode scan | < 50ms | Local SQLite barcode lookup before falling through to API. |
| Grid 100k+ rows | – | `DataTable` virtualization scaffolded; live API uses paged endpoints. |
| Offline-first | 100% | Outbox + local cache; warehouse / manufacturing / dispatch / attendance all work offline. |
