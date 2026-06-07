#!/usr/bin/env bash
# Daily PostgreSQL backup for OntoCenter (ADR-0046)
# Run via host cron: 0 3 * * * /path/to/deploy/backup.sh
#
# Required environment variables:
#   COMPOSE_PROJECT — docker compose project name (default: deploy)
#   PG_CONTAINER    — postgres container name (default: deploy-postgres-1)
#   PG_USER         — postgres user (default: omaha)
#   PG_DB           — database name (default: ontocenter)
#   BACKUP_BUCKET   — OSS/S3 bucket path (e.g. oss://my-bucket/backups)
#   BACKUP_TOOL     — upload tool command (default: ossutil64 cp)
#   RETENTION_DAYS  — days to retain backups (default: 7)

set -euo pipefail

# Configuration with defaults
COMPOSE_PROJECT="${COMPOSE_PROJECT:-deploy}"
PG_CONTAINER="${PG_CONTAINER:-${COMPOSE_PROJECT}-postgres-1}"
PG_USER="${PG_USER:-omaha}"
PG_DB="${PG_DB:-ontocenter}"
BACKUP_BUCKET="${BACKUP_BUCKET:?BACKUP_BUCKET is required (e.g. oss://my-bucket/backups)}"
BACKUP_TOOL="${BACKUP_TOOL:-ossutil64 cp}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

# Timestamp for filename
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="ontocenter_${TIMESTAMP}.dump"
LOCAL_PATH="/tmp/${FILENAME}"

echo "[backup] Starting backup: ${FILENAME}"

# Dump
docker exec "${PG_CONTAINER}" pg_dump \
  --format=custom \
  --username="${PG_USER}" \
  "${PG_DB}" > "${LOCAL_PATH}"

echo "[backup] Dump complete: $(du -h "${LOCAL_PATH}" | cut -f1)"

# Upload
${BACKUP_TOOL} "${LOCAL_PATH}" "${BACKUP_BUCKET}/${FILENAME}"
echo "[backup] Uploaded to ${BACKUP_BUCKET}/${FILENAME}"

# Cleanup local
rm -f "${LOCAL_PATH}"

# Rotate old backups (delete files older than RETENTION_DAYS)
# This assumes the upload tool supports ls + rm. For ossutil64:
if command -v ossutil64 &> /dev/null; then
  CUTOFF=$(date -d "-${RETENTION_DAYS} days" +%Y%m%d 2>/dev/null || date -v-${RETENTION_DAYS}d +%Y%m%d)
  ossutil64 ls "${BACKUP_BUCKET}/" | grep "ontocenter_" | while read -r line; do
    FILE_DATE=$(echo "$line" | grep -oP 'ontocenter_\K\d{8}' || true)
    if [[ -n "$FILE_DATE" && "$FILE_DATE" < "$CUTOFF" ]]; then
      FILE_PATH=$(echo "$line" | grep -oP 'oss://\S+' || true)
      if [[ -n "$FILE_PATH" ]]; then
        ossutil64 rm "$FILE_PATH" --force
        echo "[backup] Deleted old backup: $FILE_PATH"
      fi
    fi
  done
fi

echo "[backup] Done."
