#!/bin/bash
# =============================================================================
# NovaERP — VPS migration: SQLite → PostgreSQL + Redis
# =============================================================================
#
# This script migrates a running SQLite-based stack to the new
# PostgreSQL + Redis + image-optimization stack in three phases:
#
#   Phase 1 (export):   Dump catalog tables from the OLD SQLite container
#                       to JSON files in /tmp/novaerp-seed/.
#                       The OLD backend image must still be running.
#
#   Phase 2 (deploy):   git pull + update .env + docker compose up --build.
#                       Starts postgres, redis, and the new backend.
#
#   Phase 3 (import):   Copy JSON seed files into the new backend container
#                       and run import-catalog-seed.ts to populate Postgres.
#
# Usage (run on the VPS inside the repo directory):
#
#   bash scripts/vps-migrate-to-postgres.sh          # all three phases
#   bash scripts/vps-migrate-to-postgres.sh --export  # Phase 1 only
#   bash scripts/vps-migrate-to-postgres.sh --deploy  # Phase 2 only
#   bash scripts/vps-migrate-to-postgres.sh --import  # Phase 3 only
#
# Requirements on VPS:
#   - Docker + Docker Compose v2 installed
#   - git
#   - The OLD backend container running (for --export)
#   - /tmp at least ~100 MB free
#
# =============================================================================

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

SEED_DIR="/tmp/novaerp-seed"
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
# PHASE 1 — Export catalog data from the OLD SQLite container
# ─────────────────────────────────────────────────────────────────────────────
if [ "$PHASE_EXPORT" -eq 1 ]; then
  echo ""
  echo "══════════════════════════════════════════════════════════════════"
  echo "  Phase 1: Export catalog from SQLite"
  echo "══════════════════════════════════════════════════════════════════"

  # Find the current sqlite volume name
  SQLITE_VOL=$(docker volume ls -q 2>/dev/null | grep -E "novaerp_db" | head -1 || true)
  if [ -z "$SQLITE_VOL" ]; then
    # Try inspecting the running backend container for the /data mount
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

  mkdir -p "$SEED_DIR"
  echo "  Output dir:    $SEED_DIR"

  # Tables to export (catalog + config only — no operational tables)
  TABLES=(
    Uom
    ProductCategory
    ProductConcern
    WorkCenter
    Facility
    FacilityZone
    ProductionLine
    PackagingContainer
    Warehouse
    Bin
    Vendor
    VendorCatalogItem
    Product
    ProductVariant
    Bom
    BomOperation
    BomItem
    BomByproduct
    BomOperationLine
    PriceList
    PriceListItem
    PriceListItemRevision
    StockRule
    PutawayRule
    ReplenishSource
    Customer
    PayuConfig
    RazorpayConfig
    ShiprocketConfig
    StorefrontGatewayConfig
    Worker
    Machine
  )

  echo ""
  echo "  Exporting tables via sqlite3 CLI..."

  for TABLE in "${TABLES[@]}"; do
    OUT="$SEED_DIR/${TABLE}.json"
    # Use a temporary alpine container with sqlite3 to dump the table to JSON.
    # Redirect output to host file via volume bind.
    docker run --rm \
      -v "${SQLITE_VOL}:/data:ro" \
      -v "${SEED_DIR}:/out" \
      alpine sh -c \
      "apk add --no-cache sqlite 2>/dev/null; sqlite3 /data/dev.db -json \"SELECT * FROM \\\"${TABLE}\\\"\" > /out/${TABLE}.json 2>/dev/null || echo '[]' > /out/${TABLE}.json" \
      2>/dev/null
    COUNT=$(wc -c < "$OUT" 2>/dev/null || echo 0)
    if [ "$COUNT" -lt 5 ]; then
      echo "[]" > "$OUT"  # table may not exist, ensure valid JSON
    fi
    echo "    ✓ ${TABLE}"
  done

  echo ""
  echo "  Export complete → $SEED_DIR"
  ls -lh "$SEED_DIR" | head -20
  echo ""
  echo "  NOTE: operational tables (orders, ledger, activity…) are intentionally"
  echo "  NOT exported — this is a greenfield Postgres launch."
