#!/usr/bin/env bash
# =============================================================================
# db/backup/backup.sh — pg_dump wrapper for Ascend
# Wave: 0 — Platform foundation
#
# DESIGN GOALS
#   RPO ≤ 5 minutes  — run via cron every 5 minutes (see crontab entry below)
#   RTO ≤ 30 minutes — restore.sh brings DB back within 30 min from any backup
#
# USAGE
#   ./db/backup/backup.sh [--full|--wal-archive|--verify]
#
#   --full        Run a full pg_dump backup (default).
#   --wal-archive Upload current WAL segment (for WAL-G / pgBackRest pipelines).
#   --verify      Verify the latest backup file is readable (spot check).
#
# ENVIRONMENT
#   DATABASE_URL         PostgreSQL connection string (required)
#   BACKUP_DIR           Where to write local backup files
#                        Default: /var/backups/finder-pos
#   BACKUP_S3_BUCKET     Optional: s3://bucket/prefix — uploaded after dump
#   BACKUP_RETENTION_DAYS How many days of local backups to keep. Default: 7
#   PGPASSWORD / .pgpass  Standard PostgreSQL auth env vars
#
# CRONTAB EXAMPLE (RPO ≤ 5 min via WAL archiving; pg_dump every 15 min)
#   */5  * * * *  /path/to/finder-pos/db/backup/backup.sh --wal-archive
#   */15 * * * *  /path/to/finder-pos/db/backup/backup.sh --full
#
# FORMAT
#   pg_dump uses custom format (-Fc) — smallest file, supports selective
#   restore, supports parallel restore (-j N) for faster RTO.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults / env
# ---------------------------------------------------------------------------
BACKUP_DIR="${BACKUP_DIR:-/var/backups/finder-pos}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
MODE="${1:---full}"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
BACKUP_FILE="${BACKUP_DIR}/finder_pos_${TIMESTAMP}.pgdump"
LOG_PREFIX="[backup.sh ${TIMESTAMP}]"

# ---------------------------------------------------------------------------
# Validate
# ---------------------------------------------------------------------------
if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "${LOG_PREFIX} ERROR: DATABASE_URL is not set." >&2
    exit 1
fi

if ! command -v pg_dump &>/dev/null; then
    echo "${LOG_PREFIX} ERROR: pg_dump not found on PATH." >&2
    exit 1
fi

mkdir -p "$BACKUP_DIR"

# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------
run_full_backup() {
    echo "${LOG_PREFIX} Starting full backup → ${BACKUP_FILE}"

    pg_dump \
        "$DATABASE_URL" \
        --format=custom \
        --compress=9 \
        --no-password \
        --verbose \
        --file="${BACKUP_FILE}" 2>&1 | tail -5

    local size
    size=$(du -sh "$BACKUP_FILE" | cut -f1)
    echo "${LOG_PREFIX} Backup complete. Size: ${size}. File: ${BACKUP_FILE}"

    # Upload to S3 if configured
    if [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
        if command -v aws &>/dev/null; then
            echo "${LOG_PREFIX} Uploading to ${BACKUP_S3_BUCKET}..."
            aws s3 cp "$BACKUP_FILE" "${BACKUP_S3_BUCKET}/$(basename "$BACKUP_FILE")" \
                --storage-class STANDARD_IA
            echo "${LOG_PREFIX} Upload complete."
        else
            echo "${LOG_PREFIX} WARNING: BACKUP_S3_BUCKET set but 'aws' CLI not found." >&2
        fi
    fi

    # Purge old local backups
    echo "${LOG_PREFIX} Purging backups older than ${BACKUP_RETENTION_DAYS} days..."
    find "$BACKUP_DIR" -name "finder_pos_*.pgdump" \
        -mtime "+${BACKUP_RETENTION_DAYS}" \
        -exec echo "  Removing: {}" \; \
        -delete
}

run_wal_archive() {
    # Stub for WAL-G / pgBackRest integration.
    # Replace the body with your WAL archiving tool of choice.
    echo "${LOG_PREFIX} WAL archive — not yet configured (stub)."
    echo "${LOG_PREFIX} To enable, integrate WAL-G or pgBackRest and update this function."
    # Example (WAL-G):
    #   wal-g wal-push "$1"
    # Example (pgBackRest):
    #   pgbackrest --stanza=finder-pos archive-push "$1"
}

run_verify() {
    echo "${LOG_PREFIX} Verifying latest backup..."
    local latest
    latest=$(find "$BACKUP_DIR" -name "finder_pos_*.pgdump" | sort | tail -n1)

    if [[ -z "$latest" ]]; then
        echo "${LOG_PREFIX} ERROR: No backup files found in ${BACKUP_DIR}" >&2
        exit 1
    fi

    echo "${LOG_PREFIX} Latest backup: $latest"

    # pg_restore --list does a header check without actually restoring
    if pg_restore --list "$latest" > /dev/null 2>&1; then
        local size
        size=$(du -sh "$latest" | cut -f1)
        echo "${LOG_PREFIX} Verification PASSED. File size: ${size}."
    else
        echo "${LOG_PREFIX} ERROR: Backup file appears corrupt: $latest" >&2
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
case "$MODE" in
    --full)        run_full_backup ;;
    --wal-archive) run_wal_archive ;;
    --verify)      run_verify      ;;
    *)
        echo "Usage: $0 [--full|--wal-archive|--verify]" >&2
        exit 1
        ;;
esac
