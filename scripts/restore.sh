#!/usr/bin/env bash
# =============================================================================
# CAFA PMIS — PostgreSQL Restore Script
# Usage: ./scripts/restore.sh [backup_file_path]
#        If no file is given, lists available backups and prompts interactively.
# =============================================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/cafa-pmis}"
LOG_FILE="$BACKUP_DIR/restore.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[ERROR] DATABASE_URL environment variable is not set." >&2
  exit 1
fi

# ── Select backup file ───────────────────────────────────────────────────────
if [[ -n "${1:-}" ]]; then
  BACKUP_FILE="$1"
else
  echo ""
  echo "Available backups (newest first):"
  echo "─────────────────────────────────────────────────────────────"
  mapfile -t FILES < <(ls -1t "$BACKUP_DIR"/daily/cafa_pmis_*.dump \
                            "$BACKUP_DIR"/weekly/cafa_pmis_*.dump \
                            "$BACKUP_DIR"/monthly/cafa_pmis_*.dump 2>/dev/null)
  if [[ ${#FILES[@]} -eq 0 ]]; then
    echo "[ERROR] No backup files found in $BACKUP_DIR" >&2
    exit 1
  fi
  for i in "${!FILES[@]}"; do
    SIZE=$(du -sh "${FILES[$i]}" | cut -f1)
    echo "  [$((i+1))] ${FILES[$i]} ($SIZE)"
  done
  echo "─────────────────────────────────────────────────────────────"
  read -rp "Select backup number (or press Ctrl-C to abort): " CHOICE
  BACKUP_FILE="${FILES[$((CHOICE-1))]}"
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "[ERROR] Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

# ── Validate the backup before restoring ────────────────────────────────────
log "Validating backup: $BACKUP_FILE"
OBJECT_COUNT=$(pg_restore --list "$BACKUP_FILE" 2>/dev/null | wc -l)
if [[ "$OBJECT_COUNT" -lt 10 ]]; then
  log "[ERROR] Backup validation failed — only $OBJECT_COUNT objects found. Aborting."
  exit 2
fi
log "Backup valid: $OBJECT_COUNT objects"

# ── Confirm before proceeding ────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  WARNING: This will DROP and recreate the public schema."
echo "  All existing data will be permanently deleted."
echo ""
echo "  Backup file : $BACKUP_FILE"
echo "  Database    : $(echo "$DATABASE_URL" | sed 's|.*@||')"
echo "══════════════════════════════════════════════════════════════"
read -rp "Type YES (all caps) to confirm restore: " CONFIRM
if [[ "$CONFIRM" != "YES" ]]; then
  echo "Aborted — no changes made."
  exit 0
fi

log "Starting restore from: $BACKUP_FILE"

# Drop public schema cleanly, then restore
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" 2>&1 | tee -a "$LOG_FILE"

pg_restore \
  --dbname="$DATABASE_URL" \
  --no-acl \
  --no-owner \
  --single-transaction \
  --exit-on-error \
  "$BACKUP_FILE" 2>&1 | tee -a "$LOG_FILE"

log "Restore complete. Running post-restore validation…"

# ── Post-restore row count validation ────────────────────────────────────────
CHECKS=(
  "users"
  "projects"
  "reports"
  "risks"
  "plans"
  "states"
  "notifications"
)

echo ""
echo "Post-restore row counts:"
echo "─────────────────────────────────────────────────────────────"
for TABLE in "${CHECKS[@]}"; do
  COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM $TABLE" 2>/dev/null | tr -d ' ')
  echo "  $TABLE: $COUNT rows"
  log "  $TABLE: $COUNT rows"
done
echo "─────────────────────────────────────────────────────────────"

log "Restore job finished. Review row counts above for sanity check."
echo ""
echo "Restore complete. CAFA PMIS is ready."
