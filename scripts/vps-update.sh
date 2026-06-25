#!/usr/bin/env bash
# Pull latest code from git and restart NovaERP on the VPS.
#
# Run ON THE VPS inside the repo directory (same idea as ops:site-setup:dist):
#
#   cd ~/pvsresponse   # or ~/novaerp
#
#   # Full update (recommended — git pull + rebuild + stock sync):
#   bash scripts/vps-update.sh
#
#   # Or step by step:
#   bash scripts/vps-update.sh pull
#   bash scripts/vps-update.sh build
#   bash scripts/vps-update.sh sync
#   bash scripts/vps-update.sh site-setup
#   bash scripts/vps-update.sh post-migrate
#   bash scripts/vps-update.sh warehouse-layout
#
# See docs/vps-pending-migrations.md for migration checklist.
#
# Options (full update only — passed to vps-deploy.sh):
#   bash scripts/vps-update.sh --no-sync          # skip db:sync-stock
#   bash scripts/vps-update.sh --pull             # use GHCR images (set REGISTRY_OWNER)
#
# From Windows (push + remote deploy over SSH):
#   .\scripts\deploy-to-vps.ps1 -SshKey "$env:USERPROFILE\.ssh\your_vps_key"
#
# Replace the whole VPS database from your dev machine:
#   .\scripts\deploy-full-reset-to-vps.ps1 -SkipGitPush -SshKey "..."

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

# Flags like --build / --no-sync go straight to vps-deploy.sh (used by Windows deploy scripts).
if [ $# -gt 0 ] && [[ "${1:-}" == --* ]]; then
  exec bash "$REPO_DIR/scripts/vps-deploy.sh" "$@"
fi

COMPOSE=(docker compose -f docker-compose.yml)
if [ -f docker-compose.prod.yml ] && [ -n "${REGISTRY_OWNER:-}" ]; then
  COMPOSE+=(-f docker-compose.prod.yml)
fi

wait_healthy() {
  echo "Waiting for backend health (up to 90s)..."
  for i in $(seq 1 18); do
    if "${COMPOSE[@]}" ps backend 2>/dev/null | grep -q "(healthy)"; then
      echo "Backend is healthy."
      return 0
    fi
    sleep 5
  done
  echo "WARN: Backend not healthy yet — check: ${COMPOSE[*]} logs backend"
  return 1
}

cmd="${1:-all}"
shift || true

case "$cmd" in
  all)
    exec bash "$REPO_DIR/scripts/vps-deploy.sh" --build "$@"
    ;;

  pull)
    echo "=== Step 1: git pull ==="
    git pull --ff-only
    echo "Done. Run: bash scripts/vps-update.sh build"
    ;;

  build)
    echo "=== Step 2: docker compose up --build ==="
    "${COMPOSE[@]}" up -d --build
    wait_healthy || true
    echo "Done. Run: bash scripts/vps-update.sh sync"
    ;;

  sync)
    echo "=== Step 3: db:sync-stock ==="
    "${COMPOSE[@]}" exec -T backend npm run db:sync-stock
    echo "Stock counters reconciled from bin quantities."
    ;;

  site-setup)
    echo "=== ops:site-setup (warehouses + production lines + putaway) ==="
    "${COMPOSE[@]}" exec -T backend npm run ops:site-setup:dist
    ;;

  post-migrate)
    echo "=== ops:post-migrate-config (production lines + vacuum + oil + lot backfill) ==="
    "${COMPOSE[@]}" exec -T backend npm run ops:post-migrate-config:dist "$@"
    ;;

  warehouse-layout)
    echo "=== Warehouse layout (Farm Shop, Stock Room, godown shelves) ==="
    "${COMPOSE[@]}" exec -T backend npm run ops:warehouse-layout:dist
    ;;

  help|-h|--help)
    sed -n '2,28p' "$0" | sed 's/^# \?//'
    ;;

  *)
    echo "Unknown command: $cmd"
    echo "Run: bash scripts/vps-update.sh help"
    exit 1
    ;;
esac
