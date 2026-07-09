# VPS deploy — July 2026 (storefront UX, migrations, images)

Run these commands **on the VPS** after code is pushed to GitHub from your dev machine.

---

## Before you SSH (on Windows — one time)

Uncommitted work will **not** appear on the VPS. From `D:\coding\pvsresponse`:

```powershell
cd D:\coding\pvsresponse
git add backend/ erp-portal/ pvsecommerce/ docs/ scripts/
git status
git commit -m "Deploy: storefront UX, infinite scroll, migrations, ERP updates"
git push origin main
```

Do **not** commit `BackgroundRemoved/`, `backend/images-by-barcode/`, xlsx exports, or
`backend/uploads/` (images sync separately below).

---

## On the VPS — full deploy (copy/paste)

SSH in, then:

```bash
cd ~/pvsresponse    # or ~/novaerp — use your actual repo path
git pull --ff-only origin main

# Rebuild all containers (backend runs prisma migrate deploy on boot)
bash scripts/vps-deploy.sh --build
```

That script automatically runs, in order:

1. `docker compose up -d --build`
2. Wait for backend healthy
3. `npm run db:seed-godowns`
4. `npm run ops:post-migrate-config:dist` (production lines, vacuum, oil, lot backfill)
5. Category/concern xlsx imports (if bundled in image)
6. `npm run db:sync-stock`

**Do not use `--reset-data`** unless you intend to wipe the DB.

---

## Verify Prisma migrations applied

```bash
cd ~/pvsresponse
docker compose exec backend npx prisma migrate status
```

Expected migrations (all should show **Applied**):

| Migration | What it adds |
|-----------|----------------|
| `20260630000000_init` | Base Postgres schema |
| `20260630120000_document_round_off` | Invoice round-off |
| `20260630130000_transport_gst_setting` | Transport GST setting |
| `20260630140000_sms_dlt_templates` | DLT SMS templates |
| `20260701000000_product_search_aliases` | Product search aliases |
| `20260701120000_document_series` | Document numbering series |
| `20260701120000_packing_slip_shiprocket_ids` | Shiprocket IDs on packing slips |
| `20260701130000_shiprocket_pickup_location` | Shiprocket pickup location |
| `20260703110000_mo_urgent_qty` | MO urgent quantity flag |
| `20260703120000_production_output_batch` | Production output batch tracking |

If any show **Pending**, check backend logs:

```bash
docker compose logs backend --tail 100
```

Fix and re-run:

```bash
docker compose exec backend npx prisma migrate deploy
docker compose restart backend
```

---

## Post-migrate only (if full deploy already ran but config step failed)

```bash
cd ~/pvsresponse
docker compose exec backend npm run ops:post-migrate-config:dist
docker compose exec backend npm run db:sync-stock
```

Skip lot backfill if VPS has no legacy bin stock without lots:

```bash
docker compose exec backend npm run ops:post-migrate-config:dist -- --skip-lots
```

---

## Product images (192 uploads from local)

Images are **not** in git. Choose **one** method:

### Option A — Bulk upload from Windows to live API (recommended)

Backend on VPS must be up after deploy. On **Windows**:

```powershell
cd D:\coding\pvsresponse\backend
npx tsx scripts/bulk-upload-images-by-barcode.ts --apply `
  --dir "D:\coding\pvsresponse\backend\images-by-barcode" `
  --api "http://217.216.78.119:4000/v1" `
  --user admin --pass YOUR_PASSWORD
```

Replace IP/URL with your production API if Caddy serves HTTPS on a domain.

### Option B — Copy uploads folder from Windows to VPS

On **Windows**:

```powershell
cd D:\coding\pvsresponse
.\scripts\upload-images-to-vps.ps1 -VpsHost 217.216.78.119 -VpsUser root
```

On **VPS** (backfill only needed for old flat `.jpg` files):

```bash
docker compose exec backend node dist/scripts/backfill-image-variants.js
```

### Verify images on VPS

```bash
docker compose exec backend npx tsx scripts/export-products-without-images.ts
# or after rebuild:
docker compose exec backend node dist/scripts/export-products-without-images.js
```

---

## Optional data scripts (run on VPS if needed)

Only if you use these features locally and need the same on prod:

```bash
# Search aliases (if not already imported via migration + seed)
docker compose exec backend npm run db:import-product-aliases

# Zero-GST barcode patch (if you use scripts/patch-zero-gst-barcodes.sql)
# Apply via psql or the apply-zero-gst-patch script from Windows
```

---

## Health checks after deploy

```bash
curl -sf http://localhost/health && echo " ERP OK"
curl -sf http://localhost:8080/ && echo " Shop OK"
docker compose ps
```

In browser:

| Service | URL |
|---------|-----|
| ERP portal | `http://YOUR_VPS_IP/` |
| Storefront | `http://YOUR_VPS_IP:8080/` |
| API | `http://YOUR_VPS_IP:4000/v1/health` (if port exposed) |

Storefront smoke test:

- Home → best sellers, infinite scroll category pages
- Search (`/search?q=oil`)
- Product detail, cart, checkout trust copy
- Policy pages: `/policies/shipping`, `/returns`, `/privacy`

---

## Rollback

```bash
cd ~/pvsresponse
git log --oneline -5
git checkout <previous-commit>
bash scripts/vps-deploy.sh --build
```

DB migrations are **not** auto-reverted — restore from backup if a migration breaks prod.

---

## Quick reference (minimal)

```bash
cd ~/pvsresponse && git pull --ff-only && bash scripts/vps-deploy.sh --build
docker compose exec backend npx prisma migrate status
curl -sf http://localhost/health && curl -sf http://localhost:8080/
```

Images: run bulk upload from Windows against prod API (see Option A above).
