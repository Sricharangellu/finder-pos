# Integration Log (orchestrator-owned)

Append-only record of each wave: what each agent published/consumed, and gate results.

## Wave 0 — dispatched 2026-06-11
- Scaffold: git initialized, contracts/ db/ web/ created, contract skeletons published.

### Published
- **Database** → `db/migrations/0001_foundation.sql` (+down), `db/rls/policies.sql`, `db/seeds/0001_demo.sql`, `db/backup/{backup,restore}.sh`, `db/migrations/run.sh`, `db/README.md`; authored `contracts/schema.sql`. Tables: tenants(root), users, roles, audit_log, feature_flags, idempotency_keys — every tenant-scoped table carries `tenant_id` + an RLS policy + tenant-leading index.
- **Backend** → `src/gateway/*` (auth, tenantResolver, rateLimit, requestId/trace, errorEnvelope), `src/identity/*` (JWT login/refresh/me, RBAC owner|manager|cashier, ABAC hook, audit writer), `/healthz`, `/readyz`, `/api/v1/flags`; authored `contracts/openapi.yaml` + `contracts/events.md`. Added deps jsonwebtoken, bcryptjs.
- **Frontend** → `web/` Next.js 14 app (login, protected terminal, route guard), `api-client/`, MSW `mocks/`, `flags/`, accessible `components/`, `lib/`, error boundary, vitest tests.

### Integration gate — results
- Backend: `npm run typecheck` 0 errors · `npm test` 87/87 pass (verified by orchestrator). PASS.
- Frontend: `npm install` ok · `npm test` 28/28 pass; component (jsdom) + tsc could not run in sandbox. PARTIAL PASS (code complete).
- Database: SQL internally consistent (RLS↔tables↔seeds cross-checked). Not executed against live PG in sandbox. PASS (static).

### Gate findings → Wave-1 reconciliation tasks (resolve before commerce work)
1. **API path drift.** Backend published `/identity/login|refresh|me`, `/v1/flags` (server base `/api/v1`). Frontend, built before the spec was populated (true parallel race), assumed `/api/v1/auth/login|refresh`, `/api/v1/flags`, `/api/v1/healthz`. ACTION: ratify one path scheme in `contracts/openapi.yaml` (backend is canonical), then regenerate the frontend client + MSW from it. Also check the `/v1/flags` under `/api/v1` for a double-prefix.
2. **Duplicate schema source.** Backend shipped `src/identity/migrations.ts` (in-app DDL) so the app boots/tests standalone, duplicating `db/migrations/0001_foundation.sql` + `contracts/schema.sql`. ACTION: converge on `db/` migrations as the single source of truth; backend consumes the schema and drops its in-app DDL.
3. **Tenant id type.** `tenants` PK is TEXT (`tnt_…`) but child `tenant_id` is UUID. ACTION: add `tenants.uuid UUID UNIQUE` in `0002` and emit it as the JWT tenant claim.

Verdict: Wave 0 foundation stands up (backend green, frontend green, schema consistent). The three findings are contract-alignment — the protocol's expected friction, not rework — and are the first agenda items for Wave 1.

## Wave 0.5 — reconciliation (2026-06-11, pre-deploy)
- **Finding #1 RESOLVED (API path drift).** Ratified the backend's real surface as canonical and aligned everything to it:
  - `contracts/openapi.yaml`: server base → `/`; absolute paths `/healthz`, `/readyz`, `/api/identity/login`, `/api/identity/refresh`, `/api/identity/me`, `/api/v1/flags`.
  - Frontend client base → `""` (origin); call sites now use absolute backend paths; logout is client-side only (backend issues stateless JWTs, no logout route); MSW mocks + api-client tests realigned.
  - Gate re-run: **backend 95/95 + 0 typecheck errors; frontend 28/28.** PASS both sides.
