# Ascend Forward Plan (authoritative)

Last reviewed: 2026-07-18 (FE↔BE gap scan — see `WORK/audits/AUDIT_2026-07-18T005030Z-fe-be-gap-audit.md`)
Scope reviewed: `/Users/sri/Desktop/Desk/Finder/finder-pos`

> **RESOLVED 2026-07-18 (was STANDING CRITICAL):** the 2026-07-15 API-audit fixes
> were PORTED to `feat/delivery-pipeline` same-day (double-prefix in 10 modules,
> SSO public mount, `requireModule` isolation — without the clean-arch pilot).
> A CI guardrail now prevents recurrence: `npm run gap:scan` fails on any FE call
> with no backend route (see AUDIT_2026-07-18T005030Z addendum). Still open for
> Sri: merge session C's quotes pilot branch, and merge PR #70 to deploy all of it.

> Sequencing is **phase-based, not time-based**. A phase is complete when its exit
> criteria pass — never by calendar. Point-in-time verification results live in the
> dated `WORK/AUDIT_*.md` files, not in this document.

> **QUEUED MAJOR INITIATIVE — `WORK/FOUNDATION_HARDENING.md`.** A whole-repo cleanup /
> governance-consolidation / end-to-end-wiring pass authored by Sri (2026-07-05). Run it
> as a **single exclusive lock claim when no other session is active** — it touches the
> whole tree and will collide otherwise. See that file for the full spec and how to run.

## Executive summary

Ascend is moving in a reasonable technical direction, but it is not deployment-ready as a serious production SaaS product yet.

The project has a strong amount of work completed: a real TypeScript/Express backend, PostgreSQL schema/migrations, modular business domains, a large Next.js frontend, API contracts, documentation, Docker setup, CI definitions, e2e test files, and many enterprise workflows. This is not an empty prototype.

The brutal truth is that the project currently looks overbuilt on the surface and under-proven in production quality. Many screens and modules exist, but several areas appear to depend on mocks, demo flows, optimistic documentation, or basic implementations. The codebase has breadth before depth. That is risky for POS, inventory, accounting, payments, and compliance software because correctness matters more than having every module name in the sidebar.

The right move is not to keep adding more pages. The right move is to harden the shared operating engine end-to-end: login, tenant setup, catalog, inventory receive, POS/order/invoice sales, payment, order lifecycle, return/refund, reporting, audit log, and deployment operations.

## Product scope correction

Ascend is **not only a retail POS**. Ascend is a modular business operating platform
for product-based businesses. Retail POS is one business pack, not the whole product.

The shared operating model is:

```text
Buy / produce / receive goods
-> manage inventory
-> price products
-> sell through POS, invoice, ecommerce, service order, table ticket, or sales order
-> collect payment
-> fulfill / deliver / close
-> report, audit, and reconcile
```

Supported business types should be treated as **business packs on one platform**, not
separate applications:

- Retail and convenience.
- Wholesale / B2B / distribution.
- Restaurants, cafes, bars, and food service.
- Mobile, electronics, serial/IMEI-heavy stores.
- Grocery, food inventory, batch/lot/expiry businesses.
- Ecommerce and omnichannel sellers.
- Service and repair businesses.
- Hospitality, golf, rental, education, entertainment, healthcare, manufacturing, and enterprise operations.

The non-negotiable product rule:

```text
One backend truth. One shared data model. Many configured business experiences.
```

Do not duplicate product, inventory, order, payment, customer, or reporting systems per
vertical. Business packs may add fields, workflows, constraints, navigation, and UI, but
they must reuse the core entities.

## Business pack architecture

Business type selection should create a tenant configuration. It should not fork the app.

Keep these four concepts separate:

| Layer | Meaning | Example |
|---|---|---|
| Plan | What the tenant pays for | Starter, Growth, Enterprise |
| Business type | The operating model selected during onboarding | retail, wholesale, restaurant, mobile_store |
| Entitlements | Which modules/features the tenant can use | invoices, loyalty, price tiers, kitchen display |
| Permissions | What a specific user can do | create quote, approve credit, edit price list |

