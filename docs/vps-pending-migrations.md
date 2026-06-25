# VPS pending migrations & configuration

Living checklist for deploying recent schema and site-configuration changes to
production (VPS). Update this file whenever you add a Prisma migration or a
post-migrate ops script.

**Last updated:** 2026-06-15

---

## How migrations run on VPS

The backend container entrypoint runs **`prisma migrate deploy`** on every start
(`backend/docker-entrypoint.sh`). You do **not** need to run SQL manually unless
a deploy failed mid-migration.

After the stack is healthy, run **post-migrate configuration** (data fixes and
facility layout — not handled by Prisma):

```bash
cd ~/pvsresponse   # or ~/novaerp
bash scripts/vps-deploy.sh --build          # full deploy (includes post-migrate)
# — or step by step —
docker compose exec backend npm run ops:post-migrate-config:dist
```

Skip lot backfill if the VPS DB has no pre-existing bin stock without lots:

```bash
docker compose exec backend npm run ops:post-migrate-config:dist -- --skip-lots
```

---

## Pending Prisma migrations

Mark each row **done** on VPS after confirming `_prisma_migrations` contains the
migration (or after a successful deploy).

| Status | Migration | What it adds |
|--------|-----------|--------------|
| ☐ | `20260615120000_production_lines_packing_containers` | Production lines, packing containers |
| ☐ | `20260615180000_add_stock_lots` | `StockLot`, GRN batch fields, ledger `batch`/`lotId` |
| ☐ | `20260615190000_facility_production_zone` | `ProductionFacility.productionZone` (in-situ STR vacuum) |
| ☐ | `20260623100000_facility_replenish_sources` | `ProductionFacility.replenishWarehouseCodes` (oil godowns) |
| ☐ | `20260624100000_bom_operations` | Multi-step BOM operations (Odoo routing) |
| ☐ | `20260621140000_product_channel_visibility` | Product channel visibility flags |

Verify applied migrations:

```bash
docker compose exec backend npx prisma migrate status
```

---

## Post-migrate scripts (run order)

These are **idempotent**. `vps-deploy.sh` runs them automatically as Step 5c unless
you pass `--no-post-migrate`.

| Step | npm (container) | Purpose |
|------|-----------------|---------|
| 1 | `ops:post-migrate-config:dist` | Runs steps 2–5 below |
| 2 | → `02-production-lines` | Facilities/lines from `site-layout.ts` |
| 3 | → `05-configure-vacuum-stock-room` | WC-VACUUM → STR zone A; deactivate `WH-PROD-VACUUM` |
| 4 | → `06-configure-oil-extraction` | WC-OIL 10 lines; deactivate `WC-FILTER` / `WH-PROD-FILTER` |
| 5 | → `07-backfill-lots-from-bins` | Legacy bin qty → `StockLot` (FIFO); skip with `--skip-lots` |

**Also run on deploy** (already in `vps-deploy.sh`):

| Step | Script | Purpose |
|------|--------|---------|
| 5b | `db:seed-godowns` | Godown shelf bin layout |
| 6 | `db:sync-stock` | Reconcile product stock counters from bins |

**Run manually when needed:**

| Script | When |
|--------|------|
| `ops:site-setup:dist` | First-time VPS or full warehouse + line re-seed |
| `ops:warehouse-layout:dist` | Farm shop / stock room / godown prune + re-seed |
| `ops:putaway-fg:dist` | FG putaway rules for new variants |
| `db:backfill-raw-kg-products` | Raw kg companion products for godown scanning |

---

## Verification checklist

After deploy, confirm in **Settings → Production lines**:

- [ ] **WC-VACUUM** — production warehouse = `STR`, zone **A**, replenish includes cold stores
- [ ] **WC-OIL** — **10 active lines** (6 extract, 3 filter, 1 fill), replenish = `WH-GDNW,WH-STOR,WH-PROD-OIL`
- [ ] **WC-FILTER** — inactive (merged into WC-OIL)
- [ ] Warehouses **WH-PROD-VACUUM**, **WH-PROD-FILTER** — inactive if unused

Inventory / manufacturing:

- [ ] **Inventory → Batches** tab loads (`GET /v1/inventory/lots`)
- [ ] GRN receipt accepts batch number per line
- [ ] MO **Issue materials** consumes oldest lot first (FIFO)

Quick SQL sanity (optional):

```bash
docker compose exec backend npx prisma studio
```

---

## Deploy commands (quick reference)

```bash
# Full update (git pull, rebuild, migrate on boot, godowns, post-migrate, sync)
bash scripts/vps-deploy.sh --build

# Skip post-migrate (e.g. already applied)
bash scripts/vps-deploy.sh --build --no-post-migrate

# Post-migrate only
bash scripts/vps-update.sh post-migrate

# Site setup (warehouses + lines + putaway) — heavier than post-migrate alone
bash scripts/vps-update.sh site-setup
```

---

## Changelog

| Date | Change |
|------|--------|
| 2026-06-15 | Stock lots + FIFO MO issue; GRN batch capture |
| 2026-06-15 | WC-VACUUM runs in STR zone A (`productionZone`) |
| 2026-06-23 | Oil extraction: 10 lines, replenish from godowns + local WH |
| 2026-06-24 | Multi-step BOM operations + WO QA rollback (Odoo MRP reference) |

See [`manufacturing-multi-step-bom.md`](manufacturing-multi-step-bom.md).

---

## Local dev equivalents

| VPS | Local |
| `prisma migrate deploy` | `prisma db push` or `prisma migrate dev` |
| `ops:post-migrate-config:dist` | `npm run ops:post-migrate-config` |
| `db:seed-godowns` | `npm run db:seed-godowns:dev` |
