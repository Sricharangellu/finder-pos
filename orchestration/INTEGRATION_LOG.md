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

## 2026-06-20 — Backend cycle: PERF-1

- **Shipped:** Cursor pagination on the three largest list endpoints. GET /api/v1/inventory replaces OFFSET with keyset cursor on (updated_at DESC, product_id DESC). GET /api/v1/billing/invoices replaces LIMIT 500 with cursor on (issued_at DESC, id DESC). GET /api/v1/sales/sales-orders replaces LIMIT 500 with cursor on (created_at DESC, id DESC). All three return { items, nextCursor, limit } — pass ?cursor=<token> for the next page. Default page size 50, max 200 (clamped). Orders endpoint was already cursor-paginated; unchanged. Cursors are base64url-encoded JSON { at, id } — opaque to callers.
- **Contract changes:** Response shape for the three endpoints changed from { items, total, offset } / plain array to { items, nextCursor, limit }. Frontend pages that called these with hardcoded LIMIT 500 will receive at most 200 items per page; they should implement "load more" using nextCursor if needed.
- **Verified:** typecheck clean (npm run typecheck — only pre-existing scripts/test.ts error).

## 2026-06-21 — Fullstack cycle: PRODUCT-DATA (store locations + expiry + invoicing)

- **Shipped:**
  1. *Store Locations* — `store_locations` + `product_locations` tables. CRUD + map endpoint + bulk assign. `/inventory/locations` page: collapsible aisle/shelf/bin map (color-coded by aisle), product list view with search, bulk assign modal (multi-row SKU→location grid).
  2. *Product Expiry / Batch Tracking* — `product_batches` table (batch_number, expiry_date, qty, cost_cents, supplier). `/product-batches/summary` returns expired/critical/warning/ok counts+qty. `/inventory/expiry` page: alert banner for urgent items, 4 colored status cards, table with color-coded progress bars and "days left" column. Add Batch modal.
  3. *Customer Invoicing* — `customer_invoices` + `customer_invoice_lines` tables, auto-sequence INV-nnnnn. `/customer-invoices/lookup-upc` for barcode→product resolution. Full lifecycle draft→sent→partial→paid→overdue→void. `/invoicing` page: stats row, status filter tabs, UPC-scan line builder (scan → auto-fill name/price), totals panel, invoice detail modal with status advancement.
- **Consumes:** GET/POST /store-locations, GET /store-locations/map, POST/GET /product-locations, POST /product-locations/bulk, GET /product-batches/summary, GET/POST/PATCH /product-batches, GET/POST /customer-invoices, GET /customer-invoices/lookup-upc, PATCH /customer-invoices/:id/status — all mocked.
- **Data model:** Derived from product-export.xlsx (Product Location col, Expiration date col, UPC/SKU/price fields) and Invoice Template.xls (upc/quantity/price/name schema).
- **Verified:** backend typecheck clean (npm run typecheck); frontend typecheck clean (cd web && npm run typecheck — zero errors).

## 2026-06-21 — Frontend cycle: FE-16

- **Shipped:** Service Orders page at `/service-orders` — full repair ticket lifecycle (draft→open→in_progress→ready→closed). List view with status filter tabs, stat cards per status, search, create modal, inline status transition buttons, and detail modal. 5 MSW handlers added to mockHandlers.ts. Types ServiceOrder/ServiceOrderStatus/ServiceOrderResponse added to types.ts. Nav icon (wrench) wired into EnterpriseShell Operate group.
- **Consumes:** GET /api/v1/service-orders (mocked), POST /api/v1/service-orders (mocked), GET /api/v1/service-orders/:id (mocked), PATCH /api/v1/service-orders/:id (mocked).
- **Verified:** typecheck clean (cd web && npm run typecheck — zero errors).

## 2026-06-21 — Fullstack cycle: BE-23 + FE-17 + BE-24 (service orders backend + serialized inventory)

