# Local development — run the backend against your own Postgres

This is the **developer** setup for running the Ascend backend locally against a
Postgres you control (local or a managed provider). It is different from the
product-onboarding guides in this folder (`01-onboarding.md`, `02-hardware.md`),
which are written for store operators, not developers.

> Status, honestly: **retail is the only pack proven end-to-end** (backend unit
> tests + `npm run smoke` exercise the full POS lifecycle). The other verticals in
> the README feature list exist as code but are **Partial** or **Planned** — see
> [`WORK/FORWARD_PLAN.md`](../../WORK/FORWARD_PLAN.md) for the honest per-area
> status. Don't treat every listed feature as production-ready.

## Prerequisites

- **Node.js 20+** and **npm 10+**. `.nvmrc` pins **Node 24**, which CI uses; 20+ is a safe floor.
- **PostgreSQL 16+** — a local server, a Docker container, or a managed instance
  (Neon, Railway, Supabase, etc.).
- `psql` on your PATH — **optional**, only needed for the canonical migration
  runner (`db/migrations/run.sh`) and manual DB inspection.

## 1. Environment variables

**The backend does NOT auto-load a `.env` file** (there is no dotenv dependency).
Copying `.env.example` to `.env` is not enough on its own — you must load those
variables into your shell, or pass them inline. This is the most common reason a
first run fails with `DATABASE_URL is not set`.

Two variables matter for a working local backend:

| Variable | Required? | Notes |
|---|---|---|
| `DATABASE_URL` | **Yes** | e.g. `postgresql://finder:finder@localhost:5432/finder_dev`. `openDb()` throws immediately if it is unset. For managed pooled providers, use the **pooled** connection string (see `.env.example`). |
| `JWT_SECRET` | **Yes** | ≥ 32 random chars. There is **no development fallback** — the server boots without it, but every authenticated request then returns `500 misconfigured` (see `src/gateway/auth.ts`). |
| `PORT` | No | Defaults to `3000`. `.env.example` and Docker use `3001`. |
| `PG_SSL` | Only for SSL DBs | In development SSL is **off** by default. For a managed Postgres that requires TLS, set `PG_SSL=true`. Set `PG_SSL=false` for a local/CI Postgres that has no SSL. Logic: `src/shared/db.ts` → `sslConfig()`. |
| `PG_POOL_MAX` | No | Max pool connections per process (default 10). Lower it for free-tier managed plans. |

Everything else in `.env.example` (Redis, Stripe, SendGrid, metrics, …) is
optional for local development and degrades gracefully when unset.

The reliable way — export the two required variables directly:

```bash
export DATABASE_URL='postgresql://finder:finder@localhost:5432/finder_dev'
export JWT_SECRET='dev-only-secret-at-least-32-characters-long'
```

If you prefer to keep them in the shipped `.env` file, you can load it into the
shell — but note `.env.example` has at least one value with a space
(`STORE_NAME=Ascend Demo`), so quote any such values first, or `source` will print
a harmless "command not found" on that line:

```bash
cp .env.example .env
# edit .env: set DATABASE_URL and a real JWT_SECRET (>=32 chars)
set -a; source .env; set +a        # loads the file; the two vars above are what matter
```

## 2. Install dependencies

```bash
npm install            # backend (repo root)
cd web && npm install  # frontend (only if you also want the UI)
cd ..
```

## 3. Migrations — they run automatically on startup

**You do not run a separate migrate command for local dev.** On boot,
`buildApp()` applies every module's migrations under a Postgres advisory lock and
records each by content hash in a `schema_migrations` table, so a **fresh, empty
database is fully provisioned the first time you start the backend**
(`src/app.ts`). Subsequent starts skip already-applied migrations.

There is also a **separate, optional** canonical SQL path — `db/migrations/*.sql`
applied via `db/migrations/run.sh` (tracked in its own `migrations_applied`
table, requires `psql`). That path is the human-readable DDL of record and the
only way to run `down` rollbacks; it is **not required** to run the app locally.
See [`db/README.md`](../../db/README.md) for it, plus the RLS policies, seeds, and
backup/restore scripts.

## 4. Start the backend

With `DATABASE_URL` and `JWT_SECRET` exported (step 1):

```bash
npm run dev        # tsx watch src/server.ts — reloads on change
# or, non-watch:
npm start
```

You should see logs like `migration lock acquired` → `migrations complete` →
`Ascend started` with the port.

## 5. Verify it is connected to Postgres

