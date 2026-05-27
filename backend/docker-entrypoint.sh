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

# Seed product images into the uploads volume on first boot.
# /app/uploads-seed/ is baked into the image from git; the volume
# at /app/uploads starts empty the very first time, so we copy the
# seed across once. On subsequent boots the volume already has files
# and we skip this step (preserving any images added post-deploy).
SEED_DIR=/app/uploads-seed
DEST_DIR=/app/uploads/products
if [ -d "$SEED_DIR" ]; then
  mkdir -p "$DEST_DIR"
  chown -R node:node "$DEST_DIR" 2>/dev/null || true
  SEED_COUNT=$(find "$SEED_DIR" -type f | wc -l)
  DEST_COUNT=$(find "$DEST_DIR" -type f 2>/dev/null | wc -l)
  if [ "$SEED_COUNT" -gt 0 ] && [ "$DEST_COUNT" -lt "$SEED_COUNT" ]; then
    echo "[entrypoint] Seeding $SEED_COUNT product images into $DEST_DIR ..."
    cp -n "$SEED_DIR"/products/* "$DEST_DIR"/ 2>/dev/null || true
    echo "[entrypoint] Seed complete."
  fi
fi

exec su-exec node sh -c "npx prisma migrate deploy && node dist/scripts/seed-image-urls.js && node dist/index.js"
