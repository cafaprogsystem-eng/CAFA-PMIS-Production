#!/usr/bin/env bash
# =============================================================================
# CAFA PMIS — PostgreSQL Backup Script
# Supports daily, weekly, and monthly retention with compression.
# Usage: ./scripts/backup.sh [daily|weekly|monthly]
# =============================================================================

set -euo pipefail

BACKUP_TYPE="${1:-daily}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/cafa-pmis}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DATE_TAG=$(date +"%Y%m%d")

RETAIN_DAILY=7
RETAIN_WEEKLY=4
RETAIN_MONTHLY=12

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[ERROR] DATABASE_URL environment variable is not set." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/monthly"

BACKUP_FILE="$BACKUP_DIR/$BACKUP_TYPE/cafa_pmis_${BACKUP_TYPE}_${TIMESTAMP}.dump"
LOG_FILE="$BACKUP_DIR/backup.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log "Starting $BACKUP_TYPE backup → $BACKUP_FILE"

pg_dump \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --compress=9 \
  --no-acl \
  --no-owner \
  --file="$BACKUP_FILE"

BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
log "Backup complete: $BACKUP_FILE ($BACKUP_SIZE)"

# Verify the dump is valid (check object count)
OBJECT_COUNT=$(pg_restore --list "$BACKUP_FILE" 2>/dev/null | wc -l)
if [[ "$OBJECT_COUNT" -lt 10 ]]; then
  log "[ERROR] Backup validation failed — object count suspiciously low ($OBJECT_COUNT). Keeping file for inspection."
  exit 2
fi
log "Validation OK — $OBJECT_COUNT objects in backup"

# ── Retention Cleanup ────────────────────────────────────────────────────────
purge_old() {
  local dir="$1"
  local keep="$2"
  local count
  count=$(ls -1t "$dir"/cafa_pmis_*.dump 2>/dev/null | wc -l)
  if [[ "$count" -gt "$keep" ]]; then
    ls -1t "$dir"/cafa_pmis_*.dump | tail -n +"$((keep + 1))" | xargs -r rm -v
    log "Purged old backups in $dir (kept $keep)"
  fi
}

case "$BACKUP_TYPE" in
  daily)   purge_old "$BACKUP_DIR/daily"   "$RETAIN_DAILY"   ;;
  weekly)  purge_old "$BACKUP_DIR/weekly"  "$RETAIN_WEEKLY"  ;;
  monthly) purge_old "$BACKUP_DIR/monthly" "$RETAIN_MONTHLY" ;;
esac

# ── Create symlink to latest backup ─────────────────────────────────────────
LATEST_LINK="$BACKUP_DIR/latest_${BACKUP_TYPE}.dump"
ln -sf "$BACKUP_FILE" "$LATEST_LINK"
log "Symlink updated: $LATEST_LINK → $BACKUP_FILE"

log "Backup job finished successfully."
