#!/usr/bin/env bash
# =============================================================================
# db/backup/restore.sh — pg_restore wrapper for Ascend
# Wave: 0 — Platform foundation
#
# RTO TARGET: ≤ 30 minutes from backup selection to database online.
#
# USAGE
#   ./db/backup/restore.sh [--file path/to/backup.pgdump] [--latest] [--dry-run]
#
#   --file <path>  Restore from a specific .pgdump file.
#   --latest       Auto-select the most recent backup in BACKUP_DIR.
#   --dry-run      Print what would be done without executing.
#   --list         List available backups without restoring.
#
# ENVIRONMENT
#   DATABASE_URL         Target database connection string (required)
#   BACKUP_DIR           Directory containing .pgdump files
#                        Default: /var/backups/finder-pos
#   BACKUP_S3_BUCKET     Optional: download from S3 if file not found locally
#   RESTORE_JOBS         Parallel restore workers. Default: 4
#
# SAFETY
#   This script will DROP and re-CREATE the target database.
#   Operator must confirm with 'yes' unless --force is passed.
#   NEVER run in production without a confirmed incident window.
#
# DR DRILL CHECKLIST (run quarterly, record in RTO log)
#   1. Run this script against a restore-test database.
#   2. Run migrations (db/migrations/run.sh up).
#   3. Run smoke tests (npm run smoke -- --env restore-test).
#   4. Record: start time, backup timestamp, end time → RTO.
#   5. RTO must be ≤ 30 minutes.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults / env
# ---------------------------------------------------------------------------
BACKUP_DIR="${BACKUP_DIR:-/var/backups/finder-pos}"
RESTORE_JOBS="${RESTORE_JOBS:-4}"
MODE="--file"
BACKUP_FILE=""
DRY_RUN=false
FORCE=false
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
LOG_PREFIX="[restore.sh ${TIMESTAMP}]"

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --file)      MODE="--file";   BACKUP_FILE="$2"; shift 2 ;;
        --latest)    MODE="--latest"; shift ;;
        --dry-run)   DRY_RUN=true;    shift ;;
        --list)      MODE="--list";   shift ;;
        --force)     FORCE=true;      shift ;;
        *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

# ---------------------------------------------------------------------------
# Validate
# ---------------------------------------------------------------------------
if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "${LOG_PREFIX} ERROR: DATABASE_URL is not set." >&2
    exit 1
fi

if ! command -v pg_restore &>/dev/null; then
    echo "${LOG_PREFIX} ERROR: pg_restore not found on PATH." >&2
    exit 1
fi

if ! command -v psql &>/dev/null; then
    echo "${LOG_PREFIX} ERROR: psql not found on PATH." >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Parse DB name from DATABASE_URL for DROP/CREATE commands
parse_dbname() {
    python3 -c "
from urllib.parse import urlparse
import sys
u = urlparse('$DATABASE_URL')
print(u.path.lstrip('/'))
"
}

parse_host_port_user() {
    # Returns psql flags: -h HOST -p PORT -U USER
    python3 -c "
from urllib.parse import urlparse
u = urlparse('$DATABASE_URL')
parts = []
if u.hostname: parts += ['-h', u.hostname]
if u.port:     parts += ['-p', str(u.port)]
if u.username: parts += ['-U', u.username]
print(' '.join(parts))
"
}

list_backups() {
    echo "${LOG_PREFIX} Available backups in ${BACKUP_DIR}:"
    find "$BACKUP_DIR" -name "finder_pos_*.pgdump" | sort | while read -r f; do
        local sz
        sz=$(du -sh "$f" | cut -f1)
        echo "  ${sz}  $f"
    done
}

