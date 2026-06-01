# NovaERP — High-Performance Manufacturing ERP

A multi-platform, scanner-first ERP for manufacturing, warehouse,
procurement, and billing operations.

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
                                       | REST /v1 (JWT)
                                       |
                       +---------------+------------------+
                       |                                  |
                       v                                  v
              +------------------+              +------------------+
              | React PWA /m/*   |              | Consumer shop    |
              | (warehouse ops)  |              | Ionic/Capacitor  |
              | erp-portal/src/  |              | mobile/          |
              | mobile/          |              |                  |
              +------------------+              +------------------+
                       |
                       v (npm run build:mobile)
              +------------------+
              | Capacitor APK    |
              | mobile-erp/      |
              | (Android device) |
              +------------------+
```

> **Warehouse mobile app is Capacitor-based.**
> The previous Avalonia ERP attempt (`desktop/NovaErp/`) has been archived
> to `archive/NovaErp/` and is no longer maintained. The React PWA served
> at `/m/*` (inside `erp-portal/src/mobile/`) is the canonical warehouse
> mobile client, packaged into an Android APK via Capacitor (`mobile-erp/`).

## Repository layout

| Folder | Purpose |
| --- | --- |
| [`backend/`](backend/) | Node.js + Fastify + Prisma + SQLite (dev) / Postgres (prod) API. |
| [`erp-portal/`](erp-portal/) | React 18 + Vite admin portal **and** warehouse PWA (`/m/*`). |
| [`mobile-erp/`](mobile-erp/) | Capacitor wrapper that packages the PWA into an Android APK. |
| [`mobile/`](mobile/) | Consumer storefront Ionic app (separate product — do not modify). |
| [`archive/NovaErp/`](archive/NovaErp/) | Archived Avalonia ERP (retired — kept for reference only). |
| `trust-blue-pay-DESIGN.md` | Design system spec (Tailwind tokens for web). |

## Quick start

### 1. Backend (Node 20+)

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run db:seed
npm run dev      # http://localhost:4000  (health + /v1)
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

`erp-portal/.env.local` is pre-populated with `VITE_API_URL=http://localhost:4000`.

### 3. Warehouse mobile PWA → Capacitor APK

```bash
# Copy .env.mobile.example → .env.mobile and set VITE_API_URL to your LAN IP.
cp erp-portal/.env.mobile.example erp-portal/.env.mobile
# Edit erp-portal/.env.mobile and set VITE_API_URL=http://<LAN-IP>:4000

# Build PWA and sync into the Capacitor wrapper, then produce debug APK.
cd mobile-erp
npm run build:android

# Or just update www/ without rebuilding the APK:
cd erp-portal
npm run build:mobile
```

The warehouse PWA lives at `/m/*` and includes:
- **Picking** (`/m/picks/:id`, `/m/picks/:id/line/:itemId`)
- **Packing** (`/m/packs/:id`)
- **Transfers / Putaway** (`/m/transfers/:id`)
- **GRN / Receiving** (`/m/grn`, `/m/grn/:poId`)
- **Cycle Count / Bin Recount** (`/m/count`)
- **Customer Returns** (`/m/returns`, `/m/returns/:id`)
- **Scan Lookup** (`/m/scan`, `/m/verify`, `/m/location`, `/m/bin/:id`)
- **Task queue** (`/m/tasks`)

> **Role note:** GRN creation requires the `procurement` role. Contact an
> admin to assign this role to receiving staff, or accept that it will
> return a 403 for `warehouse`-only users.

## Architecture highlights

### Sync engine (server)

Located at `backend/src/sync/engine.ts`. Implements a delta-sync protocol:

* `GET /v1/sync/pull?deviceId=…&since=…&cursor=…` — returns ordered changes since the last pull.
* `POST /v1/sync/push` — accepts batched mutations with conflict detection.

### Trust Blue Pay design system

`erp-portal/tailwind.config.js` extends Tailwind with design tokens
(colors, type scale, shadows, radii) shared across all web surfaces.

## Module status

| Module | Backend | Web portal | Warehouse PWA |
| --- | --- | --- | --- |
| Auth (password + PIN) | ✅ | ✅ live | ✅ live |
| Products / Catalog | ✅ | ✅ live | (read via scan) |
| Warehouse + bins | ✅ | ✅ live | ✅ scan workflow |
| Inventory ledger + transfers | ✅ | ✅ live | ✅ transfers + cycle count |
| Manufacturing (BOM, MO, WO) | ✅ | ✅ live | – |
| Procurement (PO, GRN, vendors) | ✅ | ✅ live | ✅ GRN receive |
| Workforce (workers, attendance) | ✅ | ✅ live | – |
| Billing (POS, invoices) | ✅ | ✅ live | – |
| Dispatch + delivery | ✅ | ✅ live | ✅ picking + packing |
| Returns | ✅ | ✅ live | ✅ decide + finalize |
| Approvals | ✅ | ✅ live | – |
| Reports / Dashboard | ✅ | ✅ live | – |

## Verification

```bash
cd backend && npm run lint
cd erp-portal && npm run build
```