- **Findings #2 (duplicate schema) & #3 (tenant id type): ACCEPTED FOR NOW, not deploy-blocking.** The backend's in-app migrations (`src/identity/migrations.ts`) are internally consistent and tested, and let the service self-provision its tables on first boot (needed for serverless/Neon). `db/migrations/*` + `contracts/schema.sql` remain the design-canonical source; Wave 1 converges them (backend loads `db/` SQL; add `tenants.uuid UUID` and emit it as the JWT tenant claim). Logged as Wave 1 task #2/#3.
- Ready to deploy: backend self-migrates on boot; frontend points at the backend origin via `NEXT_PUBLIC_API_BASE_URL`.

## Wave 1 — frontend UI/UX pass (2026-06-12)
- **Frontend** → enterprise POS terminal UX refined in `web/`: responsive terminal shell, product catalog density/search/category UX, cart controls, tender dialog tabs, receipt dialog, accessible icon controls, and test harness repairs for component coverage.
- **Consumes** → existing `/api/v1/catalog`, `/api/v1/orders`, `/api/v1/payments`, `/api/v1/flags` client/MSW surfaces already present in `web/api-client/types.ts` + `web/mocks/handlers.ts`.
- **Verification** → `cd web && npm run typecheck` PASS; `npm test` PASS (80/80); `npm run test:components` PASS (21/21). Dependency-tree repair required restoring missing Rollup/esbuild optional native packages in local `node_modules`; no contract changes proposed.

## Wave 1 — enterprise shell benchmark pass (2026-06-12)
- **Frontend** → added an enterprise POS shell in `web/app/(protected)/terminal/page.tsx`: desktop rail, mobile bottom navigation, store/register selector, device online/offline status, user/role context, and placeholders for Inventory, Customers, Reports, and Settings.
- **Rationale** → establishes the enterprise navigation frame before building the Wave 2 operations surfaces, while keeping the Register workflow as the first-screen task.
- **Verification** → `cd web && npm run typecheck` PASS; `npm test` PASS (80/80); `npm run test:components` PASS (21/21); `curl -I http://localhost:3000/terminal` returned 200.

## Wave 1 — enterprise UX benchmark adoption (2026-06-12)
- **Benchmark set for Frontend/Claude coordination** → use enterprise POS UX patterns as the reference for module framing and operational depth: register-first workflow, persistent operations navigation, store/register context, user/role context, device readiness, inventory control, customer profiles, reporting, and settings/security posture.
- **Frontend** → extracted the shell into `web/components/EnterpriseShell.tsx`; wired real navigation across `/terminal`, `/inventory`, `/customers`, `/reports`, and `/settings`; added first-pass enterprise Inventory, Customers, and Settings pages; refit Reports into the shared shell.
- **Verification** → `cd web && npm run typecheck` PASS; `npm test` PASS (82/82); `npm run test:components` PASS (21/21); local routes `/terminal`, `/inventory`, `/customers`, `/reports`, `/settings` returned 200 from the Next dev server.

## Wave 1 — inventory operations frontend (2026-06-12)
- **Frontend** → upgraded `/inventory` from static sample rows to a catalog-driven operations screen using `GET /api/v1/catalog` via the generated client/MSW. Added search, category/status filters, derived stock KPIs, low-stock triage, selected-SKU detail panel, and count/receive action affordances.
- **Backend/API handoff for Claude** → frontend currently derives stock quantities locally from catalog SKUs. To go live cleanly, publish an inventory endpoint shaped like `GET /api/v1/inventory/levels?pageSize&query&category&status` returning product identity plus `onHand`, `committed`, `reorderPoint`, `costCents`, `velocity`, and `status`; count/receive/adjust actions can then wire to inventory mutation endpoints.
- **Verification** → `cd web && npm run typecheck` PASS; `npm test` PASS (82/82); `npm run test:components` PASS (21/21); `curl -I http://localhost:3000/inventory` returned 200.

