# NovaERP Backend

Node.js + Fastify + Prisma + Zod backed by **PostgreSQL** (production and local dev).

See [`../LOCAL_DEV.md`](../LOCAL_DEV.md) for the full local setup guide, including
how to install Postgres on Windows without Docker.

## Quick start (local)

```bash
# 1. Start local Postgres (see LOCAL_DEV.md §1-2 to install)
# 2. Copy environment
cp .env.example .env          # already points to localhost:5432/novaerp

# 3. Install, migrate, seed, run
npm install
npx prisma migrate dev
npm run db:seed
npm run dev          # http://localhost:4000
```

## Endpoints

All endpoints are under `/v1`. Authentication is JWT (`Authorization: Bearer …`).

### Auth
* `POST /v1/auth/login`  body `{ username, password }`
* `POST /v1/auth/pin`    body `{ username, pin }` (6 digits)
* `GET  /v1/auth/me`

### Catalog (master data)
* `GET    /v1/products?q=&type=&limit=`
* `GET    /v1/products/:id`
* `GET    /v1/products/by-sku/:sku`
* `GET    /v1/products/by-barcode/:code`
* `POST   /v1/products`
* `PATCH  /v1/products/:id`
* `GET    /v1/warehouses`
* `GET    /v1/warehouses/:id/bins`
* `GET    /v1/vendors`
* `GET    /v1/customers`

### Inventory
* `GET    /v1/ledger?productId=&warehouseId=&txnType=&limit=`
* `GET    /v1/valuation`
* `POST   /v1/inventory/transfer`
* `POST   /v1/inventory/adjust`

### Manufacturing
* `GET    /v1/boms`
* `GET    /v1/production-orders?status=`
* `GET    /v1/production-orders/:id`
* `POST   /v1/production-orders`
* `PATCH  /v1/work-orders/:id`

### Procurement
* `GET    /v1/purchase-orders?status=`
* `POST   /v1/purchase-orders`
* `POST   /v1/purchase-orders/:id/approve`
* `GET    /v1/grns`
* `POST   /v1/grns`

### Workforce
* `GET    /v1/workers?shift=`
* `POST   /v1/workers/punch`

### Billing & Dispatch
* `GET    /v1/invoices?status=&limit=`
* `POST   /v1/invoices`
* `GET    /v1/dispatches`
* `POST   /v1/dispatches/:id/confirm`

### Approvals
* `GET    /v1/approvals?status=`
* `POST   /v1/approvals/:id/decide`  body `{ decision: "approved" | "rejected" }`

### Reports
* `GET    /v1/reports/dashboard`         — summary KPIs.
* `GET    /v1/reports/production-trend`  — last-14-day production rollup.
* `GET    /v1/reports/procurement-split` — vendor / category split.

### Sync
* `GET    /v1/sync/info`
* `GET    /v1/sync/pull?deviceId=&since=&cursor=&limit=`
* `POST   /v1/sync/push`           body `{ deviceId, mutations: [...] }`
* `GET    /v1/sync/state/:deviceId`
* `GET    /v1/sync/conflicts/:deviceId`

## Local database

`DATABASE_URL` defaults to `postgresql://novaerp:novaerp@localhost:5432/novaerp?schema=public`.

To reset and re-seed:

```bash
npx prisma migrate reset
```
