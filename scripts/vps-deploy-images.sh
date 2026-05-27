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
echo "=== Step 5: Apply imageUrl patch via Node/Prisma (no sqlite3 needed) ==="
# Use the seed script already compiled into dist/ — idempotent, safe to re-run
docker exec "$CONTAINER" node dist/scripts/seed-image-urls.js

echo ""
echo "=== Verification ==="
echo -n "Images in container: "
docker exec "$CONTAINER" sh -c "ls /app/uploads/products/*.jpg 2>/dev/null | wc -l"

echo -n "Products with imageUrl in DB: "
docker exec "$CONTAINER" node -e "
const {PrismaClient}=require('@prisma/client');
const db=new PrismaClient();
db.product.count({where:{imageUrl:{not:null}}})
  .then(n=>{console.log(n);db.\$disconnect();});"

echo ""
echo "=== Done! Test image URL: ==="
echo "curl -I http://localhost:8080/uploads/products/I61.jpg"
