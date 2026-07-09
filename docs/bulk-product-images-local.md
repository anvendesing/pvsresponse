# Bulk product images — local upload & VPS migration

Runbook for updating storefront product photos in bulk using the barcode upload
script (`backend/scripts/bulk-upload-images-by-barcode.ts`). This replaces the
older Excel/name-matching flow (`scripts/import-product-images.py`).

**Typical source folder:** cropped/background-removed photos such as
`BackgroundRemoved/Cropped/` at the repo root (local prep only — not wired into
git).

---

## Overview

```
  [Your photos]          [Rename by barcode]       [Dry-run match]        [Apply upload]
  BackgroundRemoved  →   backend/images-by-barcode  →  --dry-run      →   --apply
  / Cropped / etc.       8901234567890.jpg            checks DB           API + Sharp
                                                                              ↓
                                                         backend/uploads/products/{id}/
                                                         thumb.webp, medium.webp, large.webp, …
                                                                              ↓
  [Later — VPS]          Option A: same script with --api https://…:4000/v1
                         Option B: tar uploads/ + backfill on server
                         Then: prisma pending migrations (separate checklist)
```

Each successful upload:

- Saves responsive variants via Sharp (`thumb`, `medium`, `large`, WebP + JPEG)
- Sets `Product.imageUrl` to `/uploads/products/{productId}`
- Copies the same photo to **every variant** under that product

Matching is by **filename stem = barcode** (`Product.barcode` or
`ProductVariant.barcode`). No CSV is required.

---

## Prerequisites (local)

> **Important:** There is no `package.json` at the repo root (`D:\coding\pvsresponse`).
> All commands below run from **`backend/`** unless noted otherwise.

| Requirement | Notes |
|-------------|--------|
| PostgreSQL | Same DB the backend uses (`DATABASE_URL` in `backend/.env`) |
| Backend API | `npm run dev` from **`backend/`** → `http://localhost:4000` |
| Admin login | Default user `admin` (password from your local `.env` / seed) |
| Node deps | `cd backend && npm install` (includes `tsx`, `sharp`, Prisma) |

One-time install:

```powershell
cd d:\coding\pvsresponse\backend
npm install
```

Quick health check (terminal 1 — leave running):

```powershell
cd d:\coding\pvsresponse\backend
npm run dev
```

Terminal 2:

```powershell
Invoke-WebRequest http://127.0.0.1:4000/health -UseBasicParsing
```

Storefront (optional, to visually verify): `cd pvsecommerce && npm run dev` →
http://localhost:5174/

---

## Step 1 — Prepare the image folder

### Folder layout

Create a staging folder (default expected by the script):

```
backend/images-by-barcode/
  8901234567890.jpg
  8901234567891.png
  8901234567892.webp
  ...
```

Or use any folder and pass `--dir` (see commands below).

**Supported extensions:** `.jpg`, `.jpeg`, `.png`, `.webp`

**Naming rule:** `{barcode}.{ext}` — the stem must match a barcode in the ERP
database exactly (case-insensitive).

### From `BackgroundRemoved/Cropped/`

Those files are usually named after the camera/WhatsApp original (e.g.
`_MG_7630.jpg`, `WhatsApp Image ….jpg`). They must be **renamed to barcode**
before upload.

1. Look up each product’s barcode in **ERP → Products** (product or variant row).
2. Rename each file to `{barcode}.jpg` (or `.png`).
3. Copy renamed files into `backend/images-by-barcode/`.

Optional — list products with barcodes from the local DB:

```powershell
cd d:\coding\pvsresponse\backend
npx tsx -e "
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const rows = await db.product.findMany({
  select: { sku: true, name: true, barcode: true, variants: { select: { size: true, barcode: true } } },
  orderBy: { sku: 'asc' },
});
for (const p of rows) {
  console.log([p.sku, p.barcode ?? '-', p.name].join('\t'));
  for (const v of p.variants) if (v.barcode) console.log(['  variant', v.size, v.barcode].join('\t'));
}
await db.\$disconnect();
"
```

### Find products still missing images

Before and after upload:

```powershell
cd d:\coding\pvsresponse\backend
npx tsx scripts/export-products-without-images.ts
```

Output: `backend/output/products-without-images.csv`  
Columns: `sku, name, category, type, state, imageUrl, reason`

---

## Step 2 — Dry-run (match only, no upload)

Always dry-run first. Default mode is dry-run (no `--apply`).

```powershell
cd d:\coding\pvsresponse\backend

# Default folder: ./images-by-barcode
npx tsx scripts/bulk-upload-images-by-barcode.ts --dry-run

# Or point at your cropped folder directly:
npx tsx scripts/bulk-upload-images-by-barcode.ts --dry-run `
  --dir "d:\coding\pvsresponse\BackgroundRemoved\Cropped"
