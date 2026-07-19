#!/usr/bin/env bash
# =============================================================================
# scripts/db-setup.sh — seed a Supabase (or any Postgres) database for Ascend.
#
# IMPORTANT — how schema is created (see db/README.md):
#   The backend provisions its OWN schema on boot (advisory-locked, hash-tracked
#   in `schema_migrations`, see src/app.ts). You do NOT run db/migrations/run.sh
#   for this — that path is the parallel "SQL of record" and has drifted from the
#   app's live schema (UUID vs TEXT tenant_id), so running it first CONFLICTS.
#
# Correct order for a fresh database:
#   1. Put the connection string in .env  (DATABASE_URL=…)
#   2. npm run dev            # boots the backend → provisions all 170+ tables
#   3. ALLOW_DEMO_SEED=1 npm run db:setup   # this script — seeds the demo tenant
#
# The seed itself is gated by ALLOW_DEMO_SEED=1 so it can never run by accident
# against a real database.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env}"
if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: $ENV_FILE not found. Create it and set DATABASE_URL (see .env.example)." >&2
    exit 1
fi

# Extract DATABASE_URL literally (keep everything after the first '=' so ':@/?&'
# in the connection string survive; never `source` the file).
DATABASE_URL="$(grep -E '^[[:space:]]*DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
DATABASE_URL="${DATABASE_URL%\"}"; DATABASE_URL="${DATABASE_URL#\"}"
export DATABASE_URL
export PGSSLMODE="${PGSSLMODE:-require}"

if [[ -z "$DATABASE_URL" ]]; then
    echo "ERROR: DATABASE_URL is empty in $ENV_FILE." >&2
    exit 1
fi

host="$(printf '%s' "$DATABASE_URL" | sed -E 's#.*@([^/:]+).*#\1#')"
echo "[db-setup] Target: $host"

# Guard: the schema must already exist (created by a backend boot). If the core
# tables are missing, the app hasn't provisioned yet — seeding would fail.
have_schema="$(psql "$DATABASE_URL" --no-psqlrc -tAc \
    "select to_regclass('public.users') is not null and to_regclass('public.categories') is not null" 2>/dev/null || echo f)"
if [[ "$have_schema" != "t" ]]; then
    echo "ERROR: schema not provisioned yet (public.users / public.categories missing)." >&2
    echo "  Boot the backend once first so it creates the schema:  npm run dev" >&2
    echo "  Then re-run:  ALLOW_DEMO_SEED=1 npm run db:setup" >&2
    exit 1
fi

echo "[db-setup] Seeding demo tenant…"
npx tsx scripts/seed-demo.ts

echo "[db-setup] ✓ Done."