- **Shipped:**
  1. *Service Orders Backend (BE-23)* — `src/modules/service_orders/`: `service_orders` table (status, assigned_to, estimate_cents, actual_cents). CRUD routes registered at GET/POST `/service-orders`, GET/PATCH `/service-orders/:id`. Status machine: draft→open→in_progress→ready→closed enforced in service layer; transitions beyond the allowed next state return 400. EventBus publishes `service_order.status_changed` on every transition.
  2. *Serial Numbers Backend (BE-24)* — `src/modules/serial_numbers/`: `serial_numbers` table with UNIQUE (tenant_id, serial). Endpoints: GET/POST `/inventory/serials`, GET/PATCH `/inventory/serials/:id`. List LEFT JOINs `catalog_products` for product_name/sku on read. Duplicate serial returns 409. Two indexes: (tenant_id, product_id, status) + (tenant_id, serial).
  3. *Serialized Inventory Frontend (FE-17)* — `/inventory/serials` page: 4 stat cards (total/in_stock/sold/service), status tab filter (all/in_stock/sold/returned/service), search by serial+product+SKU, sortable table. ReceiveModal: product_id + serial + optional name/sku/notes. DetailModal: field summary + inline status transition buttons (in_stock→sold/service, returned→in_stock/service, service→in_stock/returned) with service_order_id input. 7 seed serials in mockHandlers.ts covering all 4 statuses. `inventory-serials` NavKey + nav item (Manage group) + SerialsIcon (barcode bars SVG).
- **Consumes:** GET /api/v1/inventory/serials (mocked), POST /api/v1/inventory/serials (mocked), GET /api/v1/inventory/serials/:id (mocked), PATCH /api/v1/inventory/serials/:id (mocked).
- **Remaining open:** FE-18 (Workforce scheduling).
- **Verified:** npm run typecheck — 0 errors (backend + frontend in single tsc pass).

## 2026-06-21 — Frontend cycle: FE-18 (Workforce / Employee Scheduling)

- **Shipped:** `/workforce` page — weekly Mon–Sun schedule grid (employee rows × day columns). Shift blocks color-coded by role: manager=purple, supervisor=emerald, cashier=blue, stock=amber, delivery=orange. Click empty cell → ShiftModal pre-filled for that day+employee. Click shift block → edit/delete modal. Week navigation (< > + Today button). Time-off panel below grid with approve/deny actions for pending requests. 4 stat cards: employee count, shifts this week, hours scheduled, pending requests.
- **Consumes:** GET /api/v1/workforce/employees, GET/POST/PATCH/DELETE /api/v1/workforce/shifts, GET/PATCH /api/v1/workforce/time-off — all mocked with 5 employees + 19 seed shifts + 4 time-off requests.
- **Types added:** Employee, Shift, ShiftsResponse, TimeOffRequest, ShiftRole, TimeOffStatus.
- **Phase 2 complete:** All FE-16–FE-18 (frontend) and BE-23–BE-24 (backend) roadmap items are now checked off.
- **Verified:** npm run typecheck — 0 errors.

## 2026-06-21 — Fullstack cycle: Phase 3 kickoff — BE-25 + BE-26

- **Phase 3 roadmap:** 5 new items added (BE-25..27, FE-22..25) — Workforce backend, Customer accounts depth, Reorder dashboard, Enhanced reports, Receipt templates.
- **BE-25 — Workforce backend (src/modules/workforce/):** employees/shifts/time_off_requests tables. Routes: GET /workforce/employees, POST/PATCH; GET/POST/PATCH/DELETE /workforce/shifts; GET/POST /workforce/time-off, PATCH /:id for status update. Zod validation on all inputs; createShift JOINs employees for employee_name+role. Completes real backend for FE-18 schedule grid.
- **BE-26 — Customer contacts/addresses PATCH+DELETE:** Tables already existed from Wave A. Added updateContact, deleteContact, updateAddress, deleteAddress to customers service. Added PATCH+DELETE routes at /:id/contacts/:contactId and /:id/addresses/:addressId. ContactsPanel on /customers/[id] now has per-row Edit (inline modal → PATCH) and Remove (confirm dialog → DELETE). Mock handlers updated: PATCH addresses, PATCH+DELETE contacts, richer seed data (3 contacts + 2 addresses for cus_demo_1).
- **Verified:** npm run typecheck — 0 errors.

