#!/bin/sh
set -e

# Fresh named volumes are root-owned; the app runs as `node` (uid 1000)
# and SQLite needs write access to /data and /app/uploads.
if [ -d /data ]; then
  chown -R node:node /data 2>/dev/null || true
fi
if [ -d /app/uploads ]; then
  chown -R node:node /app/uploads 2>/dev/null || true
fi

# Seed product + category images into the uploads volume on first boot.
# /app/uploads-seed/ is baked into the image from git; the volume
# at /app/uploads starts empty the very first time, so we copy the
# seed across once. On subsequent boots the volume already has files
# and we skip this step (preserving any images added post-deploy).
SEED_DIR=/app/uploads-seed
if [ -d "$SEED_DIR" ]; then
  # Products
  DEST_DIR=/app/uploads/products
  mkdir -p "$DEST_DIR"
  chown -R node:node "$DEST_DIR" 2>/dev/null || true
  SEED_COUNT=$(find "$SEED_DIR/products" -type f 2>/dev/null | wc -l)
  DEST_COUNT=$(find "$DEST_DIR" -type f 2>/dev/null | wc -l)
  if [ "$SEED_COUNT" -gt 0 ] && [ "$DEST_COUNT" -lt "$SEED_COUNT" ]; then
    echo "[entrypoint] Seeding $SEED_COUNT product images into $DEST_DIR ..."
    cp -n "$SEED_DIR"/products/* "$DEST_DIR"/ 2>/dev/null || true
    echo "[entrypoint] Product seed complete."
  fi

  # Categories
  CAT_DEST=/app/uploads/categories
  mkdir -p "$CAT_DEST"
  chown -R node:node "$CAT_DEST" 2>/dev/null || true
  CAT_SEED_COUNT=$(find "$SEED_DIR/categories" -type f 2>/dev/null | wc -l)
  CAT_DEST_COUNT=$(find "$CAT_DEST" -type f 2>/dev/null | wc -l)
  if [ "$CAT_SEED_COUNT" -gt 0 ] && [ "$CAT_DEST_COUNT" -lt "$CAT_SEED_COUNT" ]; then
    echo "[entrypoint] Seeding $CAT_SEED_COUNT category images into $CAT_DEST ..."
    cp -n "$SEED_DIR"/categories/* "$CAT_DEST"/ 2>/dev/null || true
    echo "[entrypoint] Category seed complete."
  fi
fi

exec su-exec node sh -c "\
  npx prisma migrate deploy && \
  node dist/scripts/seed-product-categories.js && \
  node dist/scripts/seed-image-urls.js && \
  node dist/scripts/seed-category-images.js && \
  (test -f /app/data/categories-and-products.xlsx && node dist/scripts/import-categories-xlsx.js /app/data/categories-and-products.xlsx || true) && \
  (test -f /app/data/shop-by-concerns-mapping.xlsx && node dist/scripts/import-concerns-xlsx.js /app/data/shop-by-concerns-mapping.xlsx || true) && \
  node dist/index.js"
