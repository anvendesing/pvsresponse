# NovaERP — Production VPS Deployment Guide

This guide covers **every step** to get NovaERP running on a fresh Linux VPS,
including the one-time migration of an existing SQLite production database to
the new PostgreSQL + Redis stack.

Follow the sections **in order**. Each step is independent and self-contained;
do not skip steps or assume context from a previous session.

---

## Services overview

| Service    | Role                                        | Exposed to host         |
|------------|---------------------------------------------|-------------------------|
| `postgres` | PostgreSQL 16 — primary database            | Internal only (:5432)   |
| `redis`    | Redis 7 — catalog cache + in-stock flags    | Internal only (:6379)   |
| `backend`  | Fastify API + Prisma ORM                    | Internal only (:4000)   |
| `web`      | ERP admin portal (nginx + Vite SPA)         | `WEB_PORT` (default 80) |
| `shop`     | Ecommerce storefront (nginx + Vite SPA)     | `SHOP_PORT` (default 8080) |

nginx in each frontend container reverse-proxies `/v1/*` and `/health` to the
backend over the internal Docker network. The backend port is **never** exposed
publicly.

---

## Quick start (fresh VPS with no existing data)

```bash
# On the VPS:
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
git clone <your-repo-url> novaerp && cd novaerp
cp .env.deploy.example .env
nano .env          # set JWT_SECRET and POSTGRES_PASSWORD (see Step 4)
docker compose up -d --build
# ~2-3 min on first run; visit http://<VPS_IP>/ (ERP) and http://<VPS_IP>:8080/ (shop)
```