The app should check all four layers:

```text
Is this module enabled for the tenant?
Is this feature included in the tenant plan?
Does this business type allow this workflow?
Does this user have permission?
```

Business type selection should install defaults:

- Enabled module bundle.
- Default navigation.
- Required fields.
- Default workflows.
- Default role templates.
- Default permissions.
- Default reports.
- Default product/customer/order form sections.
- Default pricing and tax behavior.

Example:

```json
{
  "businessType": "wholesale",
  "enabledModules": ["catalog", "inventory", "customers", "purchasing", "quotes", "invoicing", "payments"],
  "features": {
    "pos": false,
    "quotes": true,
    "invoices": true,
    "loyalty": false,
    "priceTiers": true,
    "creditTerms": true
  },
  "requiredFields": {
    "account": ["legalName", "billingAddress", "primaryContact"],
    "product": ["sku", "name", "price", "cost"]
  },
  "workflows": ["quote_to_sales_order", "sales_order_to_invoice", "purchase_receive_to_inventory"]
}
```

### Current implementation status

The codebase already has a **Partial** first version:

- `src/shared/moduleRegistry.ts` defines core modules, optional modules, and business bundles.
- `GET/POST /api/v1/settings/business-profile` reads/writes business type and module flags.
- `GET /api/v1/capabilities` and `GET /api/v1/settings/capabilities` now expose the
  read-only tenant/user capabilities contract that setup, settings, shell navigation,
  and demo switchers should consume before claiming a business pack is active.
- `GET /api/v1/capabilities/impact` and `GET /api/v1/settings/capabilities/impact`
  now expose the read-only preview contract for business-type or module changes before
  applying them to tenant settings.
- `GET/PUT /api/v1/settings/feature-flags` stores tenant feature flags.
- `POST /api/v1/settings/edition` supports simple retail/wholesale/enterprise presets.
- `web/app/(protected)/setup/business-profile/page.tsx` lets the tenant choose a business type and module bundle.
- `web/app/(protected)/settings/modes/page.tsx` toggles business modes.
- `web/components/EnterpriseShell.tsx` hides navigation by feature flags.
- `web/app/(protected)/settings/permissions/page.tsx` manages role feature access.

This is not the finished architecture yet. Today it mostly controls and reports module
visibility. It now has backend capability and impact contracts, but it does not fully
enforce required fields, workflow constraints, pricing rules, plan entitlements, or
business-pack permissions.

### Target data model

Add or formalize these backend concepts before serious vertical expansion:

```text
tenant_business_profile
tenant_enabled_modules
tenant_feature_entitlements
tenant_business_settings
tenant_required_fields
tenant_pack_versions
business_pack_registry
business_pack_module_changes
role_templates
tenant_roles
tenant_permissions
workflow_templates
tenant_workflows
```

For customers, move toward an account model:

```text
accounts
contacts
addresses
tax_profiles
price_lists
credit_terms
```

Retail can use a simple person account: name, phone, email. Wholesale can unlock the
full business account: legal name, contacts, licenses, tax profile, multiple addresses,
customer-specific pricing, payment terms, and credit limits.

## How developers and companies should see business-type changes

Developers need a source-of-truth matrix. Companies need an in-app impact view.

### Developer view

Create a generated or maintained matrix from the business-pack registry:

| Business type | Module | Status | Enabled by default | Required fields | Workflows | Permissions | Backend proof | UI proof |
|---|---|---|---|---|---|---|---|---|
| retail | loyalty | Partial | yes | customer phone/email optional | sale -> points | loyalty.manage | test name/link | page route |
| wholesale | price_book | Partial | yes | account + price list | quote -> invoice | price_list.edit | test name/link | page route |
| restaurant | kitchen | UI-only/Partial | yes | menu item/modifier | ticket -> KDS | kitchen.view | missing | page route |

