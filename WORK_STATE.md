# FinderPOS — Work State
> Last updated: 2026-06-29  |  Last commit: `f4e4bbb` — feat(inf-8): close offline queue loop — IDB count + SW message relay in banner

## Active task
**INF-9** — E2E tests: Playwright, golden paths (login → checkout, inventory receive, invoice pay), run in CI against real backend + Postgres.
Status: not started

## Files in flight
None — INF-8 committed cleanly. No uncommitted changes.

## Recent decisions
- **INF-8 offline queue** — Two queues: localStorage (cart sync via syncOutbox) + IndexedDB (payment captures via offlineOutbox → SW Background Sync). SW was already complete; TenderScreen already enqueues to IDB. Gap closed: OfflineQueueBanner now tracks IDB count + listens for OUTBOX_ITEM_REPLAYED from SW.
- **UX-2 module marketplace** — `/setup/modules` page: left sidebar nav, right card grid, toggles, sticky save bar. Mock handler added to mockHandlers.ts for /settings/business-profile.
- **UX-3 dashboard widgets** — `VerticalWidgets.tsx`: 8 self-fetching widgets, WIDGET_MAP keyed by module name, fails silently, injected above operational widgets in dashboard.

## Context cliff notes
- Offline: localStorage = cart sync orders; IDB = payment captures. Both shown in OfflineQueueBanner.
- SW (`web/public/sw.js`) reads IDB store `checkout_queue` in DB `finder-pos-outbox`; sends OUTBOX_ITEM_REPLAYED to terminal tabs on success.
- TenderScreen sends `X-Idempotency-Key: <outbox item id>` header on replay — backend idempotency middleware deduplicates.
- `requestSync()` in offlineOutbox.ts registers Background Sync AND postMessages SW for immediate attempt.
- `safeLoad` (web/api-client/client.ts) — silent error swallowing for dashboard widgets.
- Module flags key: `module:<key>` (e.g. `module:tables`); `invalidateModuleFlagsCache()` in useModuleFlags.ts.

## Next 3 actions
1. Set up Playwright: `cd web && npm install -D @playwright/test && npx playwright install chromium`
2. Create `web/e2e/checkout.spec.ts` — golden path: login → add product → tender cash → receipt
3. Create `web/e2e/inventory.spec.ts` — receive PO, verify stock level updated

## Blockers
None

## Completed INF items
- INF-1 — pg_advisory_xact_lock migration serialization
- INF-2 — SIGTERM/SIGINT graceful shutdown
- INF-3 — pino structured logger (src/shared/logger.ts)
- INF-4 — Stripe webhook signature verification
- INF-5 — Redis Pub/Sub EventBus fan-out
- INF-6 — AR dunning self-perpetuating scheduled job
- INF-7 — DB.poolStats() + /readyz 503 on pool exhaustion
- INF-8 — Offline terminal: SW drain + IDB client + banner tracking (`f4e4bbb`)
- INF-10 — makeAuthMiddleware(db) + requireScope() API key auth
- INF-11 — Zero console.* in production source (14 files)

## Remaining
- **INF-9** — E2E tests: Playwright, golden paths, CI integration (2-3 days)
