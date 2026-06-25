#!/bin/bash
# Full NovaERP VPS deploy: pull code/images, restart stack, sync stock from bins.
#
# Run ON THE VPS inside the repo directory:
#   cd ~/pvsresponse   # or ~/novaerp
#   bash scripts/vps-deploy.sh
#
# Options:
#   --build     Build images on the VPS (git pull + docker compose up --build).
#               Default when REGISTRY_OWNER is unset.
#   --pull      Pull prebuilt GHCR images (requires REGISTRY_OWNER + docker login).
#   --no-sync   Skip npm run db:sync-stock after backend is up.
#   --no-post-migrate
#               Skip ops:post-migrate-config:dist (facility/lot backfill).
#   --reset-data
#               docker compose down -v before deploy (wipes DB + uploads volumes).
#   --replace-db <path>
#               After stack is up, stop backend and copy <path> to /data/dev.db
#               inside the novaerp_db volume (backs up the previous file first).
#
# Examples:
#   bash scripts/vps-deploy.sh --build
#   REGISTRY_OWNER=anvendesing IMAGE_TAG=latest bash scripts/vps-deploy.sh --pull

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

MODE="auto"
SKIP_SYNC=0
SKIP_POST_MIGRATE=0
RESET_DATA=0
REPLACE_DB=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --build) MODE="build" ;;
    --pull)  MODE="pull" ;;
    --no-sync) SKIP_SYNC=1 ;;
    --no-post-migrate) SKIP_POST_MIGRATE=1 ;;
    --reset-data) RESET_DATA=1 ;;
    --replace-db)
      shift
      REPLACE_DB="${1:?--replace-db requires a path to dev.db or snapshot}"
      ;;
    *)
      ARGS+=("$1")
      ;;
  esac
  shift
done
set -- "${ARGS[@]}"

if [ "$MODE" = "auto" ]; then
  if [ -n "${REGISTRY_OWNER:-}" ]; then
    MODE="pull"
  else
    MODE="build"
  fi
fi

COMPOSE=(docker compose -f docker-compose.yml)
if [ -f docker-compose.prod.yml ] && [ "$MODE" = "pull" ]; then
  COMPOSE+=(-f docker-compose.prod.yml)
fi

# docker compose volume ls is not available on all VPS installs; use docker volume ls.
find_novaerp_db_volume() {
  local vol cid
  vol=$(docker volume ls -q 2>/dev/null | grep novaerp_db | head -1)
  if [ -n "$vol" ]; then
    echo "$vol"
    return 0
  fi
  cid=$("${COMPOSE[@]}" ps -q backend 2>/dev/null | head -1)
  if [ -n "$cid" ]; then
    docker inspect -f '{{ range .Mounts }}{{ if eq .Destination "/data" }}{{ .Name }}{{ end }}{{ end }}' "$cid" 2>/dev/null
  fi
}

abs_dir() {
  local p=$1
  if command -v realpath >/dev/null 2>&1; then
    dirname "$(realpath "$p")"
  else
    (cd "$(dirname "$p")" && pwd)
  fi
}

echo "=== NovaERP deploy (mode: $MODE) ==="
echo "Repo: $REPO_DIR"

echo ""
echo "=== Step 1: Pull latest code ==="
git pull --ff-only

if [ "$RESET_DATA" -eq 1 ]; then
  echo ""
  echo "=== Step 1b: Wipe persistent volumes (--reset-data) ==="
  "${COMPOSE[@]}" down -v
fi

if [ "$MODE" = "pull" ]; then
  echo ""
  echo "=== Step 2: Pull Docker images (GHCR) ==="
  echo "REGISTRY_OWNER=${REGISTRY_OWNER:?set REGISTRY_OWNER for --pull}"
  echo "IMAGE_TAG=${IMAGE_TAG:-latest}"
  "${COMPOSE[@]}" pull
  echo ""
  echo "=== Step 3: Restart stack (prebuilt images) ==="
  "${COMPOSE[@]}" up -d --no-build
else
  echo ""
  echo "=== Step 2: Build and restart stack on VPS ==="
  "${COMPOSE[@]}" up -d --build
fi

echo ""
echo "Waiting for backend health (up to 90s)..."
for i in $(seq 1 18); do
  if "${COMPOSE[@]}" ps backend 2>/dev/null | grep -q "(healthy)"; then
    echo "Backend is healthy."
    break
  fi
  if [ "$i" -eq 18 ]; then
    echo "WARN: Backend not healthy yet — check: ${COMPOSE[*]} logs backend"
  fi
  sleep 5