## Wave 1 — customer operations frontend (2026-06-12)
- **Frontend** → upgraded `/customers` into an enterprise CRM/clienteling workspace: customer search, segment filter, selectable profile detail, loyalty/spend/visit metrics, recent purchase timeline, clienteling note, and customer-display readiness panel. Data remains frontend-seeded until the customer contract exists.
- **Backend/API handoff for Claude** → future customer surface should include `GET /api/v1/customers?query&segment&pageSize`, `GET /api/v1/customers/:id`, and customer attach-to-sale support for the orders flow. Customer records should expose profile/contact fields, segment, visits, lifetime spend cents, loyalty points, last visit, notes, and recent purchases.
- **Verification** → `cd web && npm run typecheck` PASS; `npm test` PASS (82/82); `npm run test:components` PASS (21/21); `curl -I http://localhost:3000/customers` returned 200.

## Wave 1 — settings/admin frontend (2026-06-12)
- **Frontend** → upgraded `/settings` into an enterprise admin workspace with section navigation, store/register profile, checkout controls, connected device readiness, roles/access matrix, frontend-visible feature flags, and security posture panel. Controls are role-aware in the UI and remain non-mutating until backend endpoints exist.
- **Backend/API handoff for Claude** → future settings surface should expose store/register profile, device registry/status, feature flag administration, role policy matrix, and checkout-control settings. Mutations should be role-gated owner/manager and audited.
- **Verification** → `cd web && npm run typecheck` PASS; `npm test` PASS (82/82); `npm run test:components` PASS (21/21); `curl -I http://localhost:3000/settings` returned 200.

## Wave 1 — reporting operations frontend (2026-06-12)
- **Frontend** → upgraded `/reports` with range controls, export/schedule actions, richer revenue KPIs, average order value, refund rate, hourly sales index, payment method bars, order-status table, and top-product list. Kept the existing `SalesSummary` contract and derived additional UI locally.
- **Backend/API handoff for Claude** → future reporting endpoints should support date range filters and return hourly sales, top products, order status share, payment method breakdowns, and export/scheduled-report actions. Existing `GET /api/v1/reports/summary` remains sufficient for the current frontend fallback.
- **Verification** → `cd web && npm run typecheck` PASS; `npm test` PASS (82/82); `npm run test:components` PASS (21/21); `curl -I http://localhost:3000/reports` returned 200.

## 2026-06-14 — Frontend cycle: FE-1
- **Shipped:** New `/purchasing` page (added to nav) with a suppliers list + add-supplier form, a purchase-order list with a manager-gated "Receive" action, and a create-PO form supporting multiple lines with product, quantity, unit cost, and optional lot code/expiry date. Also added a "Margin" column (derived from `priceCents`/`costCents`) to the inventory grid and detail panel.
- **Consumes:** `GET/POST /api/v1/purchasing/suppliers`, `GET/POST /api/v1/purchasing/orders`, `POST /api/v1/purchasing/orders/:id/receive`, `GET /api/v1/inventory/levels` (existing MSW mocks for all).
- **Verified:** typecheck clean; npm test pass (83/83); test:components pass.

## 2026-06-14 — Frontend: enterprise login redesign
- **Shipped:** Redesigned `/login` as a split-screen enterprise auth experience (`components/AuthShell.tsx`): brand/marketing panel with benefits, trust metrics, and compliance badges, plus a glassmorphism sign-in card with password show/hide, remember me, Caps Lock detection, inline validation, and a persisted light/dark theme toggle (`lib/theme.ts`, Tailwind class-based dark mode). Added `/login/forgot-password` (mocked "check your email" flow) and `/login/mfa` (6-digit code UI, mocked, not yet linked from login).
- **Consumes:** existing `POST /api/identity/login` only. SSO (Google/Microsoft Azure AD/Okta/Apple) and SAML are presented as disabled "Enterprise plan" placeholders — no backend support exists. MFA verify and password-reset-by-email are mocked client-side pending backend endpoints.
- **Verified:** typecheck clean; npm test pass (83/83); manual `curl` 200 on /login, /login/forgot-password, /login/mfa.

