# AI Build Instructions for Finder POS

Read this before using Claude, Codex, Cursor, ChatGPT, or any other AI agent on this project.

> Canonical copy — saved to `WORK/` 2026-07-03 by Sri's directive; follow on every task.
> Companions: `WORK/README.md` (folder rules) · `WORK/WORK_STATE.md` (active task) ·
> `WORK/FORWARD_PLAN.md` (phase plan) · newest `WORK/AUDIT_*.md` (verified truth).

## Strict rule

Do not build more features until the current project state is verified.

Finder POS already has many modules, pages, documents, and claims. The risk is not lack of ideas. The risk is building wider before proving that the core product works correctly.

## Multi-agent rule

Only one agent may work a queue item at a time.

Before editing code:

1. Pull latest with `git pull --ff-only origin master`.
2. Read `WORK/LOCK.md`.
3. If `WORK/LOCK.md` is `FREE`, claim exactly one queue item.
4. If `WORK/LOCK.md` is `ACTIVE` and overlaps your intended task, stop.
5. If you see unexpected failures, check for another active process, dirty tree, changed branch, or lock conflict before debugging the application.

At handoff:

- Record results in `WORK/WORK_STATE.md`.
- Create a new audit only for new verification evidence.
- Commit and push.
- Release `WORK/LOCK.md` back to `FREE`.

Never leave an unpushed local fix while another agent may start from GitHub. That creates duplicate work and misleading failures.

## What every AI agent must understand

Finder is not a normal CRUD dashboard. It is a POS, inventory, payment, accounting, and compliance system.

That means correctness matters more than speed.

The app must protect:

- money
- inventory
- customer data
- tenant isolation
- refunds
- payments
- audit history
- permissions
- compliance records

If an AI agent creates a nice-looking screen that is not wired to real backend behavior, that is not progress. It is only UI.

## First job for any AI agent

Before building, audit.

The agent must inspect the actual codebase and classify every area as:

- Built and verified
- Built but not verified
- UI-only
- Mocked
- Partial
- Planned only
- Broken

Do not trust the README, roadmap, or work-state docs without code and test evidence.

## Core workflow to prove first

The first production-quality workflow must be:

```text
Login
→ tenant/user/session verified
→ open register
→ product exists in catalog
→ inventory exists
→ scan/search product
→ add to cart
→ calculate tax/discount
→ take payment
→ create order
→ create immutable inventory movement
→ create receipt
→ close register
→ end-of-day report
→ refund/return if needed
→ audit log records every important action
```

If this flow is not proven end-to-end without mocks, the app is not production-ready.

## Non-negotiable engineering rules

### Multi-tenancy

Every business-owned table must have tenant isolation.

Every query must be tenant-scoped.

No user from one tenant should ever be able to see or modify another tenant's data.

### RBAC

Every sensitive backend route must check permissions or roles.

Every sensitive frontend action must be permission-gated.

Do not show buttons for actions the user cannot perform.

### Inventory

Never silently update stock quantity.

Every inventory change must create an inventory movement record.

Examples:

- sale
- return
- purchase receive
- transfer in
- transfer out
- adjustment
- count correction
- damage
- loss

### Money

Never use floating point values for money.

Use integer cents in the database and API.

Only format dollars/currency at the UI display layer.

### Orders

Orders should use status transitions.

Do not silently rewrite historical order/payment/refund records.

### Payments and refunds

Payments and refunds must be auditable.

Every payment/refund mutation needs tests.

Stripe/webhook behavior must be verified before production.

### Security

Before production, verify:

- JWT secret is strong and configured
- refresh/session behavior is secure
- MFA/device flows are real or hidden
- CORS is correct
- metrics are protected
- Redis/shared rate limiting is configured
- webhook secrets are encrypted
- no production feature depends on mock auth
- no secrets are committed

### Mocks

Mocks are allowed only for:

- local development
- tests
- demo mode clearly separated from production

Mocks are not production features.

If a page depends on MSW/mock handlers, label it as mocked or partial.

## What not to do

Do not:

- add another vertical module
- add another dashboard just because it looks useful
- claim something is complete because a page exists
- build UI without backend contract
- build backend without frontend integration plan
- add AI features before data correctness
- add microservices
- rewrite the architecture casually
- change database rules without migration tests
- touch production deploy until CI and smoke tests pass

## Required background work before building with AI

Before asking AI to implement anything, prepare this:

### 1. Product definition

Answer:

- Who is the exact user?
- What task are they trying to complete?
- What is the business outcome?
- What must never fail?
- What is out of scope?

### 2. Domain rules

Write rules for:

- money
- tax
- inventory
- returns
- refunds
- discounts
- permissions
- tenant isolation
- audit logs
- reporting