done

BACKEND_SVC="backend"

if [ -n "$REPLACE_DB" ]; then
  if [ ! -f "$REPLACE_DB" ]; then
    echo "ERROR: --replace-db file not found: $REPLACE_DB"
    exit 1
  fi
  echo ""
  echo "=== Step 4: Replace SQLite database (--replace-db) ==="
  DB_VOL=$(find_novaerp_db_volume)
  if [ -z "$DB_VOL" ]; then
    echo "ERROR: novaerp_db volume not found (looked via docker volume ls and backend mount inspect)"
    exit 1
  fi
  echo "  Using volume: $DB_VOL"
  "${COMPOSE[@]}" stop "$BACKEND_SVC"
  STAMP=$(date +%F-%H%M)
  REPLACE_DIR=$(abs_dir "$REPLACE_DB")
  REPLACE_FILE=$(basename "$REPLACE_DB")
  docker run --rm \
    -v "$DB_VOL":/data \
    -v "$REPLACE_DIR":/in \
    alpine sh -c "
      if [ -f /data/dev.db ]; then cp /data/dev.db /data/dev.db.backup-$STAMP; fi
      cp /in/$REPLACE_FILE /data/dev.db
      rm -f /data/dev.db-wal /data/dev.db-shm
      chown 1000:1000 /data/dev.db 2>/dev/null || true
    "
  "${COMPOSE[@]}" up -d "$BACKEND_SVC"
  echo "Waiting for backend after DB swap (up to 90s)..."
  for i in $(seq 1 18); do
    if "${COMPOSE[@]}" ps "$BACKEND_SVC" 2>/dev/null | grep -q "(healthy)"; then
      echo "Backend is healthy after DB swap."
      break
    fi
    if [ "$i" -eq 18 ]; then
      echo "WARN: Backend not healthy after DB swap — check logs"
    fi
    sleep 5
  done
fi

echo ""
echo "=== Step 5b: Seed godown shelf bins (db:seed-godowns) ==="
"${COMPOSE[@]}" exec -T "$BACKEND_SVC" npm run db:seed-godowns

echo ""
echo "=== Step 5c: Post-migrate configuration (ops:post-migrate-config:dist) ==="
if [ "$SKIP_POST_MIGRATE" -eq 1 ]; then
  echo "Skipped (--no-post-migrate)."
else
  "${COMPOSE[@]}" exec -T "$BACKEND_SVC" npm run ops:post-migrate-config:dist
fi

echo ""
echo "=== Step 6: Reconcile product stock from bins (db:sync-stock) ==="
if [ "$SKIP_SYNC" -eq 1 ]; then
  echo "Skipped (--no-sync)."
else
  "${COMPOSE[@]}" exec -T "$BACKEND_SVC" npm run db:sync-stock
fi

echo ""
echo "=== Step 7: Product images (optional belt-and-suspenders) ==="
IMG_SRC="$REPO_DIR/backend/uploads/products"
if [ -d "$IMG_SRC" ] && [ "$(find "$IMG_SRC" -maxdepth 1 -type f 2>/dev/null | wc -l)" -gt 0 ]; then
  CONTAINER=$("${COMPOSE[@]}" ps -q backend | head -1)
  if [ -n "$CONTAINER" ]; then
    docker exec "$CONTAINER" mkdir -p /app/uploads/products
    docker cp "$IMG_SRC/." "$CONTAINER:/app/uploads/products/" 2>/dev/null || true
    docker exec "$CONTAINER" node dist/scripts/seed-image-urls.js 2>/dev/null || true
  fi
fi

echo ""
echo "=== Verification ==="
"${COMPOSE[@]}" ps
echo -n "Health: "
HEALTH_OK=0
for i in $(seq 1 12); do
  if curl -sf http://localhost/health >/dev/null 2>&1; then
    curl -sf http://localhost/health && echo ""
    HEALTH_OK=1
    break
  fi
  if [ "$i" -lt 12 ]; then
    echo -n "."
    sleep 5
  fi
done
if [ "$HEALTH_OK" -eq 0 ]; then
  echo "FAIL (502/timeout — backend may still be running prisma migrate; try: ${COMPOSE[*]} logs backend --tail 80)"
fi
echo ""
echo "=== Deploy complete ==="
echo "ERP:  http://$(hostname -I 2>/dev/null | awk '{print $1}'):${WEB_PORT:-80}/"
echo "Shop: http://$(hostname -I 2>/dev/null | awk '{print $1}'):${SHOP_PORT:-8080}/"
