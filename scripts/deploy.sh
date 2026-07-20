#!/usr/bin/env bash
# One-command Vercel deploy for Ascend (backend + frontend) from the current
# working tree. These Vercel projects are NOT git-connected, so deploys are
# manual CLI uploads — this script codifies the full, finicky recipe so the live
# site never drifts behind the repo again. Driven by ci.yml's 3-tier pipeline
# (develop → staging → master); also runnable by hand.
#
#   VERCEL_TOKEN=xxx DEPLOY_ENV=prod ./scripts/deploy.sh [backend|frontend|both]
#
# Environment tiers (DEPLOY_ENV):
#   prod     → Vercel Production (--prod). Uses the Production env vars in Vercel
#              (prod Supabase). BACKEND_URL defaults to the prod backend domain.
#   testing  → Vercel Preview. Points at the TESTING backend/DB (Supabase B, the
#              project's stored Preview env vars); aliased to stable staging
#              domains when *_ALIAS set.
#   dev      → Vercel Preview. Own dedicated backend/DB when DATABASE_URL is
#              supplied (overrides the project's stored Preview value for just
#              this deployment via `vercel deploy --env`); falls back to the
#              stored value (same DB as testing) if DATABASE_URL is unset.
#
# Env inputs:
#   VERCEL_TOKEN      (required) Vercel token with team-scope access.
#   DEPLOY_ENV        prod | testing | dev            (default: prod)
#   BACKEND_URL       backend origin the frontend proxies to. Defaults to the
#                     prod domain for prod; REQUIRED for testing/dev so a non-prod
#                     frontend can never silently talk to the prod backend/DB.
#   BACKEND_ALIAS     (optional) stable domain to alias the non-prod backend deploy
#                     to (e.g. ascend-api-staging.vercel.app).
#   FRONTEND_ALIAS    (optional) stable domain to alias the non-prod frontend deploy.
#   NEXT_PUBLIC_MOCK  (optional) frontend mock switch. Defaults to "false" on every
#                     tier now (all tiers run against a real backend). Prod refuses
#                     any value other than "false".
#   DATABASE_URL      (optional, non-prod only) overrides the backend deploy's
#                     database connection for just this deployment, instead of
#                     using the Vercel project's stored Preview value. Lets a
#                     tier (e.g. dev) run against its own database without a
#                     separate Vercel project. Requires PG_SSL=require and
#                     PG_CA_CERT_B64 to also be set if the target DB needs
#                     verified TLS (see src/shared/db.ts sslConfig()).
#   PG_SSL            (optional) passed through alongside DATABASE_URL.
#   PG_CA_CERT_B64    (optional) passed through alongside DATABASE_URL.
#
# Project/team IDs below are not secrets.
set -euo pipefail

TARGET="${1:-both}"
DEPLOY_ENV="${DEPLOY_ENV:-prod}"                  # prod | testing | dev
case "$DEPLOY_ENV" in
  prod)            PROD_FLAG="--prod" ;;          # production alias
  testing|dev)     PROD_FLAG="" ;;                # preview deployment (unique URL)
  *) echo "DEPLOY_ENV must be prod|testing|dev"; exit 1 ;;
esac
TEAM="team_WNp8vBq1RmWTEH8WSnenP7jM"             # gellusricharan-4715s-projects
BACKEND_PID="prj_krZ34CIFjzQrMvZ08PWqqbxzBf7d"    # ascend-backend (rebrand Phase 3; formerly finder-pos-backend — project ID is immutable, never changed)
FRONTEND_PID="prj_TiPX9UYctGKJbQr4Lb1WFwSsKiN1"   # ascend-frontend (formerly finder-pos-frontend — project ID unchanged)
REPO="$(cd "$(dirname "$0")/.." && pwd)"
: "${VERCEL_TOKEN:?Set VERCEL_TOKEN (a Vercel token with access to the team scope)}"