```

Expected output per file:

- `✓ MATCH` — barcode found; shows SKU, product name, variant count
- `✗ NOT FOUND` — no product/variant with that barcode (fix rename or DB)

Fix all `NOT FOUND` rows before applying.

---

## Step 3 — Apply upload (local)

Backend must be running on port 4000.

```powershell
cd d:\coding\pvsresponse\backend

npx tsx scripts/bulk-upload-images-by-barcode.ts --apply `
  --dir "d:\coding\pvsresponse\backend\images-by-barcode" `
  --user admin
```

You will be prompted for the admin password unless you pass `--pass`.

**CLI options**

| Flag | Default | Purpose |
|------|---------|---------|
| `--dry-run` | yes (unless `--apply`) | Match only |
| `--apply` | — | Upload via API |
| `--dir` | `./images-by-barcode` | Folder of barcode-named images |
| `--api` | `http://localhost:4000/v1` | Backend base URL |
| `--user` | `admin` | Login username |
| `--pass` | prompt | Login password (use this to avoid an interactive prompt) |

On disk after upload, each product gets a directory like:

```
backend/uploads/products/{product-uuid}/
  original.jpg
  thumb.webp / thumb.jpg
  medium.webp / medium.jpg
  large.webp / large.jpg
```

---

## Step 4 — Verify locally

1. **Re-run gap report**

   ```powershell
   npx tsx scripts/export-products-without-images.ts
   ```

   `Without image` count should drop.

2. **Spot-check in ERP** — Products → open a few updated SKUs → image preview.

3. **Spot-check storefront** — http://localhost:5174/ → category / product pages.
   Images use responsive WebP with `?v=` cache bust from `updatedAt`.

4. **Count upload folders** (modern API uploads create one directory per product):

   ```powershell
   (Get-ChildItem d:\coding\pvsresponse\backend\uploads\products -Directory).Count
   ```

5. **Direct file URL** (replace `{id}` with product UUID):

   ```
   http://localhost:4000/uploads/products/{id}/medium.webp
   ```

---

## Legacy flat files (optional)

If you still have old flat files like `backend/uploads/products/I97.jpg` from
the Excel-era import, run the backfill to generate responsive variants:

```powershell
cd d:\coding\pvsresponse\backend
npx tsx scripts/backfill-image-variants.ts --dry-run
npx tsx scripts/backfill-image-variants.ts
# or: npm run db:backfill-images
```

Skip this if you only use `--apply` barcode upload (API already runs Sharp).

---

## Step 5 — Migrate to VPS (after local is good)

Image migration and **schema migrations are separate**. Apply Prisma migrations
first (see [vps-pending-migrations.md](./vps-pending-migrations.md)), then push
images.

### 5a. Deploy pending schema migrations (VPS)

On the server:

```bash
cd ~/pvsresponse   # or ~/novaerp
bash scripts/vps-deploy.sh --build
# verify:
docker compose exec backend npx prisma migrate status
```

Checklist: [docs/vps-pending-migrations.md](./vps-pending-migrations.md)

### 5b. Upload images to VPS — **Option A (recommended)**

Run the same bulk script against production API (no manual file copy):

```powershell
cd d:\coding\pvsresponse\backend

npx tsx scripts/bulk-upload-images-by-barcode.ts --apply `
  --dir "d:\coding\pvsresponse\backend\images-by-barcode" `
  --api "http://217.216.78.119:4000/v1" `
  --user admin
```

Use HTTPS/production URL if Caddy terminates TLS on the VPS.

Then on VPS, confirm gaps:

```bash
docker compose exec backend npx tsx scripts/export-products-without-images.ts
```

### 5c. Upload images to VPS — **Option B (tar entire uploads folder)**

If you already uploaded locally and want to sync the whole `uploads/products`
tree:

```powershell
cd d:\coding\pvsresponse
.\scripts\upload-images-to-vps.ps1 -VpsHost 217.216.78.119 -VpsUser root
# optional: -SshKey "C:\Users\Sharath\.ssh\your_key"
# optional: -LocalDir "d:\coding\pvsresponse\backend\uploads\products"
```

On VPS, backfill any flat legacy files:

```bash
docker compose exec backend node dist/scripts/backfill-image-variants.js
```

See also [DEPLOYMENT.md](../DEPLOYMENT.md) — Step 7.6 and Step 11.

### 5d. Post-migrate VPS ops (not image-specific)

After schema deploy, run post-migrate config if not already done:

```bash
docker compose exec backend npm run ops:post-migrate-config:dist
docker compose exec backend npm run db:sync-stock
```

---

## Quick command reference

Use **single lines** in PowerShell (avoid `` ` `` line breaks — they break if npx prompts for input).

