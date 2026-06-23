# FinderPOS — System Design Reference

Last updated: 2026-06-22. Living document — update each section when the
implementation changes. This is design intent + rationale, not a spec
agents must match exactly; actual code is authoritative.

---

## 1. High-level architecture (current state)

```
┌───────────────────────────────────────────────────────────────────────┐
│  Browser / POS Terminal                                               │
│  Next.js 14 App Router (web/)                                         │
│  • Static assets → Vercel Edge CDN                                    │
│  • Auth: access token in-memory + httpOnly finder_refresh cookie      │
│    + finder_session_hint non-httpOnly cookie for middleware reads      │
│  • Global state: FinderContext (storeId, outletId, dateRange…)        │
│  • Offline: IndexedDB write-ahead queue + Background Sync SW          │
│  • MSW mocks in dev (NEXT_PUBLIC_E2E_MODE=true disables for E2E)      │
└──────────────────┬────────────────────────────────────────────────────┘
                   │  HTTPS (proxied via next.config.mjs rewrites)
                   ▼
┌───────────────────────────────────────────────────────────────────────┐
│  API Gateway / Express 4 (src/)                                       │
│  • Helmet + CSP headers; CORS from ALLOWED_ORIGINS                    │
│  • Rate limiting: 120/min global, 10/min identity (Redis or in-memory)│
│  • X-Request-Id → app.request_id GUC on every DB transaction          │
│  • makeAuthMiddleware(db): JWT + API key (fpk_ prefix, scope-checked)  │
│  • requireRole("manager"/"owner") RBAC on all mutations               │
│  • PosModule registry: { migrations[], register(ctx) } per domain     │
│  • Postgres advisory lock serialises cold-start migrations             │
└──────────────────┬────────────────────────────────────────────────────┘
                   │  node-postgres pool (PG_POOL_MAX env, default 10)
                   ▼
┌───────────────────────────────────────────────────────────────────────┐
│  PostgreSQL (Neon / Railway / self-hosted)                            │
│  • RLS: app.tenant_id GUC set by db.withTenant(t).tx()               │
│  • Per-migration hash tracking — idempotent across restarts           │
│  • Postgres job queue: FOR UPDATE SKIP LOCKED                         │
│  • set_updated_at() triggers on identity + module tables              │
│  • Enterprise tables: subscriptions, accounting_periods, currencies,  │
│    exchange_rates, customer_product_prices, time_entries               │
└──────────────────┬────────────────────────────────────────────────────┘
                   │  ioredis (optional, REDIS_URL)
                   ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Redis (optional)                                                     │
│  • Rate limit state (cross-instance fixed-window counters)            │
│  • EventBus Pub/Sub bridge → multi-instance event fan-out             │
│  • Falls back gracefully when absent                                  │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 2. Authentication & Session (IMPLEMENTED)

| Element | Implementation |
|---------|---------------|
| Access token | JWT HS256, 15 min TTL, stored in-memory |
| Refresh token | 48-char random, SHA-256 in DB, single-use rotation |
| Cookie strategy | `finder_refresh` httpOnly + `finder_session_hint` non-httpOnly |
| Middleware | Next.js middleware reads hint cookie for SSR auth decisions |
| API keys | `fpk_` prefix, SHA-256 hashed, scope-checked by `requireScope()` |
| MFA | TOTP (otpauth), QR via `/api/identity/mfa/setup` |
| Lockout | 10 failed attempts → 30-min lock (`failed_login_attempts`, `locked_until_ms`) |
| Refresh token revocation | `POST /api/identity/logout` revokes token + clears both cookies |

---

## 3. Tenant Isolation & RLS

Every write path uses `db.withTenant(tenantId).tx()` which issues
`SET LOCAL app.tenant_id = ?` inside the transaction before any DML.
Postgres RLS policy enforces isolation at DB level — defense-in-depth
even if application code omits the WHERE clause.

`app.request_id` GUC also set per-request for DB log correlation (PROD-10).

---

## 4. EventBus (in-memory + optional Redis bridge)

```
events.publish(type, payload, aggregateId)
  → local dispatch to in-process subscribers
  → (if REDIS_URL) publish to "finder:events" Redis channel
     → other instances receive and re-dispatch locally
     → self-messages suppressed via instance-ID header
```

**Subscribers:** webhooks (with exponential backoff retries ×5), orchestration
workflow triggers, inventory reservations, notifications (low-stock, overdue).

**Known gap (DB-8):** Not durable — events lost on crash between publish and handler.
Planned: Postgres outbox pattern (write event to outbox_events in same TX as mutation;
background poller re-dispatches).

---

## 5. Background Jobs (Postgres queue)

```sql
-- Polling pattern: safe concurrent access, no external dependency
SELECT * FROM job_queue WHERE status = 'pending' AND run_at <= now()
ORDER BY run_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED;
```

| Job | Trigger | Description |
|-----|---------|-------------|
| `ar_dunning` | Daily / per-tenant | Set invoices.dunning_level; emit invoice.overdue |
| `idempotency_expiry` | Every 6h / global | Batch-delete expired rows (prevents 3.65B rows/year) |

Planned (BE-34): BullMQ (Redis-backed) for webhook retry, report cache, ETL sync.

---

## 6. Offline Terminal (IndexedDB + Background Sync)

```
Cashier scans products → cart built → hits Charge
  ↓ (if !navigator.onLine + cash payment)
