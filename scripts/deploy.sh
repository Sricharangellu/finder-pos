#!/usr/bin/env bash
# One-command Vercel deploy for Finder POS (backend + frontend) from the current
# working tree. These Vercel projects are NOT git-connected, so deploys are
# manual CLI uploads — this script codifies the full, finicky recipe so the live
# site never drifts behind the repo again.
#
#   VERCEL_TOKEN=xxx ./scripts/deploy.sh [backend|frontend|both]   (default: both)
#
# Requires: node/npm, npx (vercel CLI auto-fetched), a Vercel token with access
# to the team scope. Project/team IDs below are not secrets.
set -euo pipefail

TARGET="${1:-both}"
DEPLOY_ENV="${DEPLOY_ENV:-prod}"                  # prod | testing | dev
case "$DEPLOY_ENV" in
  prod)            PROD_FLAG="--prod" ;;          # production alias
  testing|dev)     PROD_FLAG="" ;;                # preview deployment (unique URL)
  *) echo "DEPLOY_ENV must be prod|testing|dev"; exit 1 ;;
esac
TEAM="team_WNp8vBq1RmWTEH8WSnenP7jM"             # gellusricharan-4715s-projects
BACKEND_PID="prj_krZ34CIFjzQrMvZ08PWqqbxzBf7d"    # finder-pos-backend
FRONTEND_PID="prj_TiPX9UYctGKJbQr4Lb1WFwSsKiN1"   # finder-pos-frontend
BACKEND_URL="https://finder-pos-backend.vercel.app"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
: "${VERCEL_TOKEN:?Set VERCEL_TOKEN (a Vercel token with access to the team scope)}"

deploy_backend() {
  echo "→ Backend: staging + building…"
  local S; S="$(mktemp -d)"
  cp -R "$REPO/src" "$S/src"; cp -R "$REPO/api" "$S/api"; cp "$REPO/vercel.json" "$S/vercel.json"
  # Trim embedded-postgres (avoids the large PG binary download on Vercel)
  node -e "const d=require('$REPO/package.json'); delete (d.devDependencies||{})['embedded-postgres']; require('fs').writeFileSync('$S/package.json', JSON.stringify(d,null,2))"
  # tsconfig: rootDir '.' + include src/** so output stays dist/src/app.js (api/index.js imports it)
  node -e "const d=require('$REPO/tsconfig.json'); d.include=['src/**/*.ts']; d.compilerOptions.rootDir='.'; require('fs').writeFileSync('$S/tsconfig.json', JSON.stringify(d,null,2))"
  ( cd "$S" && npm install --no-audit --no-fund --loglevel=error && npm run build && test -f dist/src/app.js )
  echo "→ Backend: deploying…"
  ( cd "$S" && VERCEL_ORG_ID="$TEAM" VERCEL_PROJECT_ID="$BACKEND_PID" \
      npx --yes vercel deploy $PROD_FLAG --archive=tgz --yes --token "$VERCEL_TOKEN" )
  curl -fsS -m 25 "$BACKEND_URL/readyz" >/dev/null && echo "✓ backend /readyz OK"
}

deploy_frontend() {
  echo "→ Frontend: staging + building…"
  local S; S="$(mktemp -d)"
  ( cd "$REPO/web" && tar --exclude=node_modules --exclude=.next --exclude=.vercel -cf - . ) | ( cd "$S" && tar -xf - )
  printf 'node_modules\n.next\n' > "$S/.vercelignore"
  # Build locally first to catch errors before uploading (the mounted FS can segfault next build;
  # mktemp is on the local FS so this is safe).
  ( cd "$S" && npm install --no-audit --no-fund --loglevel=error && BACKEND_URL="$BACKEND_URL" npm run build )
  echo "→ Frontend: deploying…"
  ( cd "$S" && VERCEL_ORG_ID="$TEAM" VERCEL_PROJECT_ID="$FRONTEND_PID" \
      npx --yes vercel deploy $PROD_FLAG --archive=tgz --yes --token "$VERCEL_TOKEN" )
  echo "✓ frontend deployed"
}

case "$TARGET" in
  backend)  deploy_backend ;;
  frontend) deploy_frontend ;;
  both)     deploy_backend; deploy_frontend ;;
  *) echo "usage: VERCEL_TOKEN=xxx $0 [backend|frontend|both]"; exit 1 ;;
esac
echo "Done ($TARGET)."
