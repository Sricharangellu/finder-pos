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

## Release policy (standing rule, confirmed 2026-07-19)

**Nothing reaches `master`/production without Sri's explicit command.** This isn't a convention —
it's structurally enforced, not just followed:

- `master` branch protection requires all 4 CI checks green **and** is admin-enforced (no bypass,
  including for repo admins).
- No workflow anywhere auto-merges a PR — confirmed no `gh pr merge`, `--auto`, or equivalent exists
  in any `.github/workflows/*.yml`. A human (or an agent acting on Sri's explicit instruction) must
  click merge every time.
- `deploy-production` triggers **only** on a `push` event to `master` — which only happens as the
  direct result of that merge. There is no scheduled, automatic, or conditional path to production
  that bypasses a human decision.

Practical shape from Vercel's side: there are really only **two** live deploy destinations —
**Production** (`master` only) and **Preview** (`develop` and `staging` both land here, distinguished
by alias). Git's 3-tier branch model exists to gate what reaches Production, not to create a third
Vercel environment. The moment a PR is merged into `master`, the pipeline runs end-to-end
automatically and production reflects the change — that merge is the one and only trigger.

Any agent/session working on this repo: treat a merge into `master` as requiring the same standing
explicit authorization as any other hard-to-reverse, production-affecting action — ask first, every
time, even if CI is green.

## What CI does per branch (`.github/workflows/ci.yml`)

- **Every push & PR** on `develop`/`staging`/`master`: `guard`, `backend` (typecheck + test + smoke
  on ephemeral Postgres), `frontend` (typecheck + lint + build), `e2e` (Playwright on ephemeral PG).
- **push `develop`** → `deploy-dev` → `DEPLOY_ENV=dev scripts/deploy.sh both` (preview, testing DB).
- **push `staging`** → `deploy-staging` → `DEPLOY_ENV=testing scripts/deploy.sh both` (preview aliased
  to stable staging domains) → smoke `/healthz` + `/readyz` on the testing backend.
- **push `master`** → `deploy-production` → `DEPLOY_ENV=prod scripts/deploy.sh both` (`--prod`) →
  `smoke-test` (`/healthz`, `/readyz`, `/api/v1/flags`→401, frontend 200).

## Configuration (GitHub + Vercel + Supabase + Render)

**Status (2026-07-20): PROD reconfigured onto Render, non-prod tiers currently DOWN, not
aspirational-but-live.** The section below is the target state. What actually changed this pass:

- **Production backend moved off Vercel serverless onto Render** (persistent process, no cold
  starts — see `ARCHITECTURE.md`). `deploy-production`/`smoke-test` in `ci.yml` still deploy/probe a
  Vercel backend — that path is now redundant for the backend half and needs reconciling; Render's own
  git-integration auto-deploy on push to `master` is what actually ships prod today. Frontend still
  deploys via Vercel (project `ascend_hq_web`, git-connected to `master`).
- **`develop`/`staging` backend hosting is currently DOWN**, not merely unconfigured: the Vercel
  projects `ci.yml`/`scripts/deploy.sh` target (formerly `finder-pos-backend`/`ascend-backend`) were
  deleted this session. `https://ascend-backend-staging.vercel.app` returns `DEPLOYMENT_NOT_FOUND`
  (verified 2026-07-20) — confirm this before assuming the smoke-test rows below still apply.
- **Database topology is fixed at exactly 2 projects** (Sri directive, 2026-07-20, reconfirmed): one
  Supabase project shared by `develop` **and** `staging`, one fully isolated for `master`/production.
  `ci.yml`'s `deploy-dev` job previously carried a `DEV_DATABASE_URL` override that would have given
  `develop` its **own third database**, contradicting this — removed; `develop` now falls back to the
  same Preview-environment `DATABASE_URL` that `staging` uses, same as the design below always said.

### GitHub repo **secrets**
| Name | Value |
|---|---|
| `VERCEL_TOKEN` | Vercel token with team-scope access (frontend deploys) |
| `VERCEL_TOKEN_PROD` | Legacy — only still used by `ci.yml`'s now-redundant Vercel backend prod deploy; candidate for removal once that job is reconciled with Render |

### GitHub repo **variables** (non-secret — Settings → Secrets and variables → Actions → Variables)
| Name | Value | Used by |
|---|---|---|
| `STAGING_BACKEND_URL` | `https://ascend-backend-staging.vercel.app` (dead — project deleted) | dev + testing frontend build target; testing smoke |
| `STAGING_BACKEND_ALIAS` | `ascend-backend-staging.vercel.app` (dead) | testing backend alias |
| `STAGING_FRONTEND_ALIAS` | `ascend-frontend-staging.vercel.app` (dead) | testing frontend alias + environment URL |

Non-prod backend hosting needs to be rebuilt from scratch (NEEDS-SRI: Render, like prod, or a fresh
Vercel project — pick one before re-activating `deploy-dev`/`deploy-staging`).

### Supabase
- **Production** = new isolated project created 2026-07-20 (ref `kplruangtivthgqudjwt`, region
  `ca-central-1`), connected only from Render via the Session pooler with verified TLS
  (`PG_CA_CERT_B64`). Never shared with any other tier.
- **Testing** (shared by `develop` + `staging`) = the pre-existing project (ref `lqaicxibgrlxwkvxsaji`,
  region us-west-2) already used for local/dev work — already has all ~172 tables and the standard
  demo login self-provisioned; reuse it rather than paying for a third project.
- Schema self-provisions on first backend boot (`buildApp` runs every module's migration) — no manual
  seed step needed for either project.

## Rollback

Every change here is a branch/CI/protection edit — no data migrations, and the prod DB (Supabase A)
is never touched by pipeline work.

- **Bad release:** re-run the last known-good `master` deploy, or `git revert` the release merge and
  push `master` (redeploys prod). Vercel also keeps prior deployments — promote a previous one in the
  dashboard for an instant rollback.
- **Bad pipeline change:** revert the CI commit on `master`.

## Known issue — E2E login flake: ROOT CAUSE CONFIRMED (2026-07-18)

**Confirmed via direct evidence** (a Playwright trace DOM snapshot at the moment of failure — not
inference): `/api/identity` (login, refresh, register, me) is rate-limited per-IP at
`capacity: 10, refillRate: 0.33` (src/app.ts) — a correct brute-force guard for production. The
entire E2E suite runs from **one CI runner IP** and needs dozens of `/api/identity` requests (global
setup's login, every worker-restart self-heal probe login, `login.spec.ts`'s 3 dedicated login tests,
every retry of every test). That exhausts the 10-token bucket quickly; refill is slow (1 token per
3s), so once tripped, **every spec that needs auth fails at once** — exactly matching the observed
cross-spec cascade (checkout, delivery, invoice-pay, inventory-receive, verticals all failing
together) and the run-to-run variance (5.9–11.1 min, 2–22 failures — depends on how many login
attempts pile up before the window resets). It is pre-existing on `master`, unrelated to the pipeline.

**The proof:** the trace for `login.spec.ts`'s "valid credentials redirect to the app" test — a
*completely fresh, unauthenticated context*, no shared session, first login attempt — timed out with
this literal alert visible on the page: `Too many requests — slow down.` (the exact message
`rateLimitMiddleware` returns on a 429). This ruled out every session/cookie/rotation theory below in
one shot: a brand-new login with zero prior state was rejected by the rate limiter, not by auth logic.

**Fix:** made the limiter's thresholds env-overridable in `src/app.ts`
(`IDENTITY_RATE_LIMIT_CAPACITY` / `_REFILL`, `IDENTITY_REGISTER_RATE_CAPACITY` / `_REFILL`) — defaults
unchanged (10/0.33 and 5/0.05), so **production behavior is byte-identical** unless explicitly
overridden. Set to generous values (`1000` / `100`) in the `e2e` CI job env only. No prod security
posture change; local dev and unit tests keep the strict defaults too.

**Verified fixed:** a `develop` run with the fix landed **27 passed / 0 failed / 0 flaky in 32.1 s**
— down from 5.9–11.1 minutes with 2–22 failures per run beforehand. `e2e` is back in the deploy
`needs` for all three tiers and added to the branch-protection required checks on `master`/`staging`/
`develop` — it is a hard gate again.

<details>
<summary>Investigation history (superseded by the confirmed root cause above — kept for the record)</summary>

The suite was originally suspected to have a session-rotation timing flake: the backend rotates
refresh tokens strict single-use, and Playwright starts a fresh worker after any test failure, so a
shared authenticated `storageState` cookie could already be revoked → affected tests redirect to
`/login` and the inline re-login's `waitForURL` occasionally exceeds 15 s. This looked plausible from
the failure location (all failures at the same helper line) but turned out to be the wrong layer
entirely — see below.

**Attempted fix (reverted):** tried setting `REFRESH_REUSE_GRACE_MS=900000` in the `e2e` job env
(widening the backend's existing reuse-grace window so a replayed cookie from a restarted worker
would stay valid). Verified against a live `develop` run — the result contradicted the hypothesis
rather than confirming it:

| | baseline (`master`, no change) | with `REFRESH_REUSE_GRACE_MS=900000` |
|---|---|---|
| failed | 5–7 | **22** |
| flaky (recovered on retry) | 10–11 | **1** |
| passed | 10–11 | 5 |
| runtime | 5.9–6.8 min | **11.1 min** |
| failure spread | one helper line, one spec file | many unrelated spec files, two distinct error signatures |

The low flaky count is the key signal: baseline retries mostly self-heal (a fresh Playwright worker
gets a clean login); with the widened grace, retries stopped recovering — consistent with the grace
window interfering with the worker-scoped session self-heal in `web/e2e/fixtures.ts`, though the
exact mechanism isn't confirmed (no backend log capture in CI to inspect the `/login` calls during
the run). **Reverted** — a fix that isn't proven to help and correlates with a 3–4× worse outcome
isn't a fix. Root cause of the *original* flake (documented above) is still open.

**Diagnostics added and run (2026-07-18):** the backend was backgrounded with no log redirect, so its
stdout/stderr were discarded — no past run ever had backend evidence. Added `LOG_LEVEL=debug` +
redirect to a file, a 2s `/healthz` poll timeline, and always-on artifact upload. Result from a real
failing run (16 failed / 3 flaky / 9 passed, 7.9 min):

- **Backend health: zero gaps.** `/healthz` returned `200` at every 2s sample for the full ~10 min
  run — rules out backend crash/stall/restart as the cause.
- **`backend.log` is nearly empty** — 3 boot lines, then nothing until two `res.clearCookie`
  deprecation warnings at the very end. The app has **no per-request or login-attempt logging** (no
  `pino-http`/morgan middleware, no logger calls in `identity/service.ts`'s login/refresh paths), so
  even debug level shows nothing about individual `/login` calls.
- **Separately found and fixed:** the E2E job runs `playwright test --reporter=github`, which only
  emits GH Actions annotations — it does **not** write an HTML report, so `web/playwright-report/`
  (the artifact this workflow uploaded on failure) has been **empty on every past run**; that upload
  step has never actually captured anything. Screenshots/video/trace are written to
  `web/test-results/` regardless of reporter — the upload path was corrected to point there instead.

Net effect of the backend-log + health-poll diagnostics: the backend process itself was cleared
(zero `/healthz` gaps across two full runs) before the trace evidence above pinned the actual cause —
the rate limiter, not a crash/stall/restart. The `playwright-report` upload fix (empty on every past
run — `--reporter=github` never wrote an HTML report) was what made pulling the trace above possible
at all.

</details>

## Local development

Point a local clone at whichever tier's DB you're working against (see `.env.staging.example` for the
testing tier). Backend on `:3001`, frontend on `:3000` with `NEXT_PUBLIC_MOCK=false`. Never point
local at Supabase A (prod) for development.