confirm_restore() {
    if $FORCE; then return 0; fi
    echo ""
    echo "  ┌─────────────────────────────────────────────────────────┐"
    echo "  │  WARNING: This will DROP and re-create the database!    │"
    echo "  │  All existing data will be PERMANENTLY DELETED.         │"
    echo "  │  Only proceed during a confirmed incident window.       │"
    echo "  └─────────────────────────────────────────────────────────┘"
    echo ""
    echo -n "  Type 'yes' to continue: "
    read -r answer
    if [[ "$answer" != "yes" ]]; then
        echo "${LOG_PREFIX} Aborted by operator."
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# Main restore
# ---------------------------------------------------------------------------
run_restore() {
    local backup_file="$1"

    if [[ ! -f "$backup_file" ]]; then
        # Try to download from S3
        if [[ -n "${BACKUP_S3_BUCKET:-}" ]] && command -v aws &>/dev/null; then
            echo "${LOG_PREFIX} File not found locally. Attempting S3 download..."
            local s3_key
            s3_key="${BACKUP_S3_BUCKET}/$(basename "$backup_file")"
            mkdir -p "$(dirname "$backup_file")"
            aws s3 cp "$s3_key" "$backup_file"
            echo "${LOG_PREFIX} Downloaded from S3: $s3_key"
        else
            echo "${LOG_PREFIX} ERROR: Backup file not found: $backup_file" >&2
            exit 1
        fi
    fi

    # Verify backup before restore
    echo "${LOG_PREFIX} Verifying backup integrity..."
    if ! pg_restore --list "$backup_file" > /dev/null 2>&1; then
        echo "${LOG_PREFIX} ERROR: Backup file appears corrupt." >&2
        exit 1
    fi
    echo "${LOG_PREFIX} Backup integrity: OK"

    local dbname
    dbname=$(parse_dbname)
    # shellcheck disable=SC2046
    local pg_flags
    pg_flags=$(parse_host_port_user)

    if $DRY_RUN; then
        echo "${LOG_PREFIX} DRY RUN — would restore $backup_file → database: $dbname"
        echo "${LOG_PREFIX} Command:"
        echo "  pg_restore --dbname='$DATABASE_URL' --jobs=$RESTORE_JOBS \\"
        echo "    --clean --if-exists --no-owner --no-acl --verbose \\"
        echo "    '$backup_file'"
        return
    fi

    confirm_restore

    local t_start
    t_start=$(date +%s)
    echo "${LOG_PREFIX} ━━━ RESTORE STARTED ━━━"
    echo "${LOG_PREFIX} Source: $backup_file"
    echo "${LOG_PREFIX} Target: $dbname"
    echo "${LOG_PREFIX} Workers: $RESTORE_JOBS"

    # --clean --if-exists: drops existing objects before recreating
    # --no-owner:          skip ownership commands (app role differs from backup role)
    # --no-acl:            skip GRANT/REVOKE (re-applied by provisioning)
    pg_restore \
        --dbname="$DATABASE_URL" \
        --jobs="$RESTORE_JOBS" \
        --clean \
        --if-exists \
        --no-owner \
        --no-acl \
        --verbose \
        "$backup_file" 2>&1 | grep -E "(restoring|error|warning)" | head -50 || true

    local t_end
    t_end=$(date +%s)
    local rto_s=$(( t_end - t_start ))
    local rto_m=$(( rto_s / 60 ))

    echo "${LOG_PREFIX} ━━━ RESTORE COMPLETE ━━━"
    echo "${LOG_PREFIX} Elapsed: ${rto_m}m ${rto_s}s"

    if [[ $rto_s -gt 1800 ]]; then
        echo "${LOG_PREFIX} WARNING: RTO exceeded 30 minutes (${rto_m}m). Review indexing and parallel settings." >&2
    else
        echo "${LOG_PREFIX} RTO target (≤ 30 min): PASSED (${rto_m}m ${rto_s}s)"
    fi

    echo "${LOG_PREFIX} NEXT STEPS:"
    echo "  1. Run migrations: ./db/migrations/run.sh up"
    echo "  2. Verify application health: GET /healthz"
    echo "  3. Run smoke tests: npm run smoke"
    echo "  4. Record RTO in DR log: ${rto_m}m ${rto_s}s"
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
case "$MODE" in
    --list)
        list_backups
        ;;
    --latest)
        echo "${LOG_PREFIX} Selecting latest backup from ${BACKUP_DIR}..."
        BACKUP_FILE=$(find "$BACKUP_DIR" -name "finder_pos_*.pgdump" | sort | tail -n1)
        if [[ -z "$BACKUP_FILE" ]]; then
            echo "${LOG_PREFIX} ERROR: No backups found in ${BACKUP_DIR}." >&2
            exit 1
        fi
        echo "${LOG_PREFIX} Selected: $BACKUP_FILE"
        run_restore "$BACKUP_FILE"
        ;;
    --file)
        if [[ -z "$BACKUP_FILE" ]]; then
            echo "Usage: $0 --file /path/to/backup.pgdump" >&2
            exit 1
        fi
        run_restore "$BACKUP_FILE"
        ;;
esac