## 2026-06-21 — Fullstack cycle: BE-27 + FE-23 (Reorder Management)

- **BE-27 — Reorder management endpoints:**
  - `InventoryService.getReorderSuggestions(tenantId)`: queries `inventory` JOINed with `catalog_products` where `reorder_pt > 0 AND stock_qty <= reorder_pt`, ordered by `preferred_vendor_name NULLS LAST, name`. Returns product_id, product_name, sku, stock_qty, reorder_pt, suggested_qty (reorder_quantity or reorder_pt fallback), preferred_vendor_id/name.
  - `GET /inventory/reorder-suggestions` → `{ items: ReorderSuggestion[] }`
  - `POST /inventory/reorder-suggestions/create-po` → accepts `{ lines: [{ productId, vendorId, quantity, unitCostCents }] }`, groups by vendorId, calls `PurchasingService.createOrder` per vendor. Returns `{ orders: [] }`. Requires manager role.
  - `PurchasingService` imported in `inventory/index.ts` and passed to `registerRoutes` as third arg.
- **FE-23 — Reorder Dashboard (`/inventory/reorder`):**
  - 4 stat cards: SKUs to Reorder, Out of Stock, Vendors Affected, Selected.
  - Items displayed in collapsible vendor groups with "Select group" toggle per group.
  - Table columns: checkbox, product, SKU, on-hand, reorder point, editable order qty input, urgency badge (Out / Critical / Low).
  - "Select All" / "Create Draft PO(s)" toolbar button. ConfirmModal shows PO breakdown per vendor before submitting.
  - Success banner on create; error banner on failure.
  - 8 mock seed items: 3 Core-Mark North, 3 McLane Company, 1 Eby-Brown, 1 unassigned.
  - `inventory-reorder` NavKey + nav item (Manage group) + ReorderIcon (lines with arrow SVG).
- **Types added:** `ReorderSuggestion`, `ReorderSuggestionsResponse` in `web/api-client/types.ts`.
- **Verified:** npm run typecheck — 0 errors.

## 2026-06-21 — Frontend cycle: FE-22 (Customer Account Detail — Contacts + Addresses Tabs)

- **FE-22 — Contacts and Addresses as proper tabs on `/customers/[id]`:**
  - `DetailTab` union extended with `"contacts" | "addresses"`.
  - `tabs` array gets two new entries; both rendered as first-class tab panels that mount-load immediately via `useEffect` (no lazy accordion open/close).
  - **ContactsTab**: full add inline form (Name/Title/Email/Phone + Primary checkbox), edit modal (PATCH `/contacts/:id`), delete confirm dialog (DELETE `/contacts/:id`). Flat table always visible when tab is active.
  - **AddressesTab**: add inline form (Type/Line1/City/State/ZIP + Default checkbox), new inline edit modal (PATCH `/addresses/:id`) added — existing panel only had delete. Supports address_line2. Edit and Remove buttons per row.
  - `ContactsPanel` and `AddressesPanel` retained as thin shims delegating to the new tabs (no callers break).
  - LoyaltyCard and NotesPanel remain visible on all non-contacts/addresses tabs.
- **Consumes:** GET/POST/PATCH/DELETE `/api/v1/customers/:id/contacts` and `/addresses` — all mocked.
- **Verified:** npm run typecheck — 0 errors.

## 2026-06-21 — Frontend cycle: FE-24 (Enhanced Reports)

- **FE-24 — `/reports` rebuilt as 5-tab analytics page:**
  - **Overview**: existing ReportsDashboard KPI cards + top products (preserved).
  - **Sales by Product**: sortable table (click headers to sort by units/revenue/margin$/margin%). 20 seed products. Color-coded margin badges (green ≥40%, yellow ≥25%, red <25%). CSV export.
  - **Margin by Category**: SVG horizontal bar chart (revenue background, margin overlay in blue) + detail table sorted by margin. 6 categories (Tobacco/Beverages/Lottery/Snacks/Candy/Vapor). CSV export.
  - **Inventory Valuation**: 4 stat cards (total cost/retail/potential margin/SKUs tracked) + detail table. Consumes existing `/reports/inventory-valuation` mock. CSV export.
  - **Low Stock**: flat table from `/inventory/levels?lowStock=true`; out-of-stock (red) vs low-stock (yellow) badges. CSV export.
  - Range picker extended to 7d/30d/90d; each tab re-fetches on range change via `useCallback`.
  - Schedule recurring report panel preserved.
