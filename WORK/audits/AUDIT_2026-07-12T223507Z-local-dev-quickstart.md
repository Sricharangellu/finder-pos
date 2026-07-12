# Audit — Local backend-on-Postgres quickstart + docs honesty pass

Date: 2026-07-12T22:35:07Z
Session: Claude session A (Opus 4.8 — docs/planning gap)
Status label: **Docs only** (no source/schema changes)

## What & why

The README's "Local development (manual)" instructions were **broken**: they said
`cp .env.example .env` → edit → `npm run dev`, but the backend has **no dotenv
loader**, so `npm run dev` never reads `.env` and fails with `DATABASE_URL is not
set`. There was no correct dev quickstart for running the backend against a user's
own Postgres. Also fixed some overstated maturity/count language.

## Changes (docs only)

- **NEW `docs/getting-started/local-development.md`** — authoritative dev
  quickstart: prerequisites; required env (`DATABASE_URL`, `JWT_SECRET`) with the
  no-auto-load and no-JWT-dev-fallback caveats; install; **migrations run on
  startup** (no separate command); start; verify via `/healthz` + `/readyz`;
  optional demo seed; how it differs from the embedded-postgres test harness
  (incl. the `DATABASE_URL`-is-honored caveat); troubleshooting table; where
  `db/README.md` fits; tenant-isolation (app-layer + RLS backstop) and local
  e2e/auth caveats.
- **`README.md`** — added a "Project status" section (retail proven E2E; other
  verticals Partial/Planned; tenant isolation = app-layer + RLS backstop;
  operational gaps open); replaced the broken manual dev block with a working one
  (export vars + `/readyz` check) and a pointer to the new doc; noted demo creds
  are public/CI-seeded; fixed `cd finder-pos`→`cd Ascend`; refreshed stale counts
  (27→~50 modules, 45→~145 pages, "304 tests"→"300+").
- **`docs/README.md`** — softened "one codebase **powers** [10 verticals]" to
  "designed to serve … through configurable modules" + a maturity note; added a
  "Run the backend locally (developers)" quick link.
- **`db/README.md`** — added a note clarifying the app self-migrates on startup
  (`schema_migrations`) vs. the canonical `run.sh` psql path (`migrations_applied`,
  parallel, not a prerequisite); linked the new quickstart.

## Evidence (grounded in repo, not docs prose)

- No dotenv: `grep` for dotenv in `src/` → none; `openDb()` throws "DATABASE_URL is
  not set" (`src/shared/db.ts`).
- `JWT_SECRET` no dev fallback → 500: `src/gateway/auth.ts` throws `misconfigured`
  when unset, no `NODE_ENV` gate.
- Migrations on startup: `src/app.ts` runs each module's `migrations[]` under
  `pg_advisory_xact_lock`, hash-tracked in `schema_migrations`; confirmed this
  session by booting the backend against a blank embedded Postgres (schema created
  from empty, `/readyz` → db connected, modules mounted).
- Embedded harness honors `DATABASE_URL` if set: `scripts/pg-harness.ts`
  `ensurePg()`.
- Tenant isolation two-layer: `src/gateway/tenant-isolation.test.ts` docstring +
  assertions (app-layer JWT scoping + RLS backstop via AsyncLocalStorage).
- docker-compose injects env inline: `docker-compose.yml`.
- Counts: `ls -d src/modules/*/` = 50; `find web/app -name page.tsx` = 145;
  `npm test` = 389 this session.

## Verification

- All referenced files/scripts exist and every relative link resolves (checked
  each path).
- `node tools/hygiene-check.mjs` — pass (914 files). No markdown linter is
  configured in the repo; verification was file/link existence + hygiene.
- No code, schema, or test changes — backend/web behaviour unchanged.

## Remains open (unchanged, still honestly marked)
- FORWARD_PLAN Phase 4 ops gaps: Redis-required rate limiting in prod,
  backup/restore drills, monitoring/alerting, `/delivery` Playwright e2e.
- Non-retail verticals remain Partial/Planned.
