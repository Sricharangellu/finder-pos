# Ascend CI/CD Pipeline — 3-Tier Promotion

A single, forward-only promotion pipeline across three environments. Code is built on **develop**,
QA'd on **staging**, and released on **master**. Each tier is wired to its own full stack (Vercel +
Supabase) and gated by CI. The Vercel projects are **not** git-connected — GitHub Actions
(`.github/workflows/ci.yml`) drives deploys via `scripts/deploy.sh` (the Vercel CLI).

## Environments

| Tier | Git branch | Vercel env | Database | Frontend URL |
|---|---|---|---|---|
| **PROD** | `master` (default) | Production (`vercel --prod`) | Supabase **A** (prod) | finder-pos-frontend.vercel.app |
| **TESTING** | `staging` | Preview (stable alias) | Supabase **B** (testing) | `STAGING_FRONTEND_ALIAS` |
| **DEV** | `develop` | Preview (unique per deploy) | Supabase **B** (shared) | per-deploy preview URL |
| feature work | `feature/*` | — (CI tests only) | ephemeral CI Postgres | — |

`develop` and `staging` both deploy as Vercel **Preview** builds, so they share the Preview
environment variables → the same **testing** database (Supabase B). Production is fully isolated on
Supabase A. This gives real isolation with **two** databases, not three.

## Promotion flow (forward-only)

```
feature/*  ──PR──▶  develop   → CI + deploy DEV     (preview, testing DB)
develop    ──PR──▶  staging   → CI + deploy TESTING (preview alias, testing DB) + smoke
staging    ──PR──▶  master    → CI + deploy PROD    (--prod, prod DB) + smoke
```

- **Start work:** branch `feature/<name>` off `develop`. Open a PR into `develop`.
- **Promote to QA:** open a PR `develop → staging`. On merge, TESTING redeploys.
- **Release:** open a PR `staging → master`. On merge, PROD redeploys.
- **Hotfix:** branch off `master`, PR into `master`. After release, back-merge
  `master → staging → develop` so the lower tiers stay ahead.

Every branch requires the CI status checks (`Production guard`, `Backend — typecheck + test`,
`Frontend — typecheck + lint + build`) to pass before merge. Force-push is blocked.

## What CI does per branch (`.github/workflows/ci.yml`)

- **Every push & PR** on `develop`/`staging`/`master`: `guard`, `backend` (typecheck + test + smoke
  on ephemeral Postgres), `frontend` (typecheck + lint + build), `e2e` (Playwright on ephemeral PG).
- **push `develop`** → `deploy-dev` → `DEPLOY_ENV=dev scripts/deploy.sh both` (preview, testing DB).
- **push `staging`** → `deploy-staging` → `DEPLOY_ENV=testing scripts/deploy.sh both` (preview aliased
  to stable staging domains) → smoke `/healthz` + `/readyz` on the testing backend.
- **push `master`** → `deploy-production` → `DEPLOY_ENV=prod scripts/deploy.sh both` (`--prod`) →
  `smoke-test` (`/healthz`, `/readyz`, `/api/v1/flags`→401, frontend 200).

## Configuration (GitHub + Vercel + Supabase)

### GitHub repo **secrets**
| Name | Value |
|---|---|
| `VERCEL_TOKEN` | Vercel token with team-scope access (already set) |

### GitHub repo **variables** (non-secret — Settings → Secrets and variables → Actions → Variables)
| Name | Example | Used by |
|---|---|---|
| `STAGING_BACKEND_URL` | `https://ascend-api-staging.vercel.app` | dev + testing frontend build target; testing smoke |
| `STAGING_BACKEND_ALIAS` | `ascend-api-staging.vercel.app` | testing backend alias |
| `STAGING_FRONTEND_ALIAS` | `ascend-staging.vercel.app` | testing frontend alias + environment URL |

### Vercel — `finder-pos-backend` → Environment Variables
- **Production:** `DATABASE_URL`=Supabase **A** pooler, `JWT_SECRET`=prod, `NODE_ENV=production`,
  `PG_SSL=require`, `CRON_SECRET`, `WEBHOOK_SECRET_KEY` (already configured).
- **Preview:** `DATABASE_URL`=Supabase **B** pooler, `JWT_SECRET`=staging, `NODE_ENV=production`,
  `PG_SSL=require`, `CRON_SECRET`.

### Vercel — `finder-pos-frontend` → Environment Variables
- **Preview:** `NEXT_PUBLIC_MOCK=false` (build target already passes `BACKEND_URL` via deploy.sh).

### Supabase
- **A** = production project (existing). **B** = testing project (`ascend-testing`).
- Schema self-provisions on first backend boot (`buildApp` runs every module's migration). No manual
  migration step.
- Seed demo data into B once: `DATABASE_URL=<B-pooler> npm run seed:demo`.

## Rollback

Every change here is a branch/CI/protection edit — no data migrations, and the prod DB (Supabase A)
is never touched by pipeline work.

- **Bad release:** re-run the last known-good `master` deploy, or `git revert` the release merge and
  push `master` (redeploys prod). Vercel also keeps prior deployments — promote a previous one in the
  dashboard for an instant rollback.
- **Bad pipeline change:** revert the CI commit on `master`.

## Known issue — E2E is a non-blocking signal (for now)

The Playwright golden-path suite (`web/e2e`) has a pre-existing timing flake: the backend rotates
refresh tokens strict single-use, and Playwright starts a fresh worker after any test failure, so the
shared authenticated `storageState` cookie can already be revoked → the affected tests redirect to
`/login` and the inline re-login's `waitForURL` occasionally exceeds 15 s under CI contention (a run
typically shows a handful of "flaky" plus 1–2 hard failures, all at the same login helper). It fails
on `master` too — it is **not** caused by the pipeline.

**Root-cause fix applied:** the E2E backend now runs with `REFRESH_REUSE_GRACE_MS=900000` (15 min,
in the `e2e` job env only — prod stays at the 15 s default). The backend already supports this grace
window; widening it to cover a full run means a replayed cookie from a restarted worker stays valid
instead of stranding the session, so the cascade can't start. Rotation itself is unchanged, and its
strict single-use property keeps its own unit coverage (run at the 15 s default).

Until this is confirmed green across a few runs, `e2e` remains a **reported signal** — not in the
deploy `needs` nor the required merge checks. Once stable, add `e2e` back to the deploy `needs` and
the branch-protection required checks to make it a hard gate.

## Local development

Point a local clone at whichever tier's DB you're working against (see `.env.staging.example` for the
testing tier). Backend on `:3001`, frontend on `:3000` with `NEXT_PUBLIC_MOCK=false`. Never point
local at Supabase A (prod) for development.