# Resolve the backend origin the frontend will proxy to.
#   prod           → the stable production backend domain (default).
#   testing / dev  → MUST be supplied (fail closed): a non-prod frontend pointing
#                    at the prod backend would write to the prod database.
if [[ "$DEPLOY_ENV" == "prod" ]]; then
  BACKEND_URL="${BACKEND_URL:-https://ascendhq-api.vercel.app}"
else
  if [[ -z "${BACKEND_URL:-}" ]]; then
    echo "✗ DEPLOY_ENV=$DEPLOY_ENV requires BACKEND_URL (the TESTING backend origin)."
    echo "  Refusing to deploy a non-prod frontend that would fall back to the prod backend/DB."
    exit 1
  fi
fi

deploy_backend() {
  echo "→ Backend ($DEPLOY_ENV): staging + building…"
  local S; S="$(mktemp -d)"
  cp -R "$REPO/src" "$S/src"; cp -R "$REPO/api" "$S/api"; cp "$REPO/vercel.json" "$S/vercel.json"
  # Trim embedded-postgres (avoids the large PG binary download on Vercel)
  node -e "const d=require('$REPO/package.json'); delete (d.devDependencies||{})['embedded-postgres']; require('fs').writeFileSync('$S/package.json', JSON.stringify(d,null,2))"
  # tsconfig: rootDir '.' + include src/** so output stays dist/src/app.js (api/index.js imports it)
  node -e "const d=require('$REPO/tsconfig.json'); d.include=['src/**/*.ts']; d.compilerOptions.rootDir='.'; require('fs').writeFileSync('$S/tsconfig.json', JSON.stringify(d,null,2))"
  # Deploy metadata: the staged bundle has no .git, so record the commit here;
  # /healthz reports it (src/shared/version.ts) to answer "what is live?"
  printf '{"sha":"%s","builtAt":"%s"}' \
    "$(git -C "$REPO" rev-parse HEAD)" "$(date -u +%FT%TZ)" > "$S/version.json"
  ( cd "$S" && npm install --no-audit --no-fund --loglevel=error && npm run build && test -f dist/src/app.js )
  echo "→ Backend: deploying…"
  local url
  # Non-prod tiers may override the DB for just this deployment (e.g. dev
  # running against its own database instead of the project's stored Preview
  # value, which testing also uses) via `vercel deploy --env`, which takes
  # precedence over the project's stored env vars for this deployment only.
  local -a DB_ENV_ARGS=()
  if [[ "$DEPLOY_ENV" != "prod" && -n "${DATABASE_URL:-}" ]]; then
    echo "→ Backend: overriding DATABASE_URL for this deployment (dedicated DB)"
    DB_ENV_ARGS+=(--env "DATABASE_URL=$DATABASE_URL")
    [[ -n "${PG_SSL:-}" ]] && DB_ENV_ARGS+=(--env "PG_SSL=$PG_SSL")
    [[ -n "${PG_CA_CERT_B64:-}" ]] && DB_ENV_ARGS+=(--env "PG_CA_CERT_B64=$PG_CA_CERT_B64")
  fi
  # Newer Vercel CLI versions print a JSON summary to stdout instead of a
  # plain URL line (progress text goes to stderr either way) — extract the
  # URL by pattern instead of assuming a fixed "last line" shape, so this
  # keeps working across CLI output format changes.
  url=$( cd "$S" && VERCEL_ORG_ID="$TEAM" VERCEL_PROJECT_ID="$BACKEND_PID" \
      npx --yes vercel deploy $PROD_FLAG --archive=tgz --yes --token "$VERCEL_TOKEN" "${DB_ENV_ARGS[@]}" \
      | grep -oE 'https://[a-zA-Z0-9.-]+\.vercel\.app' | tail -1 )
  echo "→ Backend deployed: $url"
  # Non-prod: pin the unique preview URL to a stable alias so the frontend can be
  # built against a durable backend origin (prod uses --prod's own alias).
  if [[ "$DEPLOY_ENV" != "prod" && -n "${BACKEND_ALIAS:-}" ]]; then
    echo "→ Backend: aliasing $url → $BACKEND_ALIAS"
    ( cd "$S" && npx --yes vercel alias set "$url" "$BACKEND_ALIAS" --token "$VERCEL_TOKEN" --scope "$TEAM" )
  fi
  ( cd "$REPO" && BACKEND_URL="$BACKEND_URL" npx tsx scripts/ops-check.ts "$BACKEND_URL" )
}