Every module change should answer:

- Which core entity does it extend?
- Which business pack enables it?
- Which plan includes it?
- Which permission controls it?
- Which backend validation enforces it?
- Which UI changes when enabled or disabled?
- Which real-backend test proves it?
- Which migration changed the schema?

### Company/admin view

The app should provide a `Business Profile` or `Plan & Modules` screen that shows:

- Current business type.
- Enabled packs.
- Enabled modules.
- Disabled modules and why: not in plan, not in business type, or manually disabled.
- Required fields added by the selected business type.
- Workflows activated by the selected business type.
- Reports activated by the selected business type.
- Role/permission changes created by the selected business type.
- Last module configuration change: actor, time, before/after.

The company should also be able to preview a switch before applying it:

```text
Switch Retail -> Wholesale
Adds: Quotes, Invoices, Price Lists, Credit Terms, Business Accounts
Removes by default: Loyalty Rewards
Changes customer form: Person -> Account + Contacts + Addresses
Changes sale flow: POS sale remains optional; Invoice flow becomes primary
Requires setup: payment terms, tax profile defaults, price tiers
```

This is now implemented at the backend API level through the capabilities and impact
endpoints. The UI still must consume the same contracts before it claims to support
business-mode switching.

## Retail-first execution rule

The business-pack architecture must be built one complete pack at a time.

Current priority:

```text
1. Finish Retail end-to-end.
2. Build the business-pack/capabilities control plane needed to support switching.
3. Only then deepen Wholesale, Restaurant, Mobile/Electronics, Grocery, Ecommerce, and other packs.
```

Retail is the first complete proof because it exercises the shared engine without the
extra complexity of B2B credit, restaurant table state, serial/IMEI lifecycle, or
lot/expiry traceability.

Retail must include:

- Signup, login, logout, session recovery.
- Setup/onboarding for retail business type.
- Business profile and module settings showing retail as active.
- Demo account support that can preview other business types without calling them done.
- Outlet, register, tax, payment mode, receipt settings.
- Product create/edit/list/detail.
- Inventory receive and adjustment through immutable movements.
- POS checkout with tax, discount, loyalty where enabled, payment, receipt.
- Register close and end-of-day reporting.
- Refund/return.
- Audit log coverage.
- Permission-gated owner/manager/cashier paths.

Non-retail business types can remain in the registry and demo preview, but they are
**Planned** or **Partial** until their own end-to-end gates pass after retail.

## Required setup, auth, settings, and demo UX

The product must teach users that Ascend is one platform with configurable business
packs. This should be visible in the first-run and admin flows.

### Signup and setup

- Signup creates the tenant and owner user.
- Setup asks for business type and starts from a curated pack.
- Retail is the default first completed pack.
- Setup must show required next tasks for retail: outlet, register, tax, payment modes,
  receipt, first product, first receiving.
- Setup must not present every vertical as equally complete.

### Login and session

- Login should load effective tenant/user capabilities after authentication.
- The shell/nav should render from capabilities, not from hardcoded assumptions.
- Demo mode must be explicit and visually distinguishable from production mode.

### Settings

Settings must expose a `Business Profile` / `Plan & Modules` view with:

- current business type
- active pack
- enabled modules
- disabled modules and reason
- role templates and active permissions
- required fields by entity
- active workflows
- last business-type/module changes with actor and timestamp

### Demo account switcher

A demo account may switch between business types to show how UI/UX changes, but the
switcher must be based on the same capabilities/pack registry that production will use.

Required demo switcher behavior:

```text
Retail demo -> shows POS, loyalty, simple customer fields, retail reports
Wholesale demo -> previews accounts, contacts, quotes, invoices, price tiers
Restaurant demo -> previews tables, tickets, kitchen display, menu modifiers
Mobile demo -> previews serial/IMEI, repairs, warranties, trade-ins
Grocery demo -> previews lot/batch/expiry, scale labels, traceability
```