TenderScreen → enqueueCheckout() → IndexedDB finder-pos-outbox
  ↓ requestSync() → SW registers "checkout-replay" background sync
  ↓ (on reconnect, SW fires "sync" event)
drainOutbox() → POST each item with X-Idempotency-Key header
  ↓ (on 2xx) delete from IDB, postMessage OUTBOX_ITEM_REPLAYED
OfflineBanner → updates queued count → shows "X sales synced"
```

Fallback for Safari/Firefox (no Background Sync API):
`useOffline().reconnectedAt` triggers `drainOutboxMainThread()`.

---

## 7. CI/CD Pipeline (3-tier)

```
feature/* ──PR──► staging ──PR──► master
                    │                │
             Vercel preview    Vercel --prod
             staging DB        production DB
```

**GitHub Actions jobs (per push):**
1. `guard` — lint: unguarded mutations, console.*, SQL injection
2. `backend` — typecheck + 311 integration tests (real Postgres 16)
3. `frontend` — typecheck + ESLint + Next.js build
4. `e2e` — Playwright: login→checkout, inventory receive, invoice pay
5. `deploy-staging` / `deploy-production` — Vercel (branch-gated)
6. `smoke-test` — curl /healthz /readyz /api/v1/flags after prod deploy

Required GitHub secrets: `VERCEL_TOKEN`, `STAGING_BACKEND_URL`

---

## 8. Enterprise Schema (added 2026-06-22)

### New tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `subscriptions` | SaaS plan per tenant | plan, status, max_users, max_registers, max_outlets |
| `accounting_periods` | Fiscal close periods | starts_at, ends_at, closed_at, closed_by |
| `currencies` | Currency master | code PK, name, symbol, decimals |
| `exchange_rates` | Point-in-time FX | from_code, to_code, rate, effective_at |
| `customer_product_prices` | Per-customer price overrides | customer_id, product_id, price_cents |
| `time_entries` | Employee clock-in/out | employee_id, clock_in, clock_out, break_minutes |

### Soft-delete

Identity tables (`tenants`, `users`, `custom_roles`) have `deleted_at BIGINT`.
Partial indexes `WHERE deleted_at IS NULL` keep active-row queries fast.
Commerce tables use `status = 'archived'` or FK cascade deletes.

### Performance indexes

```sql
orders (tenant_id, created_at DESC, status)
orders (tenant_id, customer_id, created_at DESC) WHERE customer_id IS NOT NULL
order_lines (tenant_id, product_id, order_id)
invoices/bills (tenant_id, issued_at DESC, status)
```

### CHECK constraints

```sql
order_lines: quantity > 0 AND unit_cents >= 0 AND line_cents >= 0
invoices:    status IN ('open','partial','paid','void')
bills:       status IN ('open','partial','paid','void')
```

---

## 9. Security Hardening (PROD audit 2026-06-22)

All 18 PROD items are now resolved. Key fixes:

| Risk | Fix |
|------|-----|
| Unguarded catalog PATCH/DELETE | `requireRole("manager")` on all mutations |
| Runaway DB transactions | `SET LOCAL statement_timeout = PG_TX_TIMEOUT_MS` in every tx |
| IP spoofing in rate limiter | `extractClientIp()` — rightmost-N via `TRUST_PROXY_DEPTH` |
| No post-deploy verification | `smoke-test` CI job curls /healthz /readyz after deploy |
| Missing FK constraints | `fk_order_lines_order`, `fk_payments_order`, `fk_po_lines_po` |
| No idempotency key cleanup | Expiry job (6h sweep) prevents unbounded table growth |

See `orchestration/RUNBOOK.md` for incident playbooks.

---

## 10. Pending architectural decisions

### DB-8: Durable EventBus
Write events to `outbox_events` inside the business transaction (same commit),
background poller reads and re-dispatches. Guarantees at-least-once delivery.

### DB-9: CQRS read model
`daily_sales_summary` materialized view exists. Route `salesSummary()` and
`topProducts()` through it instead of live ORDER BY aggregation.
Expected: 10 s → < 100 ms dashboard load at 100M rows.

### DB-13: Subscription enforcement
`subscriptions` table is provisioned. `requirePlan("professional")` helper
checks plan from tenant's subscription row; enforces max_users, max_registers,
max_outlets at POST /identity/users, POST /outlets/registers, etc.

### Multi-currency
`currencies` + `exchange_rates` tables provisioned. Add `currency_code` FK to
orders and resolve exchange rate at checkout time.

### Connection pooler
For Vercel serverless: point `DATABASE_URL` at Neon pooled endpoint or
PgBouncer (transaction mode) to prevent pool exhaustion under concurrency.

---

## 11. Scaling roadmap

| Milestone | Users/tenants | Key architecture change |
|-----------|---------------|------------------------|
| **Now** | < 1K tenants | Modular monolith, single Postgres, Vercel |
| **6 months** | < 5K tenants | Redis Streams EventBus, PgBouncer, CQRS read model |
| **1 year** | < 25K tenants | BullMQ jobs, Postgres partition by tenant_id, read replica |
| **2 years** | < 100K tenants | Multi-region active-active, ClickHouse analytics, CDC |
| **3+ years** | Global | AI demand forecasting, autonomous replenishment |
