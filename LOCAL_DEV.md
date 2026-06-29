# Local Development Setup

This guide gets the full stack running on your **Windows dev machine** without
Docker. PostgreSQL runs as a native Windows service (same engine as production),
Redis is optional (the app degrades gracefully without it).

---

## Quick start

```
backend/     → Fastify API          http://localhost:4000
erp-portal/  → ERP React app        http://localhost:5173
pvsecommerce/ → Storefront           http://localhost:5174
```

---

## 1. Install PostgreSQL (no Docker needed)

### Option A — Windows installer (recommended, GUI)

1. Download the installer from https://www.postgresql.org/download/windows/
2. Run it, accept defaults, set a superuser password (e.g. `novaerp`)
3. Leave the port at **5432** and let it install as a Windows service

### Option B — winget (command line)

```powershell
winget install PostgreSQL.PostgreSQL
# Follow prompts; default port 5432
```

### Option C — Chocolatey

```powershell
choco install postgresql --params '/Password:novaerp'
```

After installation, the `postgres` Windows service starts automatically on
boot. Verify it is running:

```powershell
Get-Service postgresql*
# Should show: Running
```

> **Note:** If SQL Server is also installed, it may grab port 5432 first and
> Postgres will auto-assign to **5433**. Check with:
> `Select-String "^port" "C:\Program Files\PostgreSQL\18\data\postgresql.conf"`
> Use the actual port in your `DATABASE_URL`.

---

## 2. Create the dev database and user

Open **psql** (installed with Postgres) as the superuser:

```powershell
# If psql is not on PATH, add C:\Program Files\PostgreSQL\16\bin to PATH first
psql -U postgres
```

Then run these SQL commands:

```sql
CREATE USER novaerp WITH PASSWORD 'novaerp';
CREATE DATABASE novaerp OWNER novaerp;
\q
```

---

## 3. Install Redis (optional but recommended)

Redis enables catalog caching and in-stock flag lookups. Without it everything
still works, just without caching.

### Option A — winget

```powershell
winget install Memurai.Memurai
# Memurai is a Windows-native Redis-compatible server, free for dev use
```

### Option B — WSL2 Redis

```bash
# Inside WSL2 terminal
sudo apt update && sudo apt install -y redis-server
sudo service redis-server start
# Redis now reachable at localhost:6379 from Windows too
```

### Option C — skip Redis

Leave `REDIS_URL` unset in `.env` (or comment it out). The backend logs a
warning and runs without caching.

---

## 4. Configure the backend environment

```powershell
cd backend
copy .env.example .env
```

The default `.env.example` values already point to a local Postgres instance:

```ini
DATABASE_URL="postgresql://novaerp:novaerp@localhost:5433/novaerp?schema=public"
POSTGRES_PASSWORD="novaerp"
JWT_SECRET="change-me-in-production"
PORT=4000
HOST=0.0.0.0
CORS_ORIGIN="http://localhost:5173"
STOREFRONT_ORIGIN="http://localhost:5174"
PUBLIC_API_BASE="http://localhost:4000"
REDIS_URL="redis://localhost:6379/0"
```

Change `JWT_SECRET` to any long random string for your local machine.

---

## 5. Install dependencies and run migrations

```powershell
cd backend
npm install
npx prisma migrate dev     # creates all tables from the baseline migration
npm run db:seed            # seeds initial admin user + UoMs
```

If this is a fresh install with no data, optionally import catalog seed:

```powershell
# Only needed if you exported catalog data from another environment
npm run db:import-catalog-seed
```

---

## 6. Start the backend

```powershell
# Terminal 1 — backend API (http://localhost:4000)
cd backend
npm run dev
```

You should see:

```
Server listening at http://0.0.0.0:4000
```

---

## 7. Start the ERP portal

```powershell
# Terminal 2 — ERP portal (http://localhost:5173)
cd erp-portal
npm install
npm run dev
```

---

## 8. Start the storefront (optional)

```powershell
# Terminal 3 — Storefront (http://localhost:5174)
cd pvsecommerce
npm install
npm run dev
```

---

## Useful dev commands

```powershell
# Reset the local DB (wipe + re-migrate + re-seed)
cd backend
npx prisma migrate reset

# Open Prisma Studio (visual DB browser)
npx prisma studio

# Add a new migration after editing schema.prisma
npx prisma migrate dev --name describe_your_change

# Sync stock counters from bin quantities
npm run db:sync-stock

# Prune old activity / change-log entries
npm run db:prune-activity
npm run db:prune-change-log
```

