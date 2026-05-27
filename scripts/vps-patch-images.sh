#!/bin/bash
# Run this script ON THE VPS to immediately fix product images without
# waiting for a full CI redeploy.
#
# Usage:  bash vps-patch-images.sh
#
# What it does:
#   1. Finds the running backend container
#   2. Copies the product images from the git repo into the container
#   3. Runs a SQLite UPDATE to set imageUrl for all 144 matched products

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER=$(docker ps --filter "name=backend" --format "{{.Names}}" | head -1)

if [ -z "$CONTAINER" ]; then
  echo "ERROR: No backend container found. Is the stack running?"
  exit 1
fi

echo "Backend container: $CONTAINER"

# ── 1. Copy images into the container ───────────────────────────────────────
IMG_SRC="$REPO_DIR/backend/uploads/products"
if [ ! -d "$IMG_SRC" ] || [ -z "$(ls -A $IMG_SRC 2>/dev/null)" ]; then
  echo "ERROR: No images found in $IMG_SRC"
  exit 1
fi

IMG_COUNT=$(ls "$IMG_SRC" | wc -l)
echo "Copying $IMG_COUNT images into $CONTAINER:/app/uploads/products/ ..."
docker exec "$CONTAINER" mkdir -p /app/uploads/products
for f in "$IMG_SRC"/*.jpg "$IMG_SRC"/*.jpeg "$IMG_SRC"/*.png 2>/dev/null; do
  [ -f "$f" ] || continue
  docker cp "$f" "$CONTAINER:/app/uploads/products/"
done
echo "Images copied."

# ── 2. Update the database inside the container ──────────────────────────────
echo "Updating Product.imageUrl in the database ..."
docker exec "$CONTAINER" node -e "
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const MAP = $(python3 -c "
import sqlite3, json
conn = sqlite3.connect('$REPO_DIR/backend/prisma/dev.db')
cur = conn.cursor()
cur.execute('SELECT sku, imageUrl FROM Product WHERE imageUrl IS NOT NULL ORDER BY sku')
rows = cur.fetchall()
conn.close()
print(json.dumps(dict(rows)))
");
async function run() {
  let updated = 0;
  for (const [sku, imageUrl] of Object.entries(MAP)) {
    const r = await db.product.updateMany({ where: { sku, imageUrl: null }, data: { imageUrl } });
    if (r.count) updated++;
  }
  console.log('Updated:', updated, 'products');
  await db.\$disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
"

echo ""
echo "Done! Verify: curl -I http://localhost:8080/uploads/products/I61.jpg"