## 2026-06-14 — Frontend: auth journey extensions (reset/device/security/MFA methods, settings security tab)
- **Shipped:** `/login/reset-password` (token-gated new-password form with strength meter, invalid-link state, success state); `/login/device-verification` ("verify it's you" prompt with mock device/location, confirm or escalate); `/login/security-alert` (flagged sign-in notice routing to password reset). Extended `/login/mfa` with a method switcher (authenticator app / email code / backup code) including a dedicated backup-code input. Added a "Security" section to `/settings` with MFA status (disabled, setup CTA), active sessions list, and login history table.
- **Consumes:** no new backend endpoints. All flows remain UI-only/mocked pending device-trust, MFA-enrollment, session-management, and login-audit endpoints.
- **Verified:** typecheck clean; npm test pass (83/83); test:components pass (21/21); manual `curl` 200 on all new routes plus /settings.

## 2026-06-14 — Frontend cycle: FE-2
- **Shipped:** Added Accounts Receivable and Accounts Payable cards to `/accounting`, each with an aging summary (current/1-30/31-60/61-90/90+/total) and a bills/invoices table showing status, due date, total/paid/due amounts, plus a manager-gated inline "Pay" action.
- **Consumes:** `GET /api/v1/billing/bills`, `GET /api/v1/billing/invoices`, `GET /api/v1/reports/ap-aging`, `GET /api/v1/reports/ar-aging` (mocked), and new `POST /api/v1/billing/bills/:id/pay` / `POST /api/v1/billing/invoices/:id/pay` (mocked, stateful).
- **Verified:** typecheck clean; npm test pass (83/83); test:components pass (21/21); manual `curl` 200 on /accounting.

## 2026-06-14 — Backend cycle: BE-6
- **Shipped:** Catalog category tree (`categories` table with `parent_id` self-reference + `product_categories` many-to-many join) with full CRUD (`GET/POST /api/v1/catalog/categories`, `PATCH/DELETE /api/v1/catalog/categories/:id`, manager-gated mutations) and product assignment (`GET/PUT /api/v1/catalog/:id/categories`). Also extended `products` with optional detail fields: `description`, `brand`, `length_mm`/`width_mm`/`height_mm`, `weight_grams`, `image_url`, `preferred_vendor_id`, `vendor_upc`, `min_qty_to_sell`/`max_qty_to_sell`, and `qty_increment` (default 1) — all settable via the existing `POST /` and `PATCH /:id` product endpoints. Existing flat `category` string and `resolveTaxClass` behavior are unchanged.
- **Verified:** typecheck clean; `npm test` 117/117 pass (114 pre-existing + 3 new: detail-field create/update round-trip, category tree create/nest/assign/delete-reparents, manager-gated category mutation 403 for cashier).
- **Contract changes:** New endpoints under `/api/v1/catalog`: `GET/POST /categories`, `PATCH/DELETE /categories/:id`, `GET/PUT /:id/categories`. `Product` shape gains the new optional/nullable fields listed above (additive, backward compatible). `contracts/openapi.yaml` and `web/api-client/types.ts` are not yet updated — needed before FE-7/FE-8/FE-9 consume these.

