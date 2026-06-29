#!/bin/bash
# Replace the NovaERP SQLite database on this VPS with a snapshot file.
# Does NOT run warehouse seeds, post-migrate, or stock sync — use when
# copying a known-good dev.db from your machine.
#
# Usage (on VPS, after uploading the file):
#   bash scripts/replace-vps-db.sh /tmp/dev.db.snapshot
#
# From Windows (after snapshot + scp):
#   .\scripts\deploy-db-to-vps.ps1 -VpsUser root

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

DB_FILE="${1:?usage: bash scripts/replace-vps-db.sh /path/to/dev.db.snapshot}"
if [ ! -f "$DB_FILE" ]; then
  echo "ERROR: file not found: $DB_FILE"
  exit 1
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

COMPOSE=(docker compose -f docker-compose.yml)
if [ -f docker-compose.prod.yml ] && [ -n "${REGISTRY_OWNER:-}" ]; then
  COMPOSE+=(-f docker-compose.prod.yml)
fi

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

echo "=== Replace VPS database ==="
echo "Source: $DB_FILE"

DB_VOL=$(find_novaerp_db_volume)
if [ -z "$DB_VOL" ]; then
  echo "ERROR: novaerp_db docker volume not found"
  exit 1
fi
echo "Volume: $DB_VOL"

"${COMPOSE[@]}" stop backend

STAMP=$(date +%F-%H%M)
REPLACE_DIR=$(abs_dir "$DB_FILE")
REPLACE_FILE=$(basename "$DB_FILE")

docker run --rm \
  -v "$DB_VOL":/data \
  -v "$REPLACE_DIR":/in \
  alpine sh -c "
    if [ -f /data/dev.db ]; then cp /data/dev.db /data/dev.db.backup-$STAMP; fi
    cp /in/$REPLACE_FILE /data/dev.db
    rm -f /data/dev.db-wal /data/dev.db-shm
    chown 1000:1000 /data/dev.db 2>/dev/null || true
  "
echo "Backup saved as dev.db.backup-$STAMP on volume $DB_VOL"

"${COMPOSE[@]}" up -d backend

echo "Waiting for backend (up to 90s)..."
for i in $(seq 1 18); do
  if "${COMPOSE[@]}" ps backend 2>/dev/null | grep -q "(healthy)"; then
    echo "Backend is healthy."
    break
  fi
  if [ "$i" -eq 18 ]; then
    echo "WARN: Backend not healthy — check: ${COMPOSE[*]} logs backend --tail 80"
    exit 1
  fi
  sleep 5
done

echo "Applying any pending Prisma migrations on imported DB..."
"${COMPOSE[@]}" exec -T backend npx prisma migrate deploy

echo ""
echo "=== DB replace complete ==="
echo "Verify concerns: curl -s http://127.0.0.1:4000/v1/storefront-mock/concerns | head -c 200"
echo "Shop: http://$(hostname -I 2>/dev/null | awk '{print $1}'):${SHOP_PORT:-8080}/"
