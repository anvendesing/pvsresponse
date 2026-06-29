#!/bin/sh
set -e

# Wait for Postgres to be ready before running migrations.
# DATABASE_URL is postgresql://user:pass@host:port/db?schema=public
# Extract host and user from the URL for pg_isready.
if [ -n "${DATABASE_URL:-}" ]; then
  case "$DATABASE_URL" in
    postgresql://*|postgres://*)
      # Parse host from URL (between @ and :port or / )
      PG_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+).*|\1|')
      PG_USER=$(echo "$DATABASE_URL" | sed -E 's|.*://([^:@]+).*|\1|')
      PG_DB=$(echo "$DATABASE_URL" | sed -E 's|.*/([^?]+).*|\1|')
      echo "[entrypoint] Waiting for Postgres at ${PG_HOST} (user=${PG_USER} db=${PG_DB})..."
      ATTEMPTS=0
      until pg_isready -h "$PG_HOST" -U "$PG_USER" -d "$PG_DB" -q 2>/dev/null; do
        ATTEMPTS=$((ATTEMPTS + 1))
        if [ "$ATTEMPTS" -ge 60 ]; then
          echo "[entrypoint] ERROR: Postgres not ready after 60s — aborting."
          exit 1
        fi
        sleep 1
      done
      echo "[entrypoint] Postgres is ready."
      ;;
  esac
fi

# Fresh named volumes are root-owned; the app runs as `node` (uid 1000)
# and uploads needs write access.
if [ -d /app/uploads ]; then
  chown -R node:node /app/uploads 2>/dev/null || true
fi

# Seed product + category images into the uploads volume on first boot.
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
