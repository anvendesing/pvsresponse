#!/bin/bash
# NovaERP - Nightly PostgreSQL backup script.
#
# Runs on the VPS HOST (not inside a container) via cron.
# Uses `docker exec` to invoke pg_dump inside the postgres container.
#
# Schedule (add to crontab -e on the VPS):
#   0 2 * * *  /opt/pvs/scripts/pg-backup.sh >> /var/log/novaerp-backup.log 2>&1
#
# Prerequisites:
#   - Docker Compose stack running (postgres container healthy)
#   - /opt/backups directory exists and is writable
#
# Restore:
#   docker exec -i novaerp-postgres-1 pg_restore \
#     -U novaerp -d novaerp --clean --if-exists \
#     < /opt/backups/novaerp-YYYY-MM-DD.dump
#
set -euo pipefail

BACKUP_DIR="${NOVAERP_BACKUP_DIR:-/opt/backups}"
RETAIN_DAYS="${NOVAERP_BACKUP_RETAIN_DAYS:-14}"
CONTAINER="${NOVAERP_PG_CONTAINER:-novaerp-postgres-1}"
PG_USER="${NOVAERP_PG_USER:-novaerp}"
PG_DB="${NOVAERP_PG_DB:-novaerp}"

DATE=$(date +%F)
DUMP_FILE="${BACKUP_DIR}/novaerp-${DATE}.dump"

mkdir -p "$BACKUP_DIR"

echo "[$(date -Iseconds)] Starting backup → ${DUMP_FILE}"

# Dump in custom Postgres format (compressed, parallel-restorable)
docker exec "$CONTAINER" pg_dump -U "$PG_USER" -Fc "$PG_DB" > "$DUMP_FILE"

SIZE=$(du -sh "$DUMP_FILE" | cut -f1)
echo "[$(date -Iseconds)] Backup complete: ${DUMP_FILE} (${SIZE})"

# Prune backups older than RETAIN_DAYS
PRUNED=$(find "$BACKUP_DIR" -name 'novaerp-*.dump' -mtime "+${RETAIN_DAYS}" -print -delete | wc -l)
if [ "$PRUNED" -gt 0 ]; then
  echo "[$(date -Iseconds)] Pruned ${PRUNED} backup(s) older than ${RETAIN_DAYS} days."
fi