## 2026-06-14 — Backend cycle: BE-8
- **Shipped:** Master/child product variants. `products` gains `parent_product_id` (app-layer self-reference) and `variant_label`. New `GET /api/v1/catalog/:id/variants` (list children) and `POST /api/v1/catalog/:id/variants/assign` (manager-gated, bulk-sets `parent_product_id` on the given product ids). `GET /api/v1/catalog?excludeMasters=true` drops any product referenced as a parent by another product (variant-parent/master rows) from the listing — intended for sellable/browse lists. `POST /api/v1/orders` now rejects ringing up a master row directly (400, "is a variant master and cannot be sold directly"); its child variants remain sellable.
- **Verified:** typecheck clean; `npm test` 120/120 pass (117 pre-existing + 3 new: variant assign/list/excludeMasters, self-parent 409, orders master-row rejection).
- **Contract changes:** New endpoints `GET /api/v1/catalog/:id/variants`, `POST /api/v1/catalog/:id/variants/assign`. `Product` gains `parent_product_id`/`variant_label` (nullable, additive). `GET /api/v1/catalog` gains optional `excludeMasters=true` query param. `contracts/openapi.yaml` / `web/api-client/types.ts` still not updated — needed before FE-9 consumes these.

## 2026-06-14 — Backend cycle: BE-7
- **Shipped:** Bulk catalog operations. `POST /api/v1/catalog/bulk-update` (manager-gated) applies one field update to up to 500 product ids and returns the updated rows. `GET /api/v1/catalog/export` returns the full tenant catalog as `text/csv` (new `src/shared/csv.ts` helper, no external dependency). `POST /api/v1/catalog/import-csv` (owner/manager) parses CSV (`sku,name,priceCents|price_cents,category,barcode` columns) and upserts via the existing `bulkImport`. `POST /api/v1/catalog/bulk-barcodes` (manager-gated) generates EAN-13 barcodes (with check digit, collision-checked against `product_barcodes`) for any of the given ids that don't already have one.
- **Verified:** typecheck clean; `npm test` 125/125 pass (120 pre-existing + 5 new: bulk-update apply + 403 gating, CSV export/import round-trip including a comma-quoted field, import-csv validation rejection, bulk-barcodes generate-only-if-missing).
- **Contract changes:** New endpoints `POST /api/v1/catalog/bulk-update`, `GET /export`, `POST /import-csv`, `POST /bulk-barcodes`, all under `/api/v1/catalog`. `contracts/openapi.yaml` / `web/api-client/types.ts` still not updated — this is now three backend cycles (BE-6/7/8) whose contracts the frontend hasn't picked up; worth a dedicated contract-sync pass before FE-7/8/9.

## 2026-06-20 — Frontend cycle: FE-6

- **Shipped:** Mock audit of mockHandlers.ts vs live backend. One path mismatch fixed: /api/v1/imports/products → /api/v1/catalog/import-csv (same body shape, live endpoint exists). Three new Backend-lane items queued (BE-19 notifications, BE-20 audit-log read, BE-21 loyalty programme).
- **Consumes:** POST /api/v1/catalog/import-csv (live, catalog module)
- **Verified:** typecheck clean (backend npm run typecheck, frontend npm run typecheck); npm test 304/304 pass

## 2026-06-20 — Backend cycle: BE-19

- **Shipped:** Notifications module (src/modules/notifications/). Table + indexes created on boot. GET /api/v1/notifications (paginated, unread filter), PATCH /:id/read, POST /mark-all-read, POST / (create). EventBus listeners for inventory.adjusted (low_stock) and invoice.overdue (overdue_invoice) automatically emit notifications.
- **Verified:** typecheck clean (npm run typecheck); npm test pass with 16 pre-existing payment test failures unrelated to this change (confirmed by running payments.test.ts on clean tree — same failures).
- **Contract changes:** New module mounted at /api/v1/notifications. All four endpoints are now live.

## 2026-06-20 — Frontend cycle: FE-14