Only retail may be marked **Built and verified** until its real-backend gates pass.
Other demo modes must be labeled **Preview**, **Partial**, or **Mocked** depending on
their actual implementation.

## Current state in plain language

Ascend is a modular business operating platform for product-based businesses. It has:

- A backend API that stores and processes business data.
- A frontend web app for owners, managers, cashiers, and staff.
- A PostgreSQL database model.
- A modular structure for catalog, inventory, orders, payments, customers, purchasing, reports, accounting, shipping, settings, team, webhooks, workflows, and vertical modules.
- A documented enterprise architecture and roadmap.
- Local Docker setup and GitHub Actions CI configuration.
- Playwright e2e tests and frontend mock data.

The application is in an advanced prototype / internal alpha state. It is beyond a toy demo, but below production launch quality.

## What is done so far

### Backend

The backend is implemented as a Node.js, TypeScript, Express modular monolith.

Important completed areas:

- Express app assembly in `src/app.ts`.
- PostgreSQL access layer in `src/shared/db.ts`.
- Gateway middleware for auth, request IDs, rate limiting, metrics, error envelopes, and CORS.
- Identity module with users, JWT auth, refresh-related flows, MFA-related types/routes, and tests.
- Domain modules under `src/modules`.
- Orchestration layer under `src/orchestration` with commands, events, sagas, workflows, locks, compensations, retry state, and jobs.
- Stripe payment integration surface and webhook signature verification.
- Health/readiness endpoints.
- Migration hashing and advisory lock around schema migrations.
- Test files across many modules.

Backend typecheck passed locally with:

```bash
npm run typecheck
```

That is a good sign.

### Frontend

The frontend is a Next.js 14 app under `web/`.

Important completed areas:

- Login/signup flows and protected layouts.
- Large protected app area with many pages.
- POS terminal UI components.
- Catalog/product pages.
- Customer pages.
- Inventory pages.
- Purchasing pages.
- Reporting pages.
- Settings, team, workflow, ecommerce, finance, shipping, vertical module pages, and more.
- Reusable components such as Button, Card, Table, Modal, Toast, Input, Select, KPI cards, shell, notification bell, offline banner, receipt, and charts.
- Frontend API client and generated type structure.
- MSW mock handlers for development/demo mode.
- Playwright e2e specs.

Frontend typecheck passed locally with:

```bash
cd web
npm run typecheck
```

Frontend lint was initially blocked by a corrupted `es-abstract` install in
`web/node_modules`; this was repaired on 2026-07-03 (targeted package reinstall).
Current lint/test/build results are recorded in `WORK/AUDIT_2026-07-03.md`.

### Documentation

The project has substantial documentation:

- `README.md`
- `WORK_STATE.md`
- `docs/ENTERPRISE_ARCHITECTURE.md`
- `docs/ENTERPRISE_PRODUCT_SPEC.md`
- `docs/ENTERPRISE_UX_SPEC.md`
- `docs/ENTERPRISE_INVENTORY_PIPELINE.md`
- `docs/ENTERPRISE_DOMAIN_ROADMAP.md`
- API docs under `docs/api`
- contracts under `contracts`
- orchestration docs and gap analyses under `orchestration`

The documentation is useful, but it is too optimistic in places. Some docs describe the desired product as if it is already production-complete. That makes planning harder because it hides the difference between built, mocked, partially wired, and verified.

## Architecture summary

### Current architecture

Ascend is currently a modular monolith:

- Frontend: Next.js 14, React, TypeScript, Tailwind.
- Backend: Express, TypeScript, PostgreSQL.
- Database: raw SQL migrations and raw SQL query helper.
- Auth: JWT-based auth with role/permission direction.
- Business logic: grouped by domain modules.
- Orchestration: commands, events, workflows, sagas, locks, compensation logic.
- Realtime: SSE and Redis/event bus direction.
- Deployment target: Vercel for frontend/backend plus managed Postgres.