deploy_frontend() {
  echo "→ Frontend ($DEPLOY_ENV): staging + building…"
  local S; S="$(mktemp -d)"
  # All tiers run against a real backend now → default mock OFF everywhere.
  local FRONTEND_MOCK_MODE="${NEXT_PUBLIC_MOCK:-false}"
  if [[ "$DEPLOY_ENV" == "prod" && "$FRONTEND_MOCK_MODE" != "false" ]]; then
    echo "✗ Refusing production frontend deploy with NEXT_PUBLIC_MOCK=$FRONTEND_MOCK_MODE"
    echo "  Production must run against the real backend. Use ?demo=1 on the live site for a mock demo."
    exit 1
  fi

  ( cd "$REPO/web" && tar --exclude=node_modules --exclude=.next --exclude=.vercel -cf - . ) | ( cd "$S" && tar -xf - )
  printf 'node_modules\n.next\n' > "$S/.vercelignore"
  # Build locally first to catch errors before uploading (the mounted FS can segfault next build;
  # mktemp is on the local FS so this is safe).
  echo "→ Frontend: NEXT_PUBLIC_MOCK=$FRONTEND_MOCK_MODE BACKEND_URL=$BACKEND_URL"
  ( cd "$S" && npm install --no-audit --no-fund --loglevel=error && BACKEND_URL="$BACKEND_URL" NEXT_PUBLIC_MOCK="$FRONTEND_MOCK_MODE" npm run build )
  echo "→ Frontend: deploying…"
  local url
  # See the matching comment in deploy_backend: extract the URL by pattern,
  # not by assuming a fixed "last line" shape (newer Vercel CLI versions
  # print a JSON summary to stdout instead of a plain URL line).
  url=$( cd "$S" && VERCEL_ORG_ID="$TEAM" VERCEL_PROJECT_ID="$FRONTEND_PID" \
      npx --yes vercel deploy $PROD_FLAG --archive=tgz --yes --token "$VERCEL_TOKEN" \
      | grep -oE 'https://[a-zA-Z0-9.-]+\.vercel\.app' | tail -1 )
  echo "→ Frontend deployed: $url"
  if [[ "$DEPLOY_ENV" != "prod" && -n "${FRONTEND_ALIAS:-}" ]]; then
    echo "→ Frontend: aliasing $url → $FRONTEND_ALIAS"
    ( cd "$S" && npx --yes vercel alias set "$url" "$FRONTEND_ALIAS" --token "$VERCEL_TOKEN" --scope "$TEAM" )
  fi
  echo "✓ frontend deployed ($DEPLOY_ENV)"
}

case "$TARGET" in
  backend)  deploy_backend ;;
  frontend) deploy_frontend ;;
  both)
    # Run both independently — a backend failure (e.g. a bad DB/TLS config)
    # must not silently skip the frontend deploy (and its alias update), and
    # vice versa. Report both outcomes, then fail if either failed.
    backend_status=0; frontend_status=0
    deploy_backend || backend_status=$?
    deploy_frontend || frontend_status=$?
    if [[ $backend_status -ne 0 || $frontend_status -ne 0 ]]; then
      echo "✗ backend exit=$backend_status frontend exit=$frontend_status"
      exit 1
    fi
    ;;
  *) echo "usage: VERCEL_TOKEN=xxx DEPLOY_ENV=prod|testing|dev $0 [backend|frontend|both]"; exit 1 ;;
esac
echo "Done ($TARGET @ $DEPLOY_ENV)."
