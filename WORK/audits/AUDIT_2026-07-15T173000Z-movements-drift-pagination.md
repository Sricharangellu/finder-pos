# Audit — movements route drift fix + unbounded-list pagination (session D, loop iter 1)

Date: 2026-07-15
Session: Claude session D (Fable 5, VSCode — autonomous loop iteration 1)
Branch: `feat/delivery-pipeline`
Files: `src/modules/inventory/{routes,service}.ts`, NEW `movements-pagination.test.ts`;
`src/modules/audit_log/{routes,service}.ts`, NEW `audit-pagination.test.ts`

## Findings

1. **REAL DRIFT BUG (production impact).** The web client (InventoryTab.tsx,
   MovementsDrawer.tsx) calls `GET /inventory/movements?product_id=…&limit=…`
   — a route that existed ONLY in MSW mocks. On the real backend the path
   bound `productId="movements"` and returned `[]`, so movement panels were
   silently empty in production. Same drift class session E fixed for
   /auth/me (708f914).
2. `InventoryService.movements()` was unbounded — every movement ever for a
   product, no LIMIT (violates the new CODING_STANDARDS cursor policy on an
   append-only table).
3. `audit_log.list()` was offset-only with a `COUNT(*)` scan per request and
   no ORDER BY tiebreaker (unstable page boundaries).

## What was done

- NEW `GET /inventory/movements?product_id=&limit=&cursor=` (registered
  before /:productId routes), returning the `{items, nextCursor, limit}`
  envelope the web client already expects. Missing product_id → 400.
- `movements()` keyset-paginated via shared/pagination (default 50, max
  200). Legacy `/:productId/movements` keeps its bare-array shape, now
  bounded at 200.
- `audit_log.listCursor()` — additive keyset mode, engaged by presence of
  `?cursor` (empty = first page); offset `list()` untouched for existing
  clients (audit-log page still gets `total`). Both paths gained the
  `id DESC` tiebreaker.

## Delivery standard

- **Architecture impact**: none; enforces the documented pagination policy.
- **Database impact**: none (queries use existing tenant-leading indexes;
  keyset comparison on (occurred_at/created_at, id)).
- **Testing evidence**: 6 new tests (cursor round-trip without dup/gap ×2,
  drift-route 200 + 400-on-missing-param, legacy array shape, filters +
  tenant scope, offset-path regression) + 21 existing inventory tests —
  27/27 isolated real-PG. First-ever tests for the audit_log module.
  Typecheck CLEAN. Smoke 20/20.
- **Security impact**: none new; tenant scoping asserted in tests.
- **Rollback**: revert commit; responses are additive.
- **Monitoring needs**: none new.