```powershell
# ── ALWAYS START HERE ──
cd d:\coding\pvsresponse\backend

# ── LOCAL PREP ──
mkdir images-by-barcode -Force
# copy/rename {barcode}.jpg files into images-by-barcode\

# ── AUDIT GAPS ──
npx tsx scripts/export-products-without-images.ts

# ── DRY-RUN ──
npx tsx scripts/bulk-upload-images-by-barcode.ts --dry-run --dir "d:\coding\pvsresponse\backend\images-by-barcode"

# ── UPLOAD LOCAL (terminal 2; terminal 1 must have: npm run dev) ──
npx tsx scripts/bulk-upload-images-by-barcode.ts --apply --dir "d:\coding\pvsresponse\backend\images-by-barcode" --user admin --pass YOUR_PASSWORD

# ── UPLOAD VPS (direct to prod API) ──
npx tsx scripts/bulk-upload-images-by-barcode.ts --apply --dir "d:\coding\pvsresponse\backend\images-by-barcode" --api "http://217.216.78.119:4000/v1" --user admin
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Stops after `Found N image file(s)` with no upload lines | Waiting for **admin password** (prompt was easy to miss) | Type password + Enter, or pass `--pass YOUR_PASSWORD` |
| `EPERM … query_engine-windows.dll.node` on `npm run dev` | **Another backend is already running** and holds the Prisma DLL locked | Skip `npm run dev` if port 4000 is up, or stop the old process first (see below) |
| `NOT FOUND` for many files | Wrong barcode in filename | Cross-check ERP product/variant barcode |
| `Login failed` | Wrong credentials / API down | Check `--api`, admin password, `/health` |
| `Product upload failed (401)` | Token expired mid-run | Re-run `--apply` (idempotent overwrite) |
| Upload OK but storefront blank | Wrong `PUBLIC_API_BASE` or CORS | Check storefront env points to same backend |
| Old single `.jpg` URL, no WebP | Legacy flat file | Run `backfill-image-variants.ts` |
| VPS images missing after deploy | Uploads in Docker volume, not git | Use Option A or `upload-images-to-vps.ps1` |

### `EPERM` on `prisma generate` (Windows)

This almost always means a **previous `npm run dev` is still running**. Prisma
tries to overwrite `query_engine-windows.dll.node` while the live backend has
it open.

**Option 1 — use the running server (recommended for bulk upload)**

```powershell
Invoke-WebRequest http://127.0.0.1:4000/health -UseBasicParsing
```

If that returns OK, open a **second terminal** and run the bulk upload — do not
start `npm run dev` again.

**Option 2 — restart the backend**

```powershell
# Find what's on port 4000
Get-NetTCPConnection -LocalPort 4000 | Select-Object OwningProcess

# Stop it (replace 32020 with your PID)
Stop-Process -Id 32020 -Force

cd d:\coding\pvsresponse\backend
npm run dev
```

If it still fails, close other terminals running the backend, then:

```powershell
cd d:\coding\pvsresponse\backend
Remove-Item -Recurse -Force node_modules\.prisma\client -ErrorAction SilentlyContinue
npx prisma generate
npm run dev
```

---

## Related files

| Path | Role |
|------|------|
| `backend/scripts/bulk-upload-images-by-barcode.ts` | Main bulk uploader |
| `backend/scripts/export-products-without-images.ts` | Gap audit CSV |
| `backend/scripts/backfill-image-variants.ts` | Legacy flat → responsive |
| `scripts/upload-images-to-vps.ps1` | SCP uploads folder to VPS |
| `scripts/import-product-images.py` | **Legacy** Excel/name match (SQLite era) |
| `docs/vps-pending-migrations.md` | Prisma + post-migrate checklist (run before prod image push) |
| `DEPLOYMENT.md` | Full VPS deploy guide |

---

## Suggested order of work

1. Rename cropped photos → `{barcode}.jpg` → `backend/images-by-barcode/`
2. `export-products-without-images.ts` (baseline gap count)
3. `bulk-upload-images-by-barcode.ts --dry-run`
4. Start backend → `--apply` locally
5. Verify ERP + storefront locally
6. VPS: `vps-deploy.sh --build` (pending Prisma migrations)
7. VPS: `bulk-upload --apply --api …` **or** `upload-images-to-vps.ps1`
8. VPS: `export-products-without-images.ts` + spot-check live shop
