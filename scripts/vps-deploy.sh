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
#
# Examples:
#   bash scripts/vps-deploy.sh --build
#   REGISTRY_OWNER=anvendesing IMAGE_TAG=latest bash scripts/vps-deploy.sh --pull

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

MODE="auto"
SKIP_SYNC=0
for arg in "$@"; do
  case "$arg" in
    --build) MODE="build" ;;
    --pull)  MODE="pull" ;;
    --no-sync) SKIP_SYNC=1 ;;
  esac
done

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

echo "=== NovaERP deploy (mode: $MODE) ==="
echo "Repo: $REPO_DIR"

echo ""
echo "=== Step 1: Pull latest code ==="
git pull --ff-only

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
echo ""
echo "=== Step 4: Reconcile product stock from bins (db:sync-stock) ==="
if [ "$SKIP_SYNC" -eq 1 ]; then
  echo "Skipped (--no-sync)."
else
  "${COMPOSE[@]}" exec -T "$BACKEND_SVC" npm run db:sync-stock
fi

echo ""
echo "=== Step 5: Product images (optional belt-and-suspenders) ==="
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
curl -sf http://localhost/health && echo "" || echo "FAIL (check web proxy)"
echo ""
echo "=== Deploy complete ==="
echo "ERP:  http://$(hostname -I 2>/dev/null | awk '{print $1}'):${WEB_PORT:-80}/"
echo "Shop: http://$(hostname -I 2>/dev/null | awk '{print $1}'):${SHOP_PORT:-8080}/"