```bash
curl -s http://localhost:3001/healthz    # liveness + build version
curl -s http://localhost:3001/readyz     # readiness — checks the DB + modules
```

`/readyz` returns `"status":"ok"` with `"db":"connected"` and a `modules` array
**only when the pool can reach Postgres**. If the DB is down or `DATABASE_URL` is
wrong, `/readyz` fails while `/healthz` may still return `ok` — so `/readyz` is the
real "am I talking to Postgres" check.

### (Optional) seed a demo tenant to log in

```bash
ALLOW_E2E_SEED=1 DATABASE_URL="$DATABASE_URL" npx tsx scripts/seed-e2e.ts
```

This inserts the `tnt_demo` tenant + `owner@finder-pos.dev` / `FinderDemo!2026`.
The credentials are **public and well-known** and the script bypasses production
guards — run it **only** against a disposable local/dev database, never
production (the script refuses without `ALLOW_E2E_SEED=1`).

## How this differs from the embedded-postgres test harness

By **default** (no `DATABASE_URL` in the environment), `npm test`
(`scripts/test.ts`) boots a **throwaway embedded Postgres** cluster
(`embedded-postgres`) on a random port, runs every `*.test.ts` in its own unique
schema for isolation, and tears it down. So you can run `npm test` and
`npm run smoke` **without** installing any Postgres.

**Important caveat:** the harness only falls back to embedded Postgres when
`DATABASE_URL` is **unset** — `ensurePg()` uses `DATABASE_URL` as-is if it is set
(`scripts/pg-harness.ts`). Because the setup above exports `DATABASE_URL` into
your shell, running `npm test` in that **same shell** will execute against **your
dev database** (each test still isolates itself in a unique schema, but it runs on
your server, not an ephemeral one). To force the self-contained harness, run tests
in a shell where `DATABASE_URL` is not exported, e.g.:

```bash
env -u DATABASE_URL npm test
```

So: **default test harness = ephemeral and self-contained; local dev = your own
persistent Postgres via `DATABASE_URL`** — just don't let an exported
`DATABASE_URL` leak into your test runs unless you intend it.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `DATABASE_URL is not set` on start | `.env` is not auto-loaded — `export DATABASE_URL=…` (and `JWT_SECRET`) in the shell first (step 1). |
| Requests return `500 misconfigured` / "JWT_SECRET … not set" | `JWT_SECRET` not exported. It has no dev fallback. |
| `ECONNREFUSED` / connection refused | Postgres not running, or wrong host/port in `DATABASE_URL`. Start it (`docker-compose up postgres` brings up Postgres 16 on 5432). |
| SSL / `self-signed certificate` errors on a managed DB | Set `PG_SSL=true`. For a local no-SSL DB, leave it unset (dev default is off). |
| `too many connections` | Lower `PG_POOL_MAX`; use the provider's **pooled** connection string. |
| Tables missing after start | Check the logs for `migrations complete`. If migrations errored, the advisory lock/hash record prevents partial re-runs — inspect `schema_migrations`. |
| `/readyz` not `ok` | The pool can't reach Postgres — recheck `DATABASE_URL`, that the DB exists, and network/SSL. |

## Notes for changing auth, e2e, or tenant behavior

- **Tenant isolation is application-layer first, RLS second.** Handlers scope
  every query by the JWT's tenant; RLS is a **defense-in-depth backstop** that
  only takes effect when `app.tenant_id` is set — which the gateway does per
  authenticated request via `AsyncLocalStorage` (`src/shared/tenant-context.ts` +
  `src/shared/db.ts`). Both layers are proven by
  [`src/gateway/tenant-isolation.test.ts`](../../src/gateway/tenant-isolation.test.ts);
  keep and extend that test rather than relying on RLS alone.
- **Frontend/e2e auth is finicky locally.** The web app keeps the access token
  **in memory** with a cookie-based silent refresh (`web/lib/auth.ts`). This is
  robust in production but sensitive to hard navigations in the two-port local
  Playwright harness. Read `web/playwright.config.ts` before changing auth or e2e
  behavior. To run the frontend against this backend, set
  `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001` and `cd web && npm run dev`.

## Fastest path (all Docker)

If you'd rather not install Postgres, `docker-compose up` brings up Postgres +
backend (:3001) + frontend (:3000) with `DATABASE_URL`/`JWT_SECRET` injected by
the compose file — no `.env` loading needed. Use the manual path above when you
want to run the backend against your own or a managed Postgres.
