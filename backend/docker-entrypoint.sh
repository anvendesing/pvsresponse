#!/bin/sh
set -e

# Fresh named volumes are root-owned; the app runs as `node` (uid 1000)
# and SQLite needs write access to /data.
if [ -d /data ]; then
  chown -R node:node /data 2>/dev/null || true
fi

exec su-exec node sh -c "npx prisma migrate deploy && node dist/index.js"
