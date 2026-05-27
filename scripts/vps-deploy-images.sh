#!/bin/bash
# Run ON THE VPS inside the repo directory to:
#   1. Pull latest code + Docker images from CI
#   2. Restart the stack (entrypoint auto-seeds images + imageUrls)
#   3. If still missing, apply the SQL patch directly as a fallback
#
# Usage:
#   cd ~/pvsresponse   (or wherever the repo is)
#   bash scripts/vps-deploy-images.sh

set -e
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

echo "=== Step 1: Pull latest code ==="
git pull

echo ""
echo "=== Step 2: Pull latest Docker images from GHCR ==="
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull

echo ""
echo "=== Step 3: Restart stack ==="
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-build

echo ""
echo "Waiting 20s for backend to start and run seed scripts..."
sleep 20

CONTAINER=$(docker ps --filter "name=backend" --format "{{.Names}}" | head -1)
echo "Backend container: $CONTAINER"

echo ""
echo "=== Step 4: Copy images from repo into container (belt + suspenders) ==="
IMG_SRC="$REPO_DIR/backend/uploads/products"
if [ -d "$IMG_SRC" ] && [ "$(ls -A $IMG_SRC 2>/dev/null)" ]; then
    IMG_COUNT=$(ls "$IMG_SRC"/*.jpg 2>/dev/null | wc -l)
    echo "Copying $IMG_COUNT images -> $CONTAINER:/app/uploads/products/"
    docker exec "$CONTAINER" mkdir -p /app/uploads/products
    docker cp "$IMG_SRC/." "$CONTAINER:/app/uploads/products/"
    echo "Images copied."
else
    echo "WARN: No images found in $IMG_SRC — skipping copy"
fi

echo ""
echo "=== Step 5: Apply SQL imageUrl patch directly to DB ==="
SQL_FILE="$REPO_DIR/scripts/patch_image_urls.sql"
if [ -f "$SQL_FILE" ]; then
    # Find the SQLite DB path from DATABASE_URL env, default to /data/dev.db
    DB_PATH=$(docker exec "$CONTAINER" sh -c 'echo ${DATABASE_URL:-file:/data/dev.db}' | sed 's/file://')
    echo "Patching database at $DB_PATH inside $CONTAINER ..."
    docker cp "$SQL_FILE" "$CONTAINER:/tmp/patch_image_urls.sql"
    docker exec "$CONTAINER" sh -c "sqlite3 $DB_PATH < /tmp/patch_image_urls.sql && echo 'SQL patch applied'"
else
    echo "WARN: $SQL_FILE not found — skipping SQL patch"
fi

echo ""
echo "=== Verification ==="
echo -n "Images in container: "
docker exec "$CONTAINER" sh -c "ls /app/uploads/products/*.jpg 2>/dev/null | wc -l"

echo -n "Products with imageUrl in DB: "
DB_PATH=$(docker exec "$CONTAINER" sh -c 'echo ${DATABASE_URL:-file:/data/dev.db}' | sed 's/file://')
docker exec "$CONTAINER" sh -c "sqlite3 $DB_PATH \"SELECT COUNT(*) FROM Product WHERE imageUrl IS NOT NULL\""

echo ""
echo "=== Done! Test image URL: ==="
echo "curl -I http://localhost:8080/uploads/products/I61.jpg"
