# FinderPOS — Work State
> Last updated: 2026-06-29  |  Last commit: `1376e14` — docs(roadmap): close INF-11; docs(integration-log): record INF-7/11 sprint

## Active task
**INF-8** — Offline terminal: IndexedDB write-ahead queue for checkout when network is unavailable; replay on reconnect with idempotency key deduplication.
Status: not started

## Files in flight
None — INF-11 was the last completed task. No uncommitted changes.

## Recent decisions
- **pino over console.*** — structured JSON logs, all 14 src/ files converted; zero console.* remain in production source
- **requestLogger added to logger.ts** — W3C trace context (trace_id, span_id) fields for OTEL/APM correlation; used in errorEnvelope.ts
- **makeAuthMiddleware(db) vs authMiddleware** — factory used in app.ts for API key + JWT dual auth; original kept for test backward-compat
- **Migration lock** — pg_advisory_xact_lock(7381920) inside db.tx(); concurrent instances block then skip via hash check
- **Redis EventBus fan-out** — publish() dispatches locally first, then broadcasts to "finder:events" Redis channel; origin ID suppresses self-messages

## Context cliff notes
- Service Worker shell is at `web/public/sw.js` — has cache-first static + network-first nav; INF-8 extends it
- Checkout POST endpoint: `/api/v1/orders/checkout` (or `/api/v1/orders` — confirm in handlers)
- Idempotency middleware already exists: `src/orchestration/idempotency/idempotency-middleware.ts`
- Money is always integer cents; IDs use uuidv7 with resource prefix
- DB RLS pattern: `withTenant(tenantId).tx()` — never raw tenant filter in queries

## Next 3 actions
1. Read `web/public/sw.js` to understand current Service Worker structure
2. Install `idb` or `idb-keyval` in `web/` for IndexedDB access from SW
3. Extend SW with a CHECKOUT_QUEUE outbox: intercept POST /api/v1/orders when offline, store to IDB, replay on `sync` event

## Blockers
None

## Completed INF items (this sprint)
- INF-1 — pg_advisory_xact_lock migration serialization (`1376e14`)
- INF-2 — SIGTERM/SIGINT graceful shutdown
- INF-3 — pino structured logger (src/shared/logger.ts)
- INF-4 — Stripe webhook signature verification
- INF-5 — Redis Pub/Sub EventBus fan-out
- INF-6 — AR dunning self-perpetuating scheduled job
- INF-7 — DB.poolStats() + /readyz 503 on pool exhaustion
- INF-10 — makeAuthMiddleware(db) + requireScope() API key auth
- INF-11 — Zero console.* in production source (14 files)

## Remaining INF items
- **INF-8** — Offline terminal IndexedDB queue (FE-heavy, 3-4 days)
- **INF-9** — E2E tests: Playwright, golden paths, CI integration (2-3 days)