This architecture is acceptable for the current stage. A modular monolith is the correct choice. Do not split this into microservices yet.

### What is good

- The codebase has clear domain boundaries.
- TypeScript is used across backend and frontend.
- The backend has a real database and migrations.
- Money is treated as integer cents in the architecture.
- There is a serious attempt at multi-tenant design.
- There is an orchestration layer for complex business workflows.
- The app has CI and e2e direction.
- The frontend has many operational screens, not just a landing page.

### What is risky

- Too many modules exist before the core path is fully proven.
- Frontend mocks are extensive, which can make screens look complete before backend behavior is truly integrated.
- Documentation overstates completion.
- Production security posture is not fully proven.
- POS/payment/accounting flows require stronger invariants, reconciliation, and audit proof than ordinary CRUD apps.
- Deployment readiness depends on CI, secrets, database migrations, e2e tests, and operational monitoring, not just successful typecheck.
- There are generated/build/dependency artifacts in the repo tree, including `.next`, `dist`, `node_modules`, and multiple duplicate-looking `.git` files. This should be cleaned carefully if those are tracked or polluting the working tree.

## Security review

Security is partially addressed, but not finished.

Good signs:

- Production startup fails if `JWT_SECRET` or `DATABASE_URL` is missing.
- Helmet is enabled.
- CORS is restricted in production by allowlist.
- Stripe webhook uses raw body and signature verification.
- There is rate limiting.
- Metrics endpoint supports bearer token protection.
- SQL helper appears designed around parameterized queries.
- CI includes checks for unguarded mutation routes and raw SQL interpolation.

Concerns:

- Some production security settings are warnings, not hard failures, including Redis and Stripe.
- If `WEBHOOK_SECRET_KEY` is unset, webhook secrets may be stored in plaintext according to `.env.example`.
- If `METRICS_TOKEN` is empty, metrics may be unauthenticated according to `.env.example`.
- Redis is optional, so rate limiting may be per-instance in production if Redis is not configured.
- MFA/device verification pages contain mocked flows.
- Frontend auth has mock/demo refresh-token behavior.
- Role and permission enforcement must be audited endpoint-by-endpoint and component-by-component.
- Row Level Security policies exist in `db/rls/policies.sql`, but production enforcement needs proof, tests, and deployment confirmation.
- Secrets, Vercel env vars, database URLs, Stripe keys, webhook keys, SendGrid keys, and JWT secrets need a formal rotation and environment checklist.

Security conclusion: not production-ready for real customers until RBAC, tenant isolation, secret handling, RLS, rate limiting, audit logging, and auth flows are verified with tests and production configuration.

## Deployment readiness

Current answer: no, not confidently deployment-ready.

The app may be deployable as a demo or preview environment, but it should not be treated as ready for real stores, real payments, real inventory, or real compliance.

Reasons:

- Backend typecheck passes, but full backend tests were not run in this review.
- Frontend typecheck passes, but frontend lint fails locally due to dependency integrity.
- Frontend build was not verified in this review.
- E2E tests were not run in this review.
- Mocks are still a major part of the frontend experience.
- Security posture needs hardening.
- Production environment variables and Vercel configuration need verification.
- Database migration strategy needs a real production runbook and rollback procedure.
- Operational monitoring, alerting, backups, restore tests, logs, and incident flow need proof.
- Payment, refund, inventory, and accounting correctness need deeper test coverage.

Deployment recommendation:

- Demo deployment: acceptable.
- Internal alpha with fake payments and demo data: acceptable.
- Pilot with one friendly store and limited scope: only after hardening the core path.
- General production launch: not ready.

## Is the app going in the right direction?

Yes, directionally, but it needs discipline.

The good direction:

- Modular monolith.
- TypeScript.
- Postgres.
- Domain-driven modules.
- Offline-first thinking.
- Event/workflow architecture.
- Rich operational UI.
- Serious docs and contracts.

The bad direction:

- Too much feature breadth too early.
- Too many pages before end-to-end proof.
- Mock-heavy frontend can create false confidence.
- Documentation sometimes sounds like a sales brochure instead of an engineering status report.
- Enterprise scope is too large for the current maturity level.

The product should narrow temporarily. Build one excellent POS/inventory/accounting spine before expanding vertical modules like healthcare, hospitality, golf, automotive, etc.

## Development areas that need attention

### 1. Core POS flow

Must be proven end-to-end:

1. Login.
2. Open register.
3. Scan/search product.
4. Add to cart.
5. Apply tax and discount.
6. Take payment.
7. Create order.
8. Reduce inventory through immutable movement.
9. Print/email receipt.
10. Close register.
11. Report sales and cash/card totals.
12. Refund or return.
13. Reconcile payment and accounting entries.

This should be the main release gate.

### 2. Inventory correctness

Needed:

- Strict inventory ledger.
- No silent stock updates.
- Oversell prevention.
- Reservations.
- Batch/lot/expiry correctness.
- Receiving flow tied to vendor cost.
- Cycle count adjustments with audit trail.
- Transfer workflow with source/destination movement records.

### 3. Accounting and reporting

Needed:

- Clear chart of accounts behavior.
- Journal entry generation from payments, refunds, deposits, purchase receiving, and adjustments.
- Reconciliation reports.
- End-of-day reports.
- Register close reports.
- AR/AP aging only if the data model is truly wired.

### 4. Frontend integration

