# Audit — Frontend ↔ Backend Gap Scan (full surface)

Date: 2026-07-18T005030Z
Session: Claude (Cowork, Fable 5)
Branch scanned: `feat/delivery-pipeline` (PR #70; = master + 95 commits)
Status label: **Audit only — no code changed**

Method: scripted extraction of every registered backend route (module `register()`
routes + `mountPath` resolution + `app.ts` direct routes + identity), every
`/api/v1|/api/identity` path literal in `web/{app,api-client,hooks,lib,components,contexts}`,
and every MSW handler path in `web/mocks/`. Paths normalized (`:id`/`${…}` → `:p`),
then diffed. Each flagged gap was hand-verified in source before being listed.

## Headline numbers

| Metric | Count |
|---|---|
| Backend registered routes | 533 (400 unique paths) |
| Frontend-referenced API paths | 374 |
| MSW-mocked paths | 395 |
| FE paths with **no backend route on this branch** | 148 → 136 real (12 scan artifacts, all hand-verified benign) |
| Backend paths never referenced by FE | 174 (includes the 65 double-prefix phantoms below) |

## 1. CRITICAL — the 2026-07-15 API-audit fixes are UNMERGED

Commit `29831bd` (session C, per `AUDIT_2026-07-15T140844Z`) fixed three critical
bugs, but it lives only on `origin/feat/clean-arch-pilot-quotes` (and
`origin/fix/sso-oidc-verification`). It is **not in master and not in
`feat/delivery-pipeline`**. Verified directly in this branch's source:

- **10 modules still double-prefixed → every route 404s**: restaurant (11 routes),
  workforce (13), appointments (4), entertainment (5), education (6), healthcare (6),
  hospitality (6), manufacturing (5), automotive (6), rental (5) — 67 routes registered
  at `/api/v1/<mod>/<mod>/…` while the FE calls `/api/v1/<mod>/…`.
- **SSO login unreachable**: no public mount of `/initiate`/`/callback` ahead of the
  `/api/v1` auth gate in this branch's `app.ts`.
- **`requireModule` business-pack isolation**: not present on this branch.

Every one of these pages "works" locally because MSW mocks answer — prod 404s.
**Action: merge or cherry-pick `29831bd` into the mainline before anything else.**

## 2. Mock-only endpoints in CORE modules (backend module exists, endpoint doesn't)

These are real modules where the page ships against mocks only — ordered by
retail-first priority:

| Area | Missing endpoints (normalized) | FE caller |
|---|---|---|
| Catalog product detail | 16 paths: `/catalog/:id/{analytics, audit-log, credits, duplicate, expiry, images/:id, invoices, pricing, pricing/tiers[/:id], purchases, reorder-suggestions, returns, sales, sales-by-customer, stock, supplier-price-comparison, suppliers[/:id]}` | `catalog/[id]/_components/*` |
| Catalog categories | `/catalog/categories/:id/products[/:id]` | `catalog/categories/[id]` |
| Customers | `/customers/search`, `/customers/:id/merge` | `customers/[id]` |
| Inventory | `/inventory/errors[ /:id, /summary]`, `/inventory/pipeline/{summary,pending,receiving[/:id/update],issues[/:id],history,reorder-alerts[/:id/create-po]}`, `/inventory/returns`, `/inventory/supplier-returns`, `/inventory/locations/:id` | inventory pages |
| Orders | `/orders/:id/timeline` | `orders/[id]` |
| Team | `/team/:id/{clock-in, clock-out, time-entries, permission-overrides, permission-requests}` | `team/[id]` |
| Notifications | `/notifications/{digest, preferences, rules[/:id]}` | notifications page |
| Purchasing | `/purchasing/edi-imports[…5 paths]`, `/purchasing/vendor-history` | purchasing pages |
| Workflows | `/workflows/{approval-chains[/:id], run-history}` | workflows page |
| Settings | `/settings/b2b`, `/settings/permissions`, `/settings/custom-roles[/:id]` — NB backend serves custom roles at `/api/v1/custom-roles`; FE calls a different path (path mismatch, not a missing feature) | settings pages |
| Ecommerce storefront | `/ecommerce/auth/{login, logout, me, register}` — storefront customer auth has no backend at all | `StoreAuthContext` |
| Restaurant | `/restaurant/dashboard` — missing even after the `29831bd` prefix fix (already noted in the 07-15 audit) | restaurant dashboard |

## 3. Preview verticals — mock-only BY DESIGN (no action)

golf (9 paths), pricing (6), warehouse (6), documents (4), promotions (8) have no
backend module at all — documented as UI-preview-only per `ae79907` and the
LOOP_STATE drift-sweep note. Not bugs; keep labeled Preview in the UI.

## 4. Backend ahead of frontend (informational)

174 backend paths are never referenced by the web app. Beyond the 65 double-prefix
phantoms (§1), the concentration is: purchasing (19), sales (14), inventory (9),
catalog (8), accounting (7), customers/outlets/settings (5 each). Mostly deeper
CRUD/actions the UI hasn't surfaced — no action needed, useful map for future pages.

## 5. Verified-benign scan artifacts (for the next auditor)

`/api/v1/things` (JSDoc example in `client.ts`), `/api/v1/progress` (comment in
`types.ts`), `…${search}`/`…${q}` query-string concatenations,
`deposits/:id/:action` → matches `approve|reject` routes,
`expiry/:id/:action` → matches `discard|return-to-vendor`,
`vendors/:id/:tab` → matches the 5 vendor subroutes.

## ADDENDUM (same day, follow-up session) — fixes shipped

Status label: **Built, typecheck-verified; tests written but NOT executed in
this environment** (sandbox has macOS-installed node_modules; esbuild binary
mismatch — run `npm test` locally / rely on CI).

1. **§1 critical fixes PORTED to this branch** (not the whole cherry-pick — the
   clean-arch quotes pilot stays on session C's branch): double-prefix dropped
   in all 10 modules + their new regression tests + test-request helpers
   (checked out verbatim from `29831bd`; files were identical to the merge-base),
   `requireModule` added to gateway/auth.ts WITHOUT the pilot's authorization.ts
   refactor, SSO public router mounted ahead of the auth gate in app.ts.
2. **Team time clock built**: `time_entries` table (partial unique index = one
   open entry per member), atomic clock-in/out (INSERT…WHERE NOT EXISTS /
   single UPDATE), self-or-management guard; per-member permission-requests/
   overrides delegate to the permission_requests module (new
   `listOverridesForUser` with live expiry computation). Tests added.
3. **Customers search + merge built**: `{items}` envelope (FE + mock aligned);
   merge is one transaction with sorted FOR UPDATE locks, repoints
   orders/invoices/quotations/sales_orders + satellites (survivor wins
   conflicts), adds points/store-credit, deletes the duplicate, publishes
   `customer.merged`. Tests added.
4. **Orders timeline built**: derived from order row + payments (no event
   table — honestly documented approximations in the JSDoc). Tests added.
5. **Storefront auth gated as Preview** (per decision): `previewMode` in
   StoreAuthContext (mirrors MockWorkerInit's mock switch;
   `NEXT_PUBLIC_STORE_AUTH_ENABLED=1` re-enables when a backend ships), login
   page banner + disabled submit outside mock/demo mode.
6. **Guardrail shipped**: `tools/api-gap-scan.mjs` + `npm run gap:scan`, wired
   into CI (hygiene job) and `npm run verify`; allowlist
   `tools/api-gap-allowlist.json` (56 paths/6 prefixes, each board-tracked;
   scanner warns on stale entries so it only shrinks). Negative-tested (bogus
   FE path → exit 1). Parity policy added to CODING_STANDARDS.md; `fe-be-parity`
   Cowork skill packaged for install.
7. **NOT fixed, reclassified**: `settings/custom-roles` is a contract mismatch,
   not a path mismatch — FE permissions page speaks `{name,color,features}` +
   bulk `/settings/permissions`, backend speaks `{name,permissions}` from a
   fixed vocabulary, no color. Merging two permission vocabularies is a design
   decision → NEEDS-SRI.

## ADDENDUM #2 (same day, 2nd follow-up session) — catalog product-detail wave

Status label: **Built and test-verified** (typecheck clean both sides; 19 new
tests in `src/modules/catalog/detail-views.test.ts` executed against real
Postgres in this session — see note below on how — plus regression runs of
customers/team/sso/orders-timeline/workforce/catalog's original 26-test suite,
all passing, 0 failures).

1. **17 of 18 catalog product-detail paths built.** New
   `src/modules/catalog/detail-views.ts` (+`detail-routes.ts`): stock, sales,
   sales-by-customer, purchases, invoices, returns, duplicate are real joins
   over existing tables; reorder-suggestions, analytics (live ABC/Pareto
   classification), and supplier-price-comparison are derived metrics with
   the approximations documented in-code (no forecasting model, no per-line
   return record, no landed-cost/freight tracking — all pre-existing schema
   gaps, not hidden). New CRUD: suppliers (`product_suppliers`, find-or-create
   by name, upsert-on-conflict), pricing + quantity-break tiers
   (`product_price_tiers`, distinct from sales' customer-tier
   `product_tier_prices`), expiry lots (extends `inventory_lots` rather than
   duplicating it, so manual entries feed the existing Expiry Pool sweep),
   and images (PATCH is_primary + a properly product-scoped nested DELETE).
2. **Catalog never wrote to audit_log before this.** `CatalogService.create/
   update/updateCompliance` now call `writeAudit`; `archive()` inherits it
   for free (it's just `update({status:'archived'})`) and is classified as
   an "archive" action at read time. New `GET /:id/audit-log` flattens
   audit_log rows into one entry per changed field.
3. **`/catalog/:id/credits` deliberately NOT built** — no backing concept
   (AR credit memo, or otherwise) exists anywhere in the schema. Left
   allowlisted; needs a Sri decision on what a product-level "credit" even
   means before it's plumbing work.
4. **Two real bugs caught only by running tests, not by typecheck or the
   gap-scanner:**
   - **Table-name collision**: wave-1's team time-clock table was named
     `time_entries` — the pre-existing `workforce` module already owns a
     table by that exact name (BE-40, `employee_id`-keyed). Team registers
     first in `modules/index.ts`, so its `CREATE TABLE IF NOT EXISTS` won
     the race on a fresh schema, silently omitting workforce's
     `employee_id` column. Fixed by renaming to `team_time_entries`
     (separate fix commit; no data migration needed, nothing had shipped
     against the collided name).
   - **Suppliers upsert**: re-adding the same vendor name to a product hit
     the `(tenant,product,supplier)` UNIQUE constraint as a raw 500. Fixed
     with `INSERT ... ON CONFLICT DO UPDATE`.
   - **ImagesTab contract drift** (pre-existing, not from this session):
     the GET/POST routes already existed but the frontend used `url`/`alt`
     against a backend that returns `image_url`/`alt_text`, and its DELETE
     called a bare unauthenticated `fetch()` against an unscoped path. This
     class of bug is invisible to `gap:scan` (paths existed; the *shapes*
     didn't match) — fixed in `ImagesTab.tsx` and by adding the missing
     product-scoped nested DELETE route.
5. **Local test execution was possible all along.** The earlier note that
   "the sandbox can't run tests" was an environment artifact (a
   platform-mismatched `esbuild` binary in `node_modules`), not a hard
   platform limit — `npm install --no-save esbuild --force` fixed it. Worth
   knowing for any future Cowork session on this repo.

## ADDENDUM #3 (same day, 3rd follow-up session) — inventory pipeline wave + 3 unrelated live bugs

Status label: **Built and test-verified** (typecheck clean; 4 new pipeline
tests + 2 new inventory/serial_numbers regression tests, all executed
against real Postgres; full targeted regression across catalog, inventory,
serial_numbers, purchasing, workforce, team, customers, orders, sso — 138+
tests — passes clean; gap:scan clean, 34 allowlisted, down from 38).

1. **Inventory pipeline: 4 of 13 paths built.** New
   `src/modules/inventory/pipeline-views.ts` + `pipeline-routes.ts`:
   `GET /pipeline/pending` (open PO lines, real join over
   purchase_order_lines/purchase_orders/suppliers/products —
   expected_date/outlet honestly approximated since no ETA or location-
   assignment concept exists on purchase orders), `GET /pipeline/history`
   (fully-received lines with a real lead_time_days from created_at/
   received_at; cost_variance_cents/receiver honestly zero/empty — receive()
   never revises unit cost or records an actor), and
   `GET /pipeline/reorder-alerts` + `POST .../:id/create-po` (tenant-wide
   version of inventory/reorder-suggestions, extended with avg_daily_sales/
   days_until_stockout/estimated_cost_cents/urgency/open_po_qty; create-po
   opens a real PO via PurchasingService.createOrder against the product's
   preferred supplier, 400s with a clear message if none is linked).
2. **Receiving, Issues, Errors, and the pipeline Overview funnel reclassified
   NEEDS-SRI**, not built. Each implies a subsystem absent from the schema:
   Receiving needs a stateful "receiving session" (start → progressively scan
   → a receiver/batch_id) where today receive() is one atomic call; Issues
   and Errors are GET+PATCH only in the FE with no POST anywhere, implying an
   unbuilt *detection* engine (categories like sku_mapping, price_mismatch,
   duplicate_doc, edi_parse that nothing computes); the Overview funnel's
   9 stages don't map onto the real 4-value POStatus enum. Same call as
   catalog `/credits` — a design decision, not plumbing.
3. **Three unrelated live bugs found and fixed while surveying this
   surface** (none introduced this session, all pre-existing):
   - **`catalog_products` table/column typo**: `InventoryService.
     getReorderSuggestions()` and three queries in `serial_numbers/
     service.ts` joined a table called `catalog_products` with columns
     (`reorder_quantity`, `preferred_vendor_id`, `preferred_vendor_name`)
     that don't exist anywhere in the schema — the real catalog table is
     `products`, with no reorder_quantity column, and preferred-vendor
     tracked in catalog's `product_suppliers` table (added addendum #2).
     This 500'd on every call against a real database despite being wired
     to two live pages (purchasing's Reorder tab, `/inventory/reorder`) and
     the inventory serials page. Fixed to join the real tables.
   - **Route-shadowing in `inventory/routes.ts`**: `GET /:productId` was
     registered (originally line 322) *before* `GET /counts`, `GET
     /locations`, and `GET /reorder-suggestions` (originally lines
     398-445). Express matches GET routes in registration order and
     `/:productId` matches any single path segment literally — all three
     were 100% dead code, silently handled by the per-product stock
     handler instead (wrong shape, no error; invisible to typecheck and to
     gap-scan since the paths themselves existed). Moved all three ahead
     of the catch-all.
   - **Missing-prefix + mount-collision on `/inventory/serials`**: the FE
     page called `apiPost`/`apiGet`/`apiPatch` with paths missing the
     `/api/v1` prefix entirely — invisible to gap-scan, whose FE regex only
     matches literals that already contain the prefix. Separately,
     `serial_numbers` module had no `mountPath` override, so its routes
     registered at `/api/v1/serial_numbers/inventory/serials` instead of
     `/api/v1/inventory/serials`. Adding `mountPath: "/api/v1"` alone
     wasn't sufficient: `inventoryModule` (mounted at `/api/v1/inventory`,
     registered earlier in `src/modules/index.ts`) would still intercept
     the request via its own `/:productId` catch-all before
     `serial_numbers`' router was ever reached, since Express tries
     `app.use` middleware in registration order. Fixed by reordering
     `serialNumbersModule` to register (and thus mount) before
     `inventoryModule`.
4. **Also fixed, carried over from addendum #2's uncommitted state**: the
   `'partial'`/`billed_qty` bug in catalog's `reorderSuggestions()` —
   `po.status IN ('ordered', 'partial')` should have read
   `'partially_received'`, and the incoming-qty formula used `billed_qty`
   (vendor-invoice reconciliation, stays NULL until invoiced) instead of
   `received_qty` (physical receipt progress), so incoming stock reported
   the full original order quantity even after partial receiving. Fixed,
   with a regression test proving a 20-unit PO partially received 8 now
   reads 12 incoming, not 20 or 0.
5. **gap:scan hardened**: now also flags any `apiGet`/`apiPost`/`apiPatch`/
   `apiPut`/`apiDelete` call site whose literal path doesn't start with
   `/api/` — a distinct blind spot from the existing missing-route check,
   since the original scanner's FE regex only matched literals that already
   contained `/api/v1` or `/api/identity`.

## Recommended order of attack

1. Merge/cherry-pick `29831bd` (unblocks 10 modules + SSO + pack isolation) — one PR.
2. Catalog product-detail endpoints (biggest single mock-only surface in the retail core).
3. Team time-tracking + customers search/merge + orders timeline (small, high-traffic).
4. Fix the `settings/custom-roles` path mismatch (1-line FE or mountPath change).
5. Decide: ecommerce storefront auth — build backend or gate the storefront UI.
6. Inventory pipeline/errors pages — either build endpoints or label Preview.
