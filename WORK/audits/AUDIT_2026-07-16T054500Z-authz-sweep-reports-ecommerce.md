# Audit — module-wide authz sweep: reports + ecommerce mutation guards (loop iter 7)

Date: 2026-07-16
Session: Claude session D (Fable 5, autonomous loop iter 7 — first post-merge)
Branch: `feat/delivery-pipeline` (new batch; PR #66 already merged to master)
Files: `src/modules/reports/routes.ts` + reports.test.ts; `src/modules/ecommerce/routes.ts` + ecommerce.test.ts

## Finding (verified sweep)

Extended iter-6's authz check across ALL modules: for each, counted mutation
routes vs. any guard (requireRole/requireCapability/requireModule/
requireManagement). Raw hits: ecommerce, notifications, orders, payments,
quotes, reports, team. Semantic triage:
- **orders, payments** — intentionally cashier-accessible (that IS the POS;
  cashiers ring sales). Not gaps. payments also = session B's claim.
- **quotes** — session C's claim. Not touched.
- **team** — FALSE POSITIVE: guarded via in-handler `requireManagement()` +
  explicit owner-check for granting owner. Correctly protected.
- **notifications** — mark-read endpoints legitimately open (recipient acting
  on own tenant view); create endpoint low-risk. Left as a minor follow-up.
- **reports POST /ar-aging/sweep** — REAL GAP: mutates AR/dunning state (flags
  overdue invoices with dunning_level), unguarded → any cashier could trigger
  a dunning sweep.
- **ecommerce PUT /products/:id/online** — REAL GAP: publishes/unpublishes a
  product to the storefront (merchandising), unguarded. (POST /checkout stays
  open by design for the customer storefront.)

## What was done

- Added `requireRole("manager")` to both real gaps. reports already imported
  requirePlan from gateway/auth (added requireRole); ecommerce added the
  import. gateway/auth.ts itself only imported, not edited (session C's claim).

## Delivery standard

- **Architecture impact**: none; applies the standard requireRole mutation gate.
- **Database impact**: none.
- **Testing evidence**: 2 new tests (cashier 403 + manager 200 on each). reports
  11/11, ecommerce 9/9 isolated real-PG (a cross-file end-of-day failure was the
  documented PG_POOL_MAX=1 parallel flake — both suites green alone). Typecheck
  CLEAN. Smoke 20/20.
- **Security impact**: closes two privilege gaps — a cashier could previously
  trigger AR dunning or control storefront publishing.
- **Rollback**: revert commit (guards only).
- **Monitoring**: none new.

## Follow-ups (noted, not taken)

- notifications POST / (create) is unguarded but low-risk — a manager gate is
  defensible; deferred as minor.
- payments/quotes mutation-guard review belongs to sessions B/C (their claims).