**Gap scan done 2026-07-18** (`AUDIT_2026-07-18T005030Z-fe-be-gap-audit.md`), and
the first remediation wave shipped same-day (see the audit's addendum): the
double-prefix/SSO/requireModule fixes are ported, team time-tracking + customers
search/merge + orders timeline are real endpoints now, storefront auth is gated
Preview, and `npm run gap:scan` enforces parity in CI from here on. Remaining
mock-only surfaces (all allowlisted + tracked): catalog product-detail tabs (16
paths, next biggest win), inventory pipeline/errors (13), notifications
prefs/rules (4), purchasing EDI (6), workflows approval-chains (3), settings
b2b/permissions/custom-roles (contract decision — NEEDS-SRI), plus the
by-design Preview verticals (golf/pricing/warehouse/documents/promotions).
174 backend paths remain unsurfaced by any page (map for future UI work).

Needed:

- Audit every page and classify it as live, mocked, partial, or static.
- Remove or clearly label demo-only behavior.
- Replace MSW routes with real API calls module-by-module.
- Keep mocks only for local development and tests.
- Add visible error/loading/empty states consistently.

### 5. Security

Needed:

- Permission matrix.
- Endpoint-level RBAC audit.
- Component-level permission gates.
- Tenant isolation tests.
- RLS enforcement.
- Secret encryption.
- Auth/session hardening.
- MFA completion or removal from production UI until complete.
- Rate limiting backed by Redis in production.

### 6. Testing

Needed:

- Backend integration tests for every money/inventory/order mutation.
- Frontend component tests for critical forms and terminal flows.
- Playwright e2e tests for golden paths.
- Security regression tests for tenant isolation and RBAC.
- Migration tests.
- Smoke tests against deployed preview.

### 7. Deployment and operations

Needed:

- Clean CI from fresh install.
- Staging environment with isolated database.
- Production environment checklist.
- Database backup and restore test.
- Migration rollback runbook.
- Observability: logs, metrics, tracing, alerts.
- Error reporting.
- Uptime checks.
- Payment/webhook replay procedure.

## Recommended forward plan

### Phase 1: Truth and cleanup

Goal: know exactly what is live, mocked, partial, and broken.

Tasks:

- Create a page/module status matrix.
- Mark each backend endpoint as tested or untested.
- Mark each frontend page as live API, mock, static, or partial.
- Refresh frontend dependencies and make lint pass from a clean install.
- Run backend tests, frontend build, and Playwright e2e.
- Remove misleading deployment-ready language from docs.

Exit criteria:

- `npm run typecheck` passes.
- `npm test` passes.
- `cd web && npm run typecheck && npm run lint && npm run build` passes.
- E2E golden path passes locally or in CI.
- Status docs use honest labels.

### Phase 2: Retail release pack

Goal: make one complete business type reliable end-to-end. The first complete business
type is retail.

Build and verify:

- Signup, login, logout, and session recovery.
- Retail tenant setup/onboarding.
- Business profile and module settings showing retail as active.
- Role/permission basics.
- Catalog products.
- Inventory receive.
- Register open/close.
- POS checkout.
- Payment capture or simulated payment in non-production.
- Order creation.
- Inventory decrement.
- Receipt.
- Return/refund.
- End-of-day report.
- Audit log.
- Retail demo account path.

Exit criteria:

- One complete retail POS workflow works without mocks.
- Retail setup/settings/auth flows work against the real backend.
- Retail owner/manager/cashier permission paths are proven.
- Retail demo mode is clearly separated from production mode.
- Every mutation has a test.
- Every mutation is tenant-scoped and permission-checked.

### Phase 3: Business-pack control plane

Goal: turn current module flags into a reliable capabilities and business-mode system
without deepening other verticals yet.

Tasks:

- DONE: Build `GET /api/v1/capabilities` for the current tenant/user.
- DONE: Build a read-only business-type/module impact preview endpoint.
- Formalize plan, business type, entitlements, modules, required fields, workflows, and
  permissions as separate concepts.
- Make setup, settings, shell navigation, and demo mode read from capabilities.
- Record business-type/module changes with audit history.
- Add a developer-facing business-pack matrix generated from the registry and test
  evidence.

Exit criteria:

- A developer can see what each business type changes by reading one matrix/source of truth.
- A company admin can preview what will change before switching business type.
- The backend enforces disabled modules/features; frontend hiding is not the only guard.
- Demo account switching uses the same registry/capabilities model as production.

### Phase 4: Production hardening

Goal: make deployment safe.

Tasks:

- Configure production env vars.
- Require Redis or equivalent for rate limiting/event propagation.
- PARTIAL: enable secure metrics token. Production no-token `/metrics` now closes with
  `503 metrics_unconfigured`; set `METRICS_TOKEN` to allow authorized scraping.
- Encrypt webhook secrets.
- Verify Stripe webhook and payment flows.
- Verify DB backup/restore.
- Verify migration lock and rollback plan.
- DONE: add backend operational readiness checks to deployment via `npm run ops:check`.
- DONE: add `PG_SSL` override so production-mode checks can run against local/CI
  Postgres while production still defaults to SSL.
- Add monitoring and alerting.

Exit criteria:

- Fresh CI passes.
- Staging deploy passes smoke/e2e.
- Security checklist passes.
- Restore from backup is tested.

### Phase 5: Business expansion

Goal: expand business packs without duplicating the core.

Priority order:

1. Wholesale pack: accounts, price tiers, quotes, invoices, terms, credit limits.
2. Ecommerce pack: online catalog, order sync, fulfillment, customer portal.
3. Restaurant/food pack: tables, kitchen display, modifiers, tips, split checks.
4. Mobile/electronics pack: serial/IMEI, trade-ins, warranties, repairs.
5. Grocery/food inventory pack: lot/batch/expiry, scale labels, traceability.
6. Enterprise pack: approvals, SSO, audit depth, workflow automation, advanced analytics.

## Suggested better architecture decisions moving forward

Keep:

- Modular monolith.
- TypeScript.
- PostgreSQL.
- Integer cents for money.
- Domain modules.
- Event/workflow layer.

Improve:

- Consider Drizzle or Prisma only if raw SQL becomes too hard to maintain. Do not migrate ORM just for style.
- Introduce a formal API contract generation workflow so frontend types always match backend routes.
- Keep orchestration, but avoid making every simple CRUD operation a saga.
- Create one shared permission registry used by backend, frontend, and docs.
- Create one shared business-pack registry used by backend, frontend, onboarding, and docs.
- Add a capabilities endpoint that returns effective modules, features, required fields,
  workflows, and permissions for the current tenant/user.
- Add a business-mode impact endpoint before allowing a company to switch packs in production.
- Use a strict module readiness checklist before calling anything built.
- Separate demo/mock mode from production mode at build and runtime.

Avoid:

- Microservices.
- More vertical modules before core reliability and business-pack enforcement.
- Adding AI features before data correctness.
- Treating docs as proof of implementation.
- Treating Vercel deployment success as production readiness.

## Human-language status labels to use from now on

Use these labels in docs:

- Built and verified: implemented, tested, and working against real backend/data.
- Built but not verified: implemented, typechecks, but lacks full tests/e2e.
- UI-only: screen exists but does not prove backend behavior.
- Mocked: works through MSW/demo data only.
- Partial: some backend/frontend exists but missing important behavior.
- Planned: documented but not implemented.
- Not production-ready: works locally/demo but lacks security/ops/testing requirements.

## Reusable prompt for the next end-to-end audit

Use this prompt with a coding agent when you want a fresh project audit:

```text
Audit the Ascend project end-to-end.

Work from the repository, not from assumptions. Inspect the backend, frontend, database migrations, contracts, docs, tests, CI/CD, deployment scripts, environment examples, and mock/demo layers.

Write a plain-English report that answers:

1. What is the current state of the Ascend application?
2. What is genuinely implemented?
3. What is only mocked, partial, static, or documented but not built?
4. What is the architecture and schema direction?
5. What are the biggest security risks?
6. Is the app deployment-ready? Be direct and honest.
7. What development areas need the most work?
8. What should the forward plan be for design, development, implementation, testing, security, and deployment?
9. Is the app going in the right direction, or is the project spreading too wide?

Use evidence from files and commands. Run at least:

- backend typecheck
- backend tests if available
- frontend typecheck
- frontend lint
- frontend build
- e2e tests if practical

Do not overwrite existing work-state docs. Write the audit as a new dated file at WORK/AUDIT_YYYY-MM-DD.md and follow the rules in WORK/README.md. Be brutally honest but practical. Separate "built", "verified", "mocked", "partial", and "planned". End with a prioritized phase plan and release gate checklist.
```

## Release gate checklist

Ascend should not be considered production-ready until all of these are true:

- Backend typecheck passes.
- Backend tests pass.
- Frontend typecheck passes.
- Frontend lint passes.
- Frontend build passes.
- Playwright golden paths pass.
- No production UI depends on MSW mocks.
- Core POS flow works on real backend.
- Payment/refund flow is tested.
- Inventory ledger is immutable and tested.
- Tenant isolation is tested.
- RBAC is tested.
- RLS is enabled or tenant isolation is otherwise proven.
- Production secrets are configured and rotated.
- Redis or equivalent shared rate limiting is configured.
- Metrics are protected.
- Webhook secrets are encrypted.
- Backups and restore are tested.
- Staging deploy passes smoke tests.
- Production rollback procedure exists.

## Final honest assessment

Ascend has strong bones. The project is ambitious and technically serious. The stack choice is reasonable and the modular monolith direction is correct.

But the app is not ready for real production use yet. The current risk is not lack of features. The current risk is too many features without enough proof. For POS software, correctness, security, auditability, and operational reliability matter more than breadth.

The best path forward is to stop expanding temporarily, verify the truth, harden the core retail workflow, and then grow outward from a stable base.