---

## Troubleshooting

**`P1001: Can't reach database server`**
The Postgres service isn't running. Start it:
```powershell
Start-Service postgresql*
```

**`P3009: migrate found failed migrations`**
```powershell
npx prisma migrate reset    # drops and recreates all tables
```

**`EPERM` when starting `npm run dev`**
Another Node process has a lock on the Prisma engine. Kill it:
```powershell
Get-Process node | Stop-Process
```
Then retry `npm run dev`.

**Redis connection refused**
Either Redis isn't running or `REDIS_URL` is wrong. The backend degrades
gracefully — just ignore the warning in logs for local dev.

---

---

# VPS Migration: SQLite → PostgreSQL + Redis

> Run these commands on your VPS after `git push` from your dev machine.

## One-time migration (existing SQLite server)

SSH into the VPS, go to the repo, and run a single script:

```bash
ssh user@<VPS_IP>
cd ~/novaerp           # adjust if your repo is at ~/pvsresponse

bash scripts/vps-migrate-to-postgres.sh
```

What the script does — in three phases:

| Phase | Description |
|-------|-------------|
| **1 – Export** | While the old SQLite backend is still running, spins up a temporary `alpine+sqlite3` container to dump every catalog table (`Product`, `ProductVariant`, `Customer`, `Warehouse`, price lists, BOMs, etc.) to `/tmp/novaerp-seed/*.json`. |
| **2 – Deploy** | Runs `git pull`; auto-generates and saves `POSTGRES_PASSWORD` into `.env` if not already set; stops the old stack; runs `docker compose up -d --build`. The new backend entrypoint waits for Postgres then runs `prisma migrate deploy`. |
| **3 – Import** | Copies the JSON seed files into the new backend container and runs `import-catalog-seed` to populate Postgres. Also runs `db:sync-stock` and the image-variant backfill. |

If something fails mid-way, each phase is independently re-runnable:

```bash
bash scripts/vps-migrate-to-postgres.sh --export   # Phase 1 only
bash scripts/vps-migrate-to-postgres.sh --deploy   # Phase 2 only
bash scripts/vps-migrate-to-postgres.sh --import   # Phase 3 only
```

---

## Verify the migration

```bash
# All 5 services should be (healthy)
docker compose ps

# Backend should say "Server listening"
docker compose logs backend --tail 30

# Confirm data in Postgres
docker compose exec postgres psql -U novaerp -c 'SELECT COUNT(*) FROM "Product";'

# Confirm Redis
docker compose exec redis redis-cli ping    # → PONG
```

---

## Set up nightly maintenance (once, on VPS)

```bash
sudo crontab -e
```

Add these lines (adjust the path to your repo):

```cron
# Nightly Postgres backup at 02:00 (keeps 14 days)
0 2 * * *  bash /home/ubuntu/novaerp/scripts/pg-backup.sh >> /var/log/novaerp-backup.log 2>&1

# Prune ChangeLog rows older than 30 days
0 3 * * *  docker exec novaerp-backend-1 node dist/scripts/prune-change-log.js

# Prune CustomerActivity rows older than 90 days
5 3 * * *  docker exec novaerp-backend-1 node dist/scripts/prune-activity.js
```

---

## Routine deploys (after the one-time migration)

Every subsequent code push is just two commands on the VPS:

```bash
git pull
docker compose up -d --build
```

Or from your Windows machine:

```powershell
# scripts/deploy-to-vps.ps1 does git push + SSH exec automatically
.\scripts\deploy-to-vps.ps1
```

The backend entrypoint automatically runs `prisma migrate deploy` on every
container start, so any new migrations in the codebase apply themselves.

---

## Restore from a Postgres backup

```bash
# Stop backend to prevent writes
docker compose stop backend

# Restore (replace DATE with YYYY-MM-DD)
PG_CONTAINER=$(docker compose ps -q postgres)
PGPASSWORD="$POSTGRES_PASSWORD" docker exec -i "$PG_CONTAINER" \
  pg_restore -U novaerp -d novaerp --clean --if-exists \
  < /opt/backups/novaerp-DATE.dump

docker compose start backend
```

---

## Emergency rollback to SQLite

Only if Postgres causes blocking issues in the first week (no orders yet):

```bash
git checkout 328c3f6          # last SQLite commit
# Re-add DATABASE_URL=file:/data/dev.db to .env
docker compose up -d --build
```

The old `novaerp_db` SQLite volume is still intact (not deleted by the
new compose file), so no data is lost.