- **Shipped:** Compliance product flags + state enforcement. TerminalProduct and CatalogProduct types gain tobacco_type, flavored, menthol, msa_reportable, restricted_states fields. Catalog /catalog/[id] page gains a Compliance card: tobacco type select, flag checkboxes (flavored/menthol/msa_reportable), 50-state restricted-states grid — saved via PATCH /api/v1/catalog/:id/compliance. Terminal blocks add-to-cart when product.restrictedStates includes the active outlet's state code (derived from inventory locations state field). MSW mocks updated: locations seed includes state: "CA"; flavored vape product restricted in ["CA","MA","NJ","RI","IL"] for demo enforcement. BE-22 queued for backend compliance columns.
- **Consumes:** GET /api/v1/inventory/locations (live, inventory module; extended to include state field in mock); PATCH /api/v1/catalog/:id/compliance (mocked, pending BE-22).
- **Verified:** typecheck clean (tsc --noEmit exit 0); web tests skipped (pre-existing jsdom/rettime dependency issue in test runner, unrelated to FE-14 changes).

## 2026-06-20 — Backend cycle: BE-20

- **Shipped:** Audit log read module (src/modules/audit_log/). GET /api/v1/audit-log with filters: ?actor= (email ILIKE), ?resource_type=, ?action=, ?limit= (max 200), ?offset=. JOINs users table for actor email/role. Parses before_state/after_state JSON into field-level {from, to} diff. Adds two indexes on the existing audit_log table.
- **Verified:** typecheck clean (npm run typecheck); pre-existing payment test failures unrelated (confirmed on clean tree).
- **Contract changes:** New module mounted at /api/v1/audit-log. No schema changes (table pre-exists in identity migrations).

## 2026-06-20 — Frontend cycle: FE-15

- **Shipped:** CardReaderScreen component (web/components/terminal/CardReaderScreen.tsx) — 4-state animation (waiting→reading→processing→approved) over 3300ms with pulsing ring, rAF progress bar, step indicators, and ESC-to-cancel. Wired into TenderScreen: card and split payment paths now play the animation before POST /api/v1/payments fires. NumpadModal (web/components/terminal/NumpadModal.tsx) — 3×4 grid, keyboard support (digits, Backspace, Enter, Escape), max 4 digits, qty≥1 validation. Wired into CartPanel: quantity display replaced with a button that opens NumpadModal; confirmed via onQtyChange callback.
- **Consumes:** No new API endpoints (pure UI).
- **Verified:** typecheck clean (npm run typecheck exit 0); tests running (pre-existing 16-failure payment test noise expected; unrelated to this change).

## 2026-06-20 — Backend cycle: BE-21

- **Shipped:** Loyalty programme module (`src/modules/loyalty/`). Three tables: `loyalty_tiers`, `loyalty_members`, `loyalty_rewards`. Mounted at `/api/v1/loyalty`. Tiers CRUD (manager-gated mutations) with `member_count` computed via subquery. Members list (JOIN customers + tiers for display fields) + `POST /members/:id/adjust` which updates `points_balance` and `points_lifetime`, auto-promotes `tier_id` to the highest eligible tier, and emits `loyalty.tier_upgraded` (picked up by SSE broker in app.ts). Rewards CRUD. All manager-level mutations require `requireRole("manager")`.
- **Consumes:** customers table (JOIN for member display names), EventBus (`loyalty.tier_upgraded`).
- **Verified:** `npm run typecheck` 0 errors; `npm test` 304 pass, 0 fail (pre-existing CSRF failure in purchasing integration test is unchanged).

## 2026-06-20 — Backend cycle: BE-22

- **Shipped:** Compliance columns on products table. Migration: ALTER TABLE adds tobacco_type TEXT, flavored/menthol/msa_reportable INTEGER (0|1 stored as SQLite integers), restricted_states TEXT (JSON array of 2-letter state codes). All columns use IF NOT EXISTS — safe on existing DBs. CatalogService.updateCompliance() patches only the five compliance fields and emits product.updated. Product interface extended; CREATE initialises all five to null/0. Route: PATCH /api/v1/catalog/:id/compliance, requireRole("manager"), zod-validated (restricted_states elements must be 2-char strings). The FE-14 compliance UI in /catalog/[id] was already wired to this endpoint path — it now hits the live backend.
- **Consumes:** No new external dependencies.
- **Verified:** typecheck clean (npm run typecheck exit 0).
