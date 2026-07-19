#!/usr/bin/env bash
# =============================================================================
# db/migrations/run.sh — Migration runner for Ascend
# Wave: 0 — Platform foundation
#
# USAGE
#   ./db/migrations/run.sh [up|down] [migration_number]
#
#   ./db/migrations/run.sh          # apply all pending forward migrations
#   ./db/migrations/run.sh up       # same as above
#   ./db/migrations/run.sh up 0002  # apply only 0002_*.sql
#   ./db/migrations/run.sh down 0001 # roll back 0001_*.down.sql
#
# REQUIREMENTS
#   • psql available on PATH
#   • $DATABASE_URL set, e.g.:
#       postgresql://app_user:secret@localhost:5432/finder_pos
#   • No extra npm/node dependency — pure bash + psql.
#
# DESIGN
#   • Migrations are applied in lexicographic filename order (NNNN prefix).
#   • A migrations_applied table tracks what has already run (idempotent).
#   • Each migration runs in a single transaction; on error the transaction
#     rolls back and the script exits non-zero.
#   • Environment variables DATABASE_URL, PGPASSWORD, PGSSLMODE are respected.
#
# SECURITY
#   • Never echo DATABASE_URL (may contain password).
#   • Exit immediately on any error (set -e).
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIRECTION="${1:-up}"
TARGET="${2:-}"   # optional: specific migration number e.g. "0001"

# ---------------------------------------------------------------------------
# Validate prerequisites
# ---------------------------------------------------------------------------
if ! command -v psql &>/dev/null; then
    echo "ERROR: psql not found on PATH. Install PostgreSQL client tools." >&2
    exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "ERROR: DATABASE_URL is not set." >&2
    echo "  Export it, e.g.:  export DATABASE_URL=postgresql://user:pass@host/db" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# Bootstrap: ensure tracking table exists
# ---------------------------------------------------------------------------
psql "$DATABASE_URL" --no-psqlrc -q <<'SQL'
CREATE TABLE IF NOT EXISTS migrations_applied (
    filename    TEXT    PRIMARY KEY,
    applied_at  BIGINT  NOT NULL   -- epoch ms
);
SQL

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
epoch_ms() {
    # Portable: works on Linux (date +%s%3N) and macOS (python fallback)
    if date +%s%3N &>/dev/null 2>&1 && [[ "$(date +%s%3N)" =~ ^[0-9]+$ ]]; then
        date +%s%3N
    else
        python3 -c "import time; print(int(time.time()*1000))"
    fi
}

is_applied() {
    local fname="$1"
    local count
    # -v + :'fname' (psql's own variable-substitution syntax) quotes the value
    # as a SQL string literal, correctly escaping embedded quotes — not raw
    # shell interpolation into the query text. filenames here always come from
    # db/migrations/*.sql (CODEOWNERS-gated, not attacker input), so practical
    # risk was low, but the string-splicing shape itself is worth not having.
    # Verified: `:'var'` substitution only fires in psql's script-parsing mode
    # (stdin/-f), NOT with -c (confirmed empirically against a real Postgres —
    # -c passes the text through more directly and errors on bare `:`), so
    # these use a heredoc via stdin instead of -c.
    count=$(psql "$DATABASE_URL" --no-psqlrc -t -q -v fname="$fname" <<'SQL' | tr -d '[:space:]'
SELECT COUNT(*) FROM migrations_applied WHERE filename = :'fname';
SQL
    )
    [[ "$count" -gt 0 ]]
}

mark_applied() {
    local fname="$1"
    local ts
    ts=$(epoch_ms)
    psql "$DATABASE_URL" --no-psqlrc -q -v fname="$fname" -v ts="$ts" <<'SQL'
INSERT INTO migrations_applied (filename, applied_at) VALUES (:'fname', :'ts') ON CONFLICT DO NOTHING;
SQL
}

unmark_applied() {
    local fname="$1"
    psql "$DATABASE_URL" --no-psqlrc -q -v fname="$fname" <<'SQL'
DELETE FROM migrations_applied WHERE filename = :'fname';
SQL
}

run_sql_file() {
    local filepath="$1"
    local fname
    fname=$(basename "$filepath")
    echo "  → Applying $fname"
    # Run in a transaction; psql will exit non-zero if any statement fails.
    psql "$DATABASE_URL" --no-psqlrc -q \
        --single-transaction \
        -v ON_ERROR_STOP=1 \
        -f "$filepath"
}

# ---------------------------------------------------------------------------
# UP: apply forward migrations
# ---------------------------------------------------------------------------
apply_up() {
    echo "[run.sh] Direction: UP"

    # Collect *.sql files (forward migrations, NOT *.down.sql), sorted
    local files=()
    while IFS= read -r -d '' f; do
        files+=("$f")
    done < <(find "$SCRIPT_DIR" -maxdepth 1 -name "*.sql" \
                ! -name "*.down.sql" \
                -print0 | sort -z)

    if [[ ${#files[@]} -eq 0 ]]; then
        echo "  No migration files found in $SCRIPT_DIR"
        exit 0
    fi

    local applied_count=0
    for filepath in "${files[@]}"; do
        local fname
        fname=$(basename "$filepath")

        # Filter by target number if specified
        if [[ -n "$TARGET" ]] && [[ "$fname" != ${TARGET}* ]]; then
            continue
        fi

        if is_applied "$fname"; then
            echo "  ✓ Already applied: $fname"
            continue
        fi

        run_sql_file "$filepath"
        mark_applied "$fname"
        echo "  ✓ Applied: $fname"
        (( applied_count++ ))
    done

    if [[ $applied_count -eq 0 ]]; then
        echo "  Nothing to apply — database is up to date."
    else
        echo "[run.sh] Applied $applied_count migration(s)."
    fi
}

# ---------------------------------------------------------------------------
# DOWN: roll back a specific migration
# ---------------------------------------------------------------------------
apply_down() {
    if [[ -z "$TARGET" ]]; then
        echo "ERROR: 'down' requires a migration number, e.g.:" >&2
        echo "  ./db/migrations/run.sh down 0001" >&2
        exit 1
    fi

    echo "[run.sh] Direction: DOWN (target: $TARGET)"

    local downfile
    downfile=$(find "$SCRIPT_DIR" -maxdepth 1 -name "${TARGET}*.down.sql" | sort | head -n1)

    if [[ -z "$downfile" ]]; then
        echo "ERROR: No rollback file found matching '${TARGET}*.down.sql'" >&2
        exit 1
    fi

    local fname
    fname=$(basename "$downfile")

    run_sql_file "$downfile"
    unmark_applied "${fname%.down.sql}.sql"   # remove the forward migration record
    echo "  ✓ Rolled back: $fname"
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
case "$DIRECTION" in
    up)   apply_up   ;;
    down) apply_down ;;
    *)
        echo "ERROR: Unknown direction '$DIRECTION'. Use 'up' or 'down'." >&2
        exit 1
        ;;
esac