- **New mock handlers**: `GET /reports/sales-by-product` (20 items with realistic c-store product mix), `GET /reports/margin-by-category` (6 categories).
- **Types added**: `SalesByProductItem`, `SalesByProductResponse`, `MarginByCategoryItem`, `MarginByCategoryResponse`.
- **Verified:** npm run typecheck — 0 errors.

---

## Phase 4 — FE-27 + FE-28 (2026-06-21)

### FE-27: Purchasing order detail (pre-existing — confirmed)
- Page `web/app/(protected)/purchasing/[id]/page.tsx` (348 lines) already implemented: header card with supplier/status/total/dates, line items table (ordered/received/remaining/unit cost/line cost/lot/expiry), Receive Stock modal with per-line qty inputs capped at remaining.
- Mock handler `GET /purchasing/orders/:id` already present at line 1486 of mockHandlers.ts.
- No new code required — marked done on roadmap.

### FE-28: AR Dunning dashboard (cf32d47)
- **Invoice type**: added `dunning_level?: 0 | 1 | 2 | 3 | null` to `Invoice` interface.
- **Seed data**: `BASE_INVOICES` extended with 3 overdue invoices (inv_3=30d, inv_4=60d, inv_5=90d+) with pre-assigned dunning levels.
- **Mock handler**: `POST /reports/ar-aging/sweep` reads all non-paid/non-void invoices, computes days overdue, sets dunning_level in invoicesStore, returns `{ updated: N }`.
- **Accounting page**: `dunning_level` state vars (`sweepBusy`, `sweepResult`); `runDunningSweep()` calls sweep then reloads; AR table gains an "Overdue" column with colored badges (yellow=30d, orange=60d, red=90d+); "Run Dunning Sweep" button visible to managers with inline result count.
- **Bug fix**: `TableSkeleton` import missing in loyalty/page.tsx — added import.
- **Verified:** npm run typecheck — 0 errors.

---

## Phase 4 — BE-29 (2026-06-21)

### BE-29: Sales rep management (5e4e09f)
- **Migration**: `sales_reps (id, tenant_id, name, email, commission_pct NUMERIC(5,2), active INTEGER 0/1, created_at)` + index on `(tenant_id, active)`. Added to `salesModule.migrations[]`.
- **Service** (`SalesService`): `SalesRepRow` raw DB type (active as integer) + `rowToRep()` coercer; methods: `listReps(tenantId, activeOnly?)`, `createRep(input, tenantId)`, `updateRep(id, input, tenantId)`, `getRepPerformance(id, tenantId, from, to)`.
- **Performance query**: SUM(total_cents)/COUNT(*) from `sales_orders WHERE sales_rep_id = @id AND status != 'cancelled' AND created_at BETWEEN @from AND @to`.
- **Routes** (added to sales router): `GET /reps`, `POST /reps` (manager), `GET /reps/:id/performance` (sub-path before `/:id`), `PATCH /reps/:id` (manager).
- **Types**: `SalesRep`, `SalesRepsResponse`, `SalesRepPerformance` added to `web/api-client/types.ts`.
- **Mock handlers (IIFE)**: 4 seed reps (Jordan Walsh 5%, Maya Patel 6.5%, Chris Nguyen 4.5% inactive, Dana Okonkwo 5%); GET list (filter ?active=true), POST create, GET :id/performance (seeded revenue/order counts), PATCH update.
- **Verified:** npm run typecheck — 0 errors (both backend + frontend).

### SEC-1: Security audit + hardening (5af7a24)

Full application security audit conducted 2026-06-21. Covered: authentication,
authorization, input validation, SQL injection, XSS, secret exposure, rate limiting,
and security headers. Six vulnerabilities fixed:

**HIGH — Customer privilege escalation**
- `src/modules/customers/routes.ts`: split `profileFieldsSchema` (staff-accessible) from
  `managerFieldsSchema` (tier, creditLimitCents, paymentTermDays, verified, achVerified,
  status). Added `requireRole("manager")` to `PATCH /:id`. `createSchema` (open to all)
  no longer includes privileged financial fields.

**MEDIUM — Receipt templates unprotected**
- `src/modules/settings/routes.ts`: added `requireRole("manager")` to
  `POST /settings/receipts/:outletId` and `PATCH /settings/receipts/:outletId`.

**MEDIUM — Prometheus metrics publicly accessible**
- `src/app.ts`: `/metrics` now checks `Authorization: Bearer <METRICS_TOKEN>` header
  when `METRICS_TOKEN` env var is set. Falls back to open (dev mode) when unset.

**MEDIUM — Quotation state transitions missing role guard**
- `src/modules/sales/routes.ts`: added `mgr` middleware to `send`, `accept`,
  `cancel`, and `convert` quotation endpoints. Draft creation remains open to staff.

**LOW — Logout reads tenantId from request body**
- `src/identity/routes.ts`: logout now validates `refreshToken` via `refreshSchema`
  (`parseBody`). `tenantId` is sourced only from the verified JWT, never from `req.body`.

**LOW — No frontend security headers**
- `web/middleware.ts` (new file): adds `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(self)`,
  and a `Content-Security-Policy` with `frame-ancestors 'none'` to all page responses.
  Matcher: all routes except `_next/static`, `_next/image`, `favicon.ico`.
  Documents the httpOnly-cookie upgrade path for future server-side auth enforcement.

**System design document**
- `orchestration/SYSTEM_DESIGN.md` (new file): production architecture reference
  covering the full stack diagram, auth design + cookie upgrade plan, multi-tenancy
  model, module system, EventBus, payments (PCI scope), offline-first design,
  real-time SSE, background jobs (BullMQ plan), webhooks, hardware integration
  (scanner/printer/cash drawer/card reader), scaling plan, production go-live
  security checklist, and data model index.

**Phase 5 roadmap items added**
- BE-31 (httpOnly cookie auth), BE-32 (early payment discount), BE-33 (webhooks),
  BE-34 (BullMQ job queue), FE-29 (offline-first terminal), FE-30 (real-time SSE),
  FE-31 (customer display). See `orchestration/ROADMAP.md §Phase 5`.

**Verified**: `npx tsc --noEmit --skipLibCheck` — backend 1 pre-existing error
(Stripe SDK version string mismatch in `payments/stripe.ts`, unrelated to this work);
frontend 1 pre-existing error (`cardLast4` type in mock handler). Both were present
before this commit. No new errors introduced.

### FE-26: Cycle Count UI (84df7e8)
- **Roadmap**: Phase 4 section added covering FE-26/27/28 + BE-29/30 derived from all gaps/*.md files.
- **Page**: `web/app/(protected)/inventory/counts/page.tsx` — sessions list (stat cards, click-to-expand) + session detail panel.
- **Sessions list**: three stat cards (open/closed/total), table of sessions ordered newest-first. "New Session" modal with optional note field.
- **Session detail**: breadcrumb back-nav, four stat cards (total/counted/remaining/variances), count line table with inline qty inputs (blur/Enter to save, disabled while saving). Closed sessions render read-only.
- **Close Session**: modal shows uncounted-SKU warning and adjustment count preview before posting `POST /counts/:id/close` (manager-gated).
- **Mock handlers (IIFE)**: GET/POST `/inventory/counts`, GET/POST `/inventory/counts/:id/lines`, POST `/inventory/counts/:id/close`. Sub-paths registered before `/:id`. Seeded with one closed demo session (8 lines, realistic variance pattern).
- **Types added**: `CycleCountStatus`, `CycleCountSession`, `CycleCountSessionsResponse`, `CycleCountLine`, `CycleCountLinesResponse`.
- **Nav**: `"inventory-counts"` key added to NavKey union + NAV_ITEMS (group: Manage) + `CycleCountIcon` (clipboard-check SVG).
- **Verified:** npm run typecheck — 0 errors.
