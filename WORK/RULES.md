# Finder POS — Build Rules (follow on every task)

Saved 2026-07-03 by Sri's directive. Every agent, workflow, and AI session follows this
document. It outranks README claims, work-state optimism, and any prior roadmap.
Companion docs: `WORK/README.md` (folder rules) · `WORK/FORWARD_PLAN.md` (phase plan) ·
newest `WORK/AUDIT_*.md` (verified truth).

## Prime directive

**Do not build more features yet. Stop expanding, audit truth, harden the core retail
POS workflow, then expand only after the core is proven.**

- No new vertical modules.
- No new dashboard pages.
- No fake "enterprise complete" claims.
- Do not add breadth until the current workflow is complete end-to-end.
- Finder should become smaller, stronger, and more proven before it becomes bigger.

## The core flow (verify before adding anything)

Login → open register → catalog product → receive inventory → checkout → payment →
order → inventory movement → receipt → return/refund → register close → report → audit log.

## Status labels (mandatory, evidence-only)

Classify every area as: **Built and verified** · **Built but not verified** · **UI-only** ·
**Mocked** · **Partial** · **Planned only** · **Broken**.
Do not trust README or work-state claims unless code, tests, and real app behavior prove
them. If a screen uses mocks, label it mocked. If it is not tested, say not verified.

## Domain rules (every change must keep these)

- Money is integer cents.
- Inventory changes only through immutable ledger movements.
- Orders use status transitions.
- Refunds are traceable.
- Multi-tenant isolation — tenants can never see each other's data.
- RBAC permissions control every sensitive action, backend and frontend.
- Audit logging on critical actions.
- Real backend integration — no production dependency on mocks.
- Tests for critical mutations.
- Production/security readiness in mind on every change.

## Definition of done (a page existing is NOT done)

A feature is done only when ALL are true:

- backend endpoint exists
- database persistence exists
- tenant isolation exists
- permission check exists
- audit log exists where needed
- frontend calls real backend
- loading, empty, error, and success states exist
- validation exists
- tests exist (unit + backend integration; component/e2e where critical)
- e2e path is covered if it is a critical workflow
- docs are updated honestly
- no mock is required in production

## Before building any feature, define

1. **Product**: who uses it, what problem, smallest useful version, what must never go wrong.
2. **Schema**: tables, relationships, required fields, indexes, unique constraints,
   tenant ownership, audit fields, migration plan.
3. **API contract**: route, method, request/response body, error codes, auth requirement,
   permission requirement, idempotency behavior.
4. **UI behavior**: page route, user actions, loading/empty/error/success states,
   validation, confirmation dialogs, permission-disabled state.
5. **Test plan**: unit, backend integration, frontend component, e2e, security, migration tests.
6. **Deployment plan**: local/staging/production environments, required secrets,
   migration process, rollback plan, backup/restore, smoke tests, monitoring.

## Build order (dependency sequence — never skip ahead)

auth → tenants/users/roles → catalog → inventory → checkout → payments →
returns/refunds → reports → audit logs → deployment/security.

## Prompt to give the agent before each task

```text
You are working on Finder POS.

Before coding, inspect the existing implementation and classify the relevant area as
built, verified, UI-only, mocked, partial, planned, or broken.

Do not trust docs unless code and tests prove them.

Do not add new feature breadth. Harden the smallest necessary workflow.

Respect these rules:
- multi-tenant isolation
- RBAC on backend and frontend
- immutable inventory movements
- integer cents for money
- auditable orders/payments/refunds
- no production dependency on mocks
- tests for critical mutations

If the requested change would make the app look more complete without making it more
correct, stop and explain why.

After implementation, run the relevant typecheck, tests, lint/build, and report honestly
what passed and failed.
```

## Release-readiness matrix (filled from evidence, 2026-07-03 live-stack audit)

Evidence sources: `npm run smoke` 13/13 on real Postgres; authenticated probe of all 484
frontend-declared endpoints; production-build Playwright run; unit suites.
See `WORK/AUDIT_2026-07-03B.md` for details. Update this table only with new evidence.

| Area | Backend | Frontend | Real DB | Tests | E2E | Mocked? | Production-ready? |
|---|---|---|---|---|---|---|---|
| Auth (login/JWT/tenant) | ✅ verified (smoke) | ✅ renders, logs in | ✅ | ✅ backend | ⚠️ setup passes; logout spec failing | MFA/device flows mocked | No |
| Catalog | ✅ verified (create/list/detail 200) | ✅ built; ProductGrid unit tests stale | ✅ | ⚠️ 5 stale FE tests | ⚠️ failing specs | dev-mode only | No |
| Inventory receive | ✅ verified (smoke receive→stock) | ✅ pages exist | ✅ | ✅ backend PO lifecycle | ⚠️ failing specs | dev-mode only | No |
| Inventory transfers/adjustments | ❌ MISSING — mock-only endpoints | UI exists | ❌ | ❌ | ❌ | **Mocked** | No |
| Checkout | ✅ verified (order+tax, smoke) | ✅ terminal built | ✅ | ✅ backend | ⚠️ failing specs | dev-mode only | No |
| Payment | ✅ verified (split tender; card SIMULATED — no Stripe key) | ✅ | ✅ | ✅ backend | ⚠️ | Stripe capture unverified | No |
| Refund/return | ✅ verified (refund+restock, smoke) | Built but not verified | ✅ | ✅ backend | ❌ not covered | dev-mode only | No |
| Register open/close | Built but not verified (endpoints exist) | Built but not verified | ✅ | ⚠️ | ❌ not covered | dev-mode only | No |
| Reports | Built but not verified (endpoints exist) | ⚠️ 3 stale FE tests | ✅ | ⚠️ | ❌ | dev-mode only | No |
| Audit log | Partial (module+endpoint exist; coverage of critical actions unproven) | ✅ page | ✅ | ⚠️ | ❌ | dev-mode only | No |
| Orchestration (workflows/sagas) | **Broken** — tables missing, 21 commands unregistered, silent failures | n/a | ❌ | unit-only (stubbed) | ❌ | n/a | No |
| Vendor 360 | ❌ MISSING (6 routes; backend has /suppliers only) | UI exists | ❌ | ❌ | ❌ | **Mocked** | No |
| Deployed frontend (all areas) | — | — | — | — | — | **100% mock mode by config** (`NEXT_PUBLIC_MOCK` default true) | No |

## Final instruction

Be honest. Every report, commit message, and doc update states what passed AND what
failed, with the label vocabulary above.
