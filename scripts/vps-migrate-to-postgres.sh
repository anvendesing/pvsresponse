#!/bin/bash
# =============================================================================
# NovaERP — VPS migration: SQLite → PostgreSQL + Redis
# =============================================================================
#
# Migrates a running SQLite-based stack to the new PostgreSQL + Redis stack
# in three phases:
#
#   Phase 1 (export):   Copy the SQLite dev.db file from the OLD container
#                       volume to /tmp/novaerp-dev.db on the host.
#                       The OLD backend image must still be running.
#
#   Phase 2 (deploy):   git pull + update .env + docker compose up --build.
#                       Starts postgres, redis, and the new backend.
#                       Prisma migrations run automatically on startup.
#
#   Phase 3 (import):   Copy dev.db into the new backend container and run
#                       the compiled import-from-sqlite script, which imports
#                       ALL tables (products, customers, stock rules, putaway
#                       rules, invoices, BOM, ledger — everything) while
#                       handling schema drift and timestamp conversion
#                       automatically.
#
# Usage (run on the VPS inside the repo directory):
#
#   bash scripts/vps-migrate-to-postgres.sh          # all three phases
#   bash scripts/vps-migrate-to-postgres.sh --export  # Phase 1 only
#   bash scripts/vps-migrate-to-postgres.sh --deploy  # Phase 2 only
#   bash scripts/vps-migrate-to-postgres.sh --import  # Phase 3 only
#
# =============================================================================

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

DB_HOST_PATH="/tmp/novaerp-dev.db"
COMPOSE=(docker compose -f docker-compose.yml)

PHASE_EXPORT=0
PHASE_DEPLOY=0
PHASE_IMPORT=0

if [ $# -eq 0 ]; then
  PHASE_EXPORT=1
  PHASE_DEPLOY=1
  PHASE_IMPORT=1
else
  for arg in "$@"; do
    case "$arg" in
      --export) PHASE_EXPORT=1 ;;
      --deploy) PHASE_DEPLOY=1 ;;
      --import) PHASE_IMPORT=1 ;;
      *) echo "Unknown option: $arg"; exit 1 ;;
    esac
  done
fi

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 1 — Copy dev.db from the OLD SQLite container volume to host
# ─────────────────────────────────────────────────────────────────────────────
if [ "$PHASE_EXPORT" -eq 1 ]; then
  echo ""
  echo "══════════════════════════════════════════════════════════════════"
  echo "  Phase 1: Copy SQLite database from old container"
  echo "══════════════════════════════════════════════════════════════════"

  # Find the current SQLite volume (named novaerp_db in the old compose file)
  SQLITE_VOL=$(docker volume ls -q 2>/dev/null | grep -E "novaerp_db" | head -1 || true)
  if [ -z "$SQLITE_VOL" ]; then
    BACKEND_CID=$("${COMPOSE[@]}" ps -q backend 2>/dev/null | head -1 || true)
    if [ -n "$BACKEND_CID" ]; then
      SQLITE_VOL=$(docker inspect -f \
        '{{ range .Mounts }}{{ if eq .Destination "/data" }}{{ .Name }}{{ end }}{{ end }}' \
        "$BACKEND_CID" 2>/dev/null || true)
    fi
  fi

  if [ -z "$SQLITE_VOL" ]; then
    echo "ERROR: Cannot find the novaerp_db SQLite volume."
    echo "  Make sure the OLD backend container is running (docker compose ps)."
    exit 1
  fi
  echo "  SQLite volume: $SQLITE_VOL"

  # Copy dev.db from the volume to the host using a temporary alpine container
  echo "  Copying dev.db to $DB_HOST_PATH ..."
  docker run --rm \
    -v "${SQLITE_VOL}:/data:ro" \
    -v "/tmp:/out" \
    alpine sh -c "cp /data/dev.db /out/novaerp-dev.db"

  if [ ! -f "$DB_HOST_PATH" ]; then
    echo "ERROR: Copy failed — $DB_HOST_PATH not found."
    exit 1
  fi

  DB_SIZE=$(du -sh "$DB_HOST_PATH" | cut -f1)
  echo "  ✓ dev.db copied ($DB_SIZE) → $DB_HOST_PATH"
fi

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 2 — Deploy new stack (postgres + redis + backend)
# ─────────────────────────────────────────────────────────────────────────────
if [ "$PHASE_DEPLOY" -eq 1 ]; then
  echo ""
  echo "══════════════════════════════════════════════════════════════════"
  echo "  Phase 2: Deploy new stack"
  echo "══════════════════════════════════════════════════════════════════"

  if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
  fi

  # Generate POSTGRES_PASSWORD if not already set
  if [ -z "${POSTGRES_PASSWORD:-}" ]; then
    PG_PASS=$(openssl rand -hex 32)
    echo ""
    echo "  Generating POSTGRES_PASSWORD (not found in .env)…"
    echo "POSTGRES_PASSWORD=${PG_PASS}" >> .env
    export POSTGRES_PASSWORD="$PG_PASS"
    echo "  Added POSTGRES_PASSWORD to .env"
  fi

  if [ -z "${REDIS_URL:-}" ]; then
    echo "REDIS_URL=redis://redis:6379/0" >> .env
    echo "  Added REDIS_URL to .env"
  fi

  if grep -q "^DATABASE_URL=file:" .env 2>/dev/null || ! grep -q "^DATABASE_URL=" .env 2>/dev/null; then
    grep -v "^DATABASE_URL=" .env > .env.tmp && mv .env.tmp .env
    echo "DATABASE_URL=postgresql://novaerp:\${POSTGRES_PASSWORD}@postgres:5432/novaerp?schema=public" >> .env
    echo "  Updated DATABASE_URL to PostgreSQL in .env"
  fi

  echo ""
  echo "  Step 2a: Pull latest code"
  git pull --ff-only

  echo ""
  echo "  Step 2b: Stop OLD stack (SQLite volumes are preserved)"
  "${COMPOSE[@]}" down --remove-orphans || true

  echo ""
  echo "  Step 2c: Build and start new stack (postgres + redis + backend)"
  "${COMPOSE[@]}" up -d --build

  echo ""
  echo "  Waiting for backend health (up to 120s)..."
  for i in $(seq 1 24); do
    if "${COMPOSE[@]}" ps backend 2>/dev/null | grep -q "(healthy)"; then
      echo "  ✓ Backend is healthy."
      break
    fi
    if [ "$i" -eq 24 ]; then
      echo "  WARN: Backend not yet healthy — check logs:"
      echo "    docker compose logs backend --tail 40"
    fi
    printf "."
    sleep 5
  done
  echo ""