fi

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 2 — Deploy new stack (postgres + redis + backend)
# ─────────────────────────────────────────────────────────────────────────────
if [ "$PHASE_DEPLOY" -eq 1 ]; then
  echo ""
  echo "══════════════════════════════════════════════════════════════════"
  echo "  Phase 2: Deploy new stack"
  echo "══════════════════════════════════════════════════════════════════"

  # Load existing .env
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

  # Ensure REDIS_URL is set
  if [ -z "${REDIS_URL:-}" ]; then
    echo "REDIS_URL=redis://redis:6379/0" >> .env
    echo "  Added REDIS_URL to .env"
  fi

  # DATABASE_URL for postgres service
  if grep -q "^DATABASE_URL=file:" .env 2>/dev/null || ! grep -q "^DATABASE_URL=" .env 2>/dev/null; then
    # Remove old SQLite DATABASE_URL and replace with postgres
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
# PHASE 3 — Import catalog seed into Postgres
# ─────────────────────────────────────────────────────────────────────────────
if [ "$PHASE_IMPORT" -eq 1 ]; then
  echo ""
  echo "══════════════════════════════════════════════════════════════════"
  echo "  Phase 3: Import catalog into Postgres"
  echo "══════════════════════════════════════════════════════════════════"

  if [ ! -d "$SEED_DIR" ] || [ "$(ls "$SEED_DIR"/*.json 2>/dev/null | wc -l)" -eq 0 ]; then
    echo "ERROR: No seed files found in $SEED_DIR."
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
  echo "  Step 3a: Copy seed JSON files into backend container..."
  docker exec "$BACKEND_CID" mkdir -p /app/seed-data
  for f in "$SEED_DIR"/*.json; do
    docker cp "$f" "${BACKEND_CID}:/app/seed-data/$(basename "$f")"
  done
  echo "  ✓ Copied $(ls "$SEED_DIR"/*.json | wc -l) JSON files"

  echo ""
  echo "  Step 3b: Run import-catalog-seed..."
  docker exec "$BACKEND_CID" node dist/scripts/import-catalog-seed.js

  echo ""
  echo "  Step 3c: Sync stock from bins (db:sync-stock)..."
  "${COMPOSE[@]}" exec -T backend npm run db:sync-stock 2>/dev/null || \
    echo "  (db:sync-stock skipped — may need rebuild if script not compiled yet)"

  echo ""
  echo "  Step 3d: Seed product categories + concerns..."
  "${COMPOSE[@]}" exec -T backend npm run db:seed-product-categories 2>/dev/null || true
  if "${COMPOSE[@]}" exec -T backend test -f /app/data/categories-and-products.xlsx 2>/dev/null; then
    "${COMPOSE[@]}" exec -T backend npm run db:import-categories-xlsx 2>/dev/null || true
  fi
  if "${COMPOSE[@]}" exec -T backend test -f /app/data/shop-by-concerns-mapping.xlsx 2>/dev/null; then
    "${COMPOSE[@]}" exec -T backend npm run db:import-concerns-xlsx 2>/dev/null || true
  fi

  echo ""
  echo "  Step 3e: Backfill image variants (Sharp pipeline)..."
  "${COMPOSE[@]}" exec -T backend node dist/scripts/backfill-image-variants.js 2>/dev/null || \
    echo "  (backfill-image-variants skipped — run manually after first deploy)"
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
echo "  Set up nightly backups (once, on the host):"
echo "    sudo crontab -e"
echo "    0 2 * * *  bash ${REPO_DIR}/scripts/pg-backup.sh >> /var/log/novaerp-backup.log 2>&1"
echo "    0 3 * * *  docker exec novaerp-backend-1 node dist/scripts/prune-change-log.js"
echo "    5 3 * * *  docker exec novaerp-backend-1 node dist/scripts/prune-activity.js"
echo ""
echo "  The OLD SQLite volume (novaerp_db) is preserved."
echo "  Delete after 2 weeks if everything is OK:"
echo "    docker volume rm \$(docker volume ls -q | grep novaerp_db)"