For a VPS that is **already running the old SQLite stack** see
[§7 — Migrate existing SQLite VPS to PostgreSQL](#7-migrate-existing-sqlite-vps-to-postgresql).

---

## Step 1 — Provision the VPS

Minimum spec: **2 vCPU · 2 GB RAM · 20 GB SSD** (Hetzner CX22, DigitalOcean
Droplet, Linode Nanode 2GB, or equivalent).

1. Create the VPS with Ubuntu 22.04 LTS or Debian 12.
2. SSH in as root (or a user with `sudo`):
   ```bash
   ssh root@<VPS_IP>
   ```
3. Open firewall ports (repeat for both `ufw` and your cloud-provider panel):
   ```bash
   sudo ufw allow 22    # SSH (must always be open)
   sudo ufw allow 80    # ERP portal
   sudo ufw allow 8080  # Ecommerce storefront
   sudo ufw enable
   sudo ufw status
   ```
   Nothing else needs to be public. PostgreSQL, Redis, and the backend API
   are **not** exposed on the host network.

---

## Step 2 — Install Docker

```bash
# Official Docker Engine + Compose plugin (Debian / Ubuntu)
sudo apt update
sudo apt install -y ca-certificates curl gnupg git
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker

# (Optional) Let non-root users run Docker without sudo
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version           # Docker Engine 24+ or 25+
docker compose version     # Compose v2.x (the `compose` sub-command, not docker-compose v1)
```

> **If `docker compose version` shows v1** (`docker-compose` binary), install
> the plugin: `sudo apt install docker-compose-plugin`.

---

## Step 3 — Clone the repository

```bash
git clone <your-repo-url> novaerp
cd novaerp
```

Replace `<your-repo-url>` with the actual GitHub URL (e.g.
`https://github.com/your-org/pvsresponse.git`). If the repo is private, either:
- Use an HTTPS token: `git clone https://<token>@github.com/org/repo.git`
- Or set up an SSH deploy key on GitHub and clone via SSH.

---

## Step 4 — Configure environment

```bash
cp .env.deploy.example .env
```

Open `.env` in a text editor and set **at minimum** these two variables:

```bash
nano .env
```

| Variable           | How to generate                    | Example |
|--------------------|------------------------------------|---------|
| `JWT_SECRET`       | `openssl rand -hex 64`             | `e3b0c44298fc1c...` (128 chars) |
| `POSTGRES_PASSWORD`| `openssl rand -hex 32`             | `a7f2c9...` (64 chars) |

**Do not** leave them at the placeholder values. Everything else in `.env` has
a working default for a standard IP-only deployment.

#### Full variable reference

| Variable                    | Default                                                    | When to change |
|-----------------------------|------------------------------------------------------------|----------------|
| `JWT_SECRET`                | _(must set)_                                               | Always |
| `POSTGRES_PASSWORD`         | _(must set)_                                               | Always |
| `WEB_PORT`                  | `80`                                                       | If port 80 is taken on the host |
| `SHOP_PORT`                 | `8080`                                                     | If port 8080 is taken |
| `DATABASE_URL`              | `postgresql://novaerp:${POSTGRES_PASSWORD}@postgres:5432/novaerp?schema=public` | Only when using an external Postgres |
| `REDIS_URL`                 | `redis://redis:6379/0`                                     | Only when using an external Redis |
| `CORS_ORIGIN`               | `*`                                                        | When you know your exact consumer origins |
| `VITE_API_URL`              | _(empty)_                                                  | Leave blank; same-origin nginx proxy handles it |
| `VITE_MOCK_STOREFRONT_TOKEN`| _(empty)_                                                  | Set to a random token if you want to lock the public storefront API |

---

## Step 5 — Build and start (first run)

```bash
docker compose up -d --build
```

This will:
1. Pull `postgres:16-alpine` and `redis:7-alpine` from Docker Hub.
2. Build `novaerp-backend`, `novaerp-web`, and `novaerp-shop` images locally.
3. Start all five services.
4. On first startup the backend entrypoint automatically:
   - Waits for Postgres to be ready (`pg_isready`)
   - Runs `prisma migrate deploy` (applies the baseline migration)
   - Seeds product categories, storefront concerns, and image URLs
   - Starts the Fastify API on `:4000`

**Expected duration:** 2–4 minutes on first run (image build + Prisma migrate).
Subsequent restarts are under 30 seconds.

Watch progress:
```bash
docker compose logs -f backend
```
You should see `NovaERP API ready · http://localhost:4000/v1` within 2 minutes.

---

## Step 6 — Verify the deployment

Run these checks from the VPS itself:

```bash
# 1. All five services should be (healthy) or (running)
docker compose ps

# 2. Health endpoint via the ERP nginx (port 80)
curl -sf http://localhost/health && echo "ERP OK"

# 3. Health endpoint via the shop nginx (port 8080)
curl -sf http://localhost:8080/health && echo "SHOP OK"

# 4. Public company info API
curl -sf http://localhost/v1/public/company | python3 -m json.tool

# 5. Postgres has rows
docker compose exec postgres psql -U novaerp -c "SELECT COUNT(*) FROM \"Product\";"

# 6. Redis is responding
docker compose exec redis redis-cli ping
```

From your **laptop / local machine**:
```bash
curl -sf http://<VPS_IP>/health
curl -sf http://<VPS_IP>:8080/health
```

Then open `http://<VPS_IP>/` (ERP) and `http://<VPS_IP>:8080/` (shop) in a
browser.

Default login credentials are printed in the backend startup logs:
```bash
docker compose logs backend | grep -A 20 "Seeded users"
```

---

## Step 7 — Migrate existing SQLite VPS to PostgreSQL

> **Use this section if your VPS is currently running the old SQLite-based
> stack** and you want to upgrade it to the PostgreSQL + Redis stack.
> Skip this entirely for a fresh (no existing data) deployment.

The migration runs in three phases. All commands are run **on the VPS** inside
the repo directory.

### Phase overview

| Phase | What it does |
|-------|-------------|
| **1 – Export** | Copies the SQLite `dev.db` file from the old container volume to `/tmp/novaerp-dev.db` on the VPS host. The old backend container must still be running. |
| **2 – Deploy** | Runs `git pull`, updates `.env` (auto-generates `POSTGRES_PASSWORD` if missing), stops the old stack, builds and starts the new postgres + redis + backend stack. Prisma migrations run automatically. |
| **3 – Import** | Copies `dev.db` into the new backend container and runs the compiled `import-from-sqlite.js` script, which imports ALL tables (products, categories, customers, warehouses, bins, putaway rules, stock rules, BOMs, price lists, vendors, users — every master-data table) while handling schema drift and boolean/timestamp type conversion automatically. Operational/transactional tables (invoices, purchase orders, stock ledger, etc.) are cleaned up post-import so you start fresh. |

### Step 7.1 — On your dev machine: commit and push all changes

```powershell
# From d:\coding\pvsresponse  (Windows dev machine)
git add -A
git commit -m "chore: prepare for PostgreSQL + Redis production deployment"
git push origin main
```

### Step 7.2 — SSH into the VPS

```bash
ssh root@<VPS_IP>
cd ~/novaerp   # or ~/pvsresponse — wherever you cloned the repo
```

### Step 7.3 — Pull the latest code

```bash
git pull --ff-only
```

Confirm the pull succeeded and you have the latest `scripts/vps-migrate-to-postgres.sh`.

### Step 7.4 — Run the migration script

```bash
bash scripts/vps-migrate-to-postgres.sh
```

This takes 3–8 minutes. You will see three banners:

```
══════════════════════════════════════════════════════════════════
  Phase 1: Copy SQLite database from old container
══════════════════════════════════════════════════════════════════
  ✓ dev.db copied (12M) → /tmp/novaerp-dev.db

══════════════════════════════════════════════════════════════════
  Phase 2: Deploy new stack
══════════════════════════════════════════════════════════════════
  ... (git pull + docker build + backend health wait) ...

══════════════════════════════════════════════════════════════════
  Phase 3: Import all data from SQLite → Postgres
══════════════════════════════════════════════════════════════════
  ✓ Product: 580/580 rows
  ✓ Warehouse: 18/18 rows
  ...
  ✓ Done. 70000+ rows imported.
```

#### Running individual phases (if something fails mid-flight)

```bash
# Phase 1 only — export dev.db (old container must still be running)
bash scripts/vps-migrate-to-postgres.sh --export

# Phase 2 only — git pull + rebuild stack
bash scripts/vps-migrate-to-postgres.sh --deploy

# Phase 3 only — import data (requires /tmp/novaerp-dev.db from Phase 1)
bash scripts/vps-migrate-to-postgres.sh --import
```

### Step 7.5 — Verify the migration

```bash
# All services healthy
docker compose ps

# Backend logs (look for "NovaERP API ready")
docker compose logs backend --tail 40

# Confirm Postgres has master data
docker compose exec postgres psql -U novaerp \
  -c "SELECT (SELECT COUNT(*) FROM \"Product\") AS products,
             (SELECT COUNT(*) FROM \"Warehouse\") AS warehouses,
             (SELECT COUNT(*) FROM \"Customer\") AS customers;"

# Confirm Redis is responding
docker compose exec redis redis-cli ping

# Health via nginx
curl -sf http://localhost/health && echo "ERP OK"
curl -sf http://localhost:8080/health && echo "SHOP OK"
```

### Step 7.6 — Upload product images (if not already in the volume)

Product images live in the `novaerp_uploads` Docker volume. They are **not**
in the git repo and must be transferred once from the dev machine:

```powershell
# From Windows dev machine:
.\scripts\upload-images-to-vps.ps1 -VpsUser root -VpsHost <VPS_IP>

# With a specific SSH key:
.\scripts\upload-images-to-vps.ps1 -VpsUser root -VpsHost <VPS_IP> -SshKey "C:\Users\Sharath\.ssh\pvs_key"
```

Then backfill responsive image variants (WebP + JPEG in 3 sizes) on the VPS:

```bash
docker compose exec backend node dist/scripts/backfill-image-variants.js
```

---

## Step 8 — Set up nightly maintenance (once, after migration)

```bash
sudo mkdir -p /opt/backups
sudo chmod 755 /opt/backups
sudo crontab -e
```

Add these lines (adjust the path to match where you cloned the repo):

```cron
# PostgreSQL nightly backup at 02:00
0 2 * * *  bash /root/novaerp/scripts/pg-backup.sh >> /var/log/novaerp-backup.log 2>&1

# ChangeLog pruning (keep 30 days) at 03:00
0 3 * * *  docker exec novaerp-backend-1 node dist/scripts/prune-change-log.js >> /var/log/novaerp-backup.log 2>&1

# Customer activity pruning at 03:05
5 3 * * *  docker exec novaerp-backend-1 node dist/scripts/prune-activity.js >> /var/log/novaerp-backup.log 2>&1
```

Backups are saved to `/opt/backups/novaerp-YYYY-MM-DD.dump` (Postgres custom
format, `pg_restore`-compatible) and auto-deleted after 14 days.

---

## Step 9 — Routine future deploys (code pushes)

After the one-time migration above, every subsequent code update is:

```bash
# On the VPS:
cd ~/novaerp
bash scripts/vps-deploy.sh --build
```

Or from Windows, push to Git and then remotely:

```powershell
# On Windows dev machine:
git push origin main

# Then on the VPS (or via the deploy script):
# bash scripts/vps-deploy.sh --build
```

The deploy script does:
1. `git pull --ff-only`
2. `docker compose up -d --build` (only changed images are rebuilt)
3. Waits for backend health
4. Runs stock sync, seeding, and post-migrate config

Any new Prisma migrations in the repo are automatically applied by
`prisma migrate deploy` on container startup — **no manual migration step
needed**.

---

## Step 10 — Day-to-day operations reference

### View logs

```bash
docker compose logs -f                    # all services
docker compose logs -f backend            # API logs only
docker compose logs backend --tail 100    # last 100 lines
```

### Restart a single service

```bash
docker compose restart backend
docker compose restart web
docker compose restart shop
```

### Manual stock sync (safe to re-run anytime)

```bash
docker compose exec backend npm run db:sync-stock
```

### Restore from a PostgreSQL backup

```bash
# Stop backend during restore to prevent writes
docker compose stop backend

# Replace YYYY-MM-DD with the backup date
PG_CONTAINER=$(docker compose ps -q postgres)
cat /opt/backups/novaerp-YYYY-MM-DD.dump | \
  docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$PG_CONTAINER" \
  pg_restore -U novaerp -d novaerp --clean --if-exists

docker compose start backend
```

### Wipe and restart (destroys all data — irreversible)

```bash
docker compose down -v
docker compose up -d --build
```

### Stop everything (keeps DB + uploads volumes)

```bash
docker compose down
```

---

## Step 11 — Uploading and managing product images

Product photos live in the `novaerp_uploads` Docker volume (mounted at
`/app/uploads` inside the backend container). They survive container rebuilds
but are **not** in the git repository.

```powershell
# Upload all images from local dev machine to VPS
.\scripts\upload-images-to-vps.ps1

# Custom VPS host or user:
.\scripts\upload-images-to-vps.ps1 -VpsUser ubuntu -VpsHost 1.2.3.4

# Specific SSH key:
.\scripts\upload-images-to-vps.ps1 -SshKey "C:\Users\Sharath\.ssh\pvs_key"
```

After uploading, run the backfill on the VPS to generate responsive variants:

```bash
docker compose exec backend node dist/scripts/backfill-image-variants.js
```

Verify image count inside the container:

```bash
docker exec $(docker ps --filter name=backend --format '{{.Names}}' | head -1) \
  ls /app/uploads/products/ | wc -l
```

---

## Step 12 — Attach a domain (optional, later)

No application changes are needed. Two options:

**Option A — Cloudflare Tunnel (easiest, free HTTPS, no firewall changes):**
```bash
docker run -d --name cloudflared \
  --network novaerp_novaerp \
  cloudflare/cloudflared:latest tunnel \
  --no-autoupdate run --token <TUNNEL_TOKEN>
```

**Option B — Caddy (auto-HTTPS via Let's Encrypt):**

Add to `docker-compose.yml`:
```yaml
caddy:
  image: caddy:2-alpine
  restart: unless-stopped
  ports: ["80:80", "443:443"]
  volumes:
    - ./Caddyfile:/etc/caddy/Caddyfile
    - caddy_data:/data
  networks: [novaerp]
```

`Caddyfile`:
```
yourshop.example.com {
    reverse_proxy web:80
}
erp.example.com {
    reverse_proxy web:80
}
```

Change `web` and `shop` `ports:` to `expose: ["80"]` (no host publish).

---

## Step 13 — CI-built images from GitHub Actions (optional)

The repo includes `.github/workflows/build-images.yml`. When enabled, every
push to `main` builds and pushes all three images to GitHub Container Registry
(ghcr.io), tagged with `latest` and `sha-<short>`.

### One-time setup

1. **GitHub repo → Settings → Actions → General → Workflow permissions**:
   set to "Read and write permissions".
2. **Make packages public**: Profile → Packages → click package →
   Package settings → Change visibility → Public.
3. On the VPS, log in once (only for private packages):
   ```bash
   echo $GITHUB_PAT | docker login ghcr.io -u <github-user> --password-stdin
   ```

### Deploy from CI images

```bash
# On the VPS:
export REGISTRY_OWNER=your-github-username   # must be lowercase
export IMAGE_TAG=latest
docker compose pull
docker compose up -d --no-build
```

### Rollback to a specific commit

```bash
IMAGE_TAG=sha-9f8e7d6 docker compose pull && docker compose up -d --no-build
```

---

## Step 14 — Troubleshooting

### `docker compose up` fails: `JWT_SECRET is required`
You haven't created `.env`. Run `cp .env.deploy.example .env` and set
`JWT_SECRET` and `POSTGRES_PASSWORD`.

### Backend container restarts repeatedly
```bash
docker compose logs backend --tail 50
```
Most common causes:
- `DATABASE_URL` is wrong → check `.env`
- Postgres not yet healthy → wait 30s and check `docker compose ps postgres`
- `prisma migrate deploy` failed → see below

### `prisma migrate deploy` fails with `P3009` (failed migration)
```bash
docker compose exec backend npx prisma migrate status
```
If the migration is stuck in "failed" state and the DB is empty:
```bash
docker compose down -v          # wipe volumes (data loss!)
docker compose up -d --build
```
If you need to preserve data, manually fix the failed migration:
```bash
docker compose exec postgres psql -U novaerp \
  -c "UPDATE \"_prisma_migrations\" SET rolled_back_at = NULL, finished_at = NOW() WHERE migration_name = '20260630000000_init';"
docker compose restart backend
```

### `Port 80 already in use`
```bash
# In .env:
WEB_PORT=8081
docker compose up -d
```

### Backend healthy but products/warehouses empty after migration
The import script may not have run. Re-run Phase 3:
```bash
bash scripts/vps-migrate-to-postgres.sh --import
```

### Check if Postgres actually has data
```bash
docker compose exec postgres psql -U novaerp \
  -c "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 10;"
```

### Redis connection errors in backend logs
Redis is optional. If it fails to connect, the backend gracefully disables
caching and continues. If you want Redis:
```bash
docker compose ps redis
docker compose logs redis
# Restart just redis:
docker compose restart redis
```

### Images not loading in the storefront
1. Check `novaerp_uploads` volume has files:
   ```bash
   docker exec $(docker ps --filter name=backend --format '{{.Names}}' | head -1) ls /app/uploads/products/ | head
   ```
2. Run image backfill:
   ```bash
   docker compose exec backend node dist/scripts/backfill-image-variants.js
   ```
3. Test directly:
   ```bash
   curl -I http://localhost:4000/uploads/products/<filename>.jpg
   ```

---

## Reference: deployment file inventory

| Path | Purpose |
|------|---------|
| `.env.deploy.example` | Copy to `.env` on VPS; fill in `JWT_SECRET` and `POSTGRES_PASSWORD` |
| `docker-compose.yml` | All five services: postgres, redis, backend, web, shop |
| `backend/Dockerfile` | Multi-stage Node 22 build; `prisma migrate deploy` runs on every start |
| `backend/docker-entrypoint.sh` | Waits for Postgres, seeds images, runs migrations, starts API |
| `backend/prisma/schema.prisma` | Prisma schema (PostgreSQL provider) |
| `backend/prisma/migrations/20260630000000_init/migration.sql` | Single baseline migration — all 87 tables |
| `erp-portal/Dockerfile` | Vite build → nginx static; proxies `/v1/*` to backend |
| `erp-portal/nginx.conf` | nginx config for ERP SPA |
| `pvsecommerce/Dockerfile` | Vite build → nginx static; proxies `/v1/*` to backend |
| `pvsecommerce/nginx.conf` | nginx config for shop SPA |
| `scripts/vps-migrate-to-postgres.sh` | **One-time migration from SQLite → Postgres** (3 phases) |
| `scripts/vps-deploy.sh` | Routine deploys: git pull + build + stock sync |
| `scripts/deploy-to-vps.ps1` | Windows: SSH remote deploy |
| `scripts/upload-images-to-vps.ps1` | Windows: SCP product images to VPS |
| `scripts/pg-backup.sh` | Nightly `pg_dump` + 14-day retention |
| `backend/scripts/import-from-sqlite.ts` | Data import from SQLite → Postgres (local use) |
| `backend/src/scripts/import-from-sqlite.ts` | Same script compiled into Docker image for VPS migration |
| `LOCAL_DEV.md` | Local development setup with native Postgres 18 |