### 3. Data model

Define:

- tables
- relationships
- required fields
- indexes
- unique constraints
- tenant ownership
- audit fields
- migration plan

### 4. API contract

Define:

- route
- method
- request body
- response body
- error codes
- auth requirement
- permission requirement
- idempotency behavior

### 5. UI behavior

Define:

- page route
- user actions
- loading state
- empty state
- error state
- success state
- validation
- confirmation dialogs
- permission-disabled state

### 6. Test plan

Define:

- unit tests
- backend integration tests
- frontend component tests
- e2e tests
- security tests
- migration tests

### 7. Deployment plan

Define:

- local environment
- staging environment
- production environment
- required secrets
- database migration process
- rollback plan
- backup/restore plan
- smoke tests
- monitoring

## Definition of done

A feature is done only when all are true:

- backend endpoint exists
- database persistence exists
- tenant isolation exists
- permission check exists
- audit log exists where needed
- frontend calls real backend
- loading, empty, error, and success states exist
- validation exists
- tests exist
- e2e path is covered if it is a critical workflow
- docs are updated honestly
- no mock is required in production

## Prompt to give Claude before each task

Use this prompt:

```text
You are working on Finder POS.

Before coding, inspect the existing implementation and classify the relevant area as built, verified, UI-only, mocked, partial, planned, or broken.

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

If the requested change would make the app look more complete without making it more correct, stop and explain why.

After implementation, run the relevant typecheck, tests, lint/build, and report honestly what passed and failed.
```

## Best next build target

The next useful work is not a new feature.

The next useful work is a release-readiness matrix.

**Filled from evidence, 2026-07-03 live-stack audit** (`WORK/AUDIT_2026-07-03B.md`):
`npm run smoke` 13/13 on real Postgres; authenticated probe of all 484 frontend-declared
endpoints (~464 real); first-ever complete Playwright run against production build +
real backend: **25 passed / 22 failed**. Update this table only with new evidence.

| Area | Backend | Frontend | Real DB | Tests | E2E | Mocked? | Production-ready? |
|---|---|---|---|---|---|---|---|
| Auth (login/JWT/tenant) | ✅ verified (smoke) | ✅ logs in vs real backend | ✅ | ✅ backend | ⚠️ login passes; logout spec fails | MFA/device flows mocked | No |
| Catalog | ✅ verified (create/list/detail) | ✅ built | ✅ | ⚠️ 5 stale FE tests | ⚠️ in failing checkout specs | dev-mode only | No |
| Inventory receive | ✅ verified (smoke) | ✅ pages exist | ✅ | ✅ backend PO lifecycle | ❌ 3 specs failing | dev-mode only | No |
| Inventory transfers/adjustments | ❌ MISSING — mock-only endpoints | UI exists | ❌ | ❌ | ❌ | **Mocked** | No |
| Checkout | ✅ verified (order+tax, smoke) | ✅ terminal built | ✅ | ✅ backend | ❌ 3 specs failing (partly stale locators) | dev-mode only | No |
| Payment | ✅ verified (split tender; card SIMULATED, no Stripe key) | ✅ | ✅ | ✅ backend | ❌ | Stripe capture unverified | No |
| Refund/return | ✅ verified (refund+restock, smoke) | Built but not verified | ✅ | ✅ backend | ❌ not covered | dev-mode only | No |
| Register open/close | Built but not verified (endpoints exist) | Built but not verified | ✅ | ⚠️ | ❌ not covered | dev-mode only | No |
| Reports | Built but not verified (endpoints exist) | ⚠️ 3 stale FE tests | ✅ | ⚠️ | ❌ | dev-mode only | No |
| Audit log | Partial (module exists; coverage of critical actions unproven) | ✅ page | ✅ | ⚠️ | ❌ | dev-mode only | No |
| Orchestration (workflows/sagas) | **Broken** — tables missing from migrations, 21 commands unregistered, silent runtime failures | n/a | ❌ | unit-only (stubbed DB) | ❌ | n/a | No |
| Vendor 360 | ❌ MISSING (6 routes; backend has /suppliers only) | UI exists | ❌ | ❌ | ❌ | **Mocked** | No |
| Vertical pages | varies | UI exists | — | — | ❌ 12 specs fail; some crash without mocks | **Mocked** | No — expansion paused |
| Deployed frontend (all areas) | — | — | — | — | — | **100% mock mode by config** (`NEXT_PUBLIC_MOCK` default true) | No |

Build only the highest-priority missing links (priority order lives in
`WORK/WORK_STATE.md` "Confirmed defects").

## Final instruction

Be honest.

Finder should become smaller, stronger, and more proven before it becomes bigger.