fi

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 3 — Import ALL data from dev.db into Postgres
# ─────────────────────────────────────────────────────────────────────────────
if [ "$PHASE_IMPORT" -eq 1 ]; then
  echo ""
  echo "══════════════════════════════════════════════════════════════════"
  echo "  Phase 3: Import all data from SQLite → Postgres"
  echo "══════════════════════════════════════════════════════════════════"

  if [ ! -f "$DB_HOST_PATH" ]; then
    echo "ERROR: $DB_HOST_PATH not found."
    echo "  Run Phase 1 first:  bash scripts/vps-migrate-to-postgres.sh --export"
    exit 1
  fi

  BACKEND_CID=$("${COMPOSE[@]}" ps -q backend 2>/dev/null | head -1 || true)
  if [ -z "$BACKEND_CID" ]; then
    echo "ERROR: Backend container is not running."
    echo "  Run Phase 2 first:  bash scripts/vps-migrate-to-postgres.sh --deploy"
    exit 1
  fi

  echo ""
  echo "  Step 3a: Copy dev.db into backend container..."
  docker cp "$DB_HOST_PATH" "${BACKEND_CID}:/app/prisma/dev.db"
  echo "  ✓ dev.db copied into container"

  echo ""
  echo "  Step 3b: Import all tables into Postgres (products, customers,"
  echo "           stock rules, putaway rules, invoices, ledger, BOM…)"
  echo "           This handles schema drift and timestamp conversion."
  docker exec "$BACKEND_CID" \
    sh -c "node --experimental-sqlite dist/scripts/import-from-sqlite.js"

  echo ""
  echo "  Step 3c: Sync stock counters from bin quantities..."
  "${COMPOSE[@]}" exec -T backend node dist/scripts/sync-stock-from-bins.js 2>/dev/null || \
    echo "  (sync-stock skipped)"

  echo ""
  echo "  Step 3d: Seed product categories + concern taxonomy..."
  "${COMPOSE[@]}" exec -T backend node dist/scripts/seed-product-categories.js 2>/dev/null || true
  if "${COMPOSE[@]}" exec -T backend test -f /app/data/categories-and-products.xlsx 2>/dev/null; then
    "${COMPOSE[@]}" exec -T backend node dist/scripts/import-categories-xlsx.js /app/data/categories-and-products.xlsx 2>/dev/null || true
  fi
  if "${COMPOSE[@]}" exec -T backend test -f /app/data/shop-by-concerns-mapping.xlsx 2>/dev/null; then
    "${COMPOSE[@]}" exec -T backend node dist/scripts/import-concerns-xlsx.js /app/data/shop-by-concerns-mapping.xlsx 2>/dev/null || true
  fi

  echo ""
  echo "  Step 3e: Backfill responsive image variants (Sharp pipeline)..."
  "${COMPOSE[@]}" exec -T backend node dist/scripts/backfill-image-variants.js 2>/dev/null || \
    echo "  (backfill-image-variants skipped — run manually if needed)"

  echo ""
  echo "  Step 3f: Clean up dev.db from container..."
  docker exec "$BACKEND_CID" rm -f /app/prisma/dev.db
fi

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════════════"
echo "  Migration complete!"
echo "══════════════════════════════════════════════════════════════════"
echo ""
${COMPOSE[*]} ps
echo ""
echo "  ERP:  http://$(hostname -I 2>/dev/null | awk '{print $1}'):${WEB_PORT:-80}/"
echo "  Shop: http://$(hostname -I 2>/dev/null | awk '{print $1}'):${SHOP_PORT:-8080}/"
echo ""
echo "  Set up nightly maintenance (once):"
echo "    sudo crontab -e"
echo "    0 2 * * *  bash ${REPO_DIR}/scripts/pg-backup.sh >> /var/log/novaerp-backup.log 2>&1"
echo "    0 3 * * *  docker exec novaerp-backend-1 node dist/scripts/prune-change-log.js"
echo "    5 3 * * *  docker exec novaerp-backend-1 node dist/scripts/prune-activity.js"
echo ""
echo "  The OLD SQLite volume (novaerp_db) is preserved."
echo "  Delete after 2 weeks if everything is OK:"
echo "    docker volume rm \$(docker volume ls -q | grep novaerp_db)"
