# Finder — Living Roadmap (backlog for scheduled dev agents)

**Product framing:** Finder is a standalone POS/business-management platform,
sold as a single **hybrid** codebase to three buyer profiles — retail (single
till, walk-in customers), wholesale/B2B (quotes, sales orders, AR/AP,
purchasing), and enterprise (multi-store). A per-tenant **edition** setting
(see `gaps/PRODUCT_SEGMENTATION.md`, BE-18/FE-13) controls which module groups
are surfaced, defaulting to everything on. No feature is ever removed for any
profile — segmentation is presentation/visibility only.
`ERP_BENCHMARK.md` (the erp.fairtradetx.com 18-prompt spec) is **inspiration
only** — a source of feature ideas — not a spec Finder must match or depend
on. Don't frame work as "closing benchmark gaps"; frame it as "this is a
useful feature for Finder's users." Skip/deprioritize benchmark items that
don't fit Finder's own direction (e.g. don't chase exact terminology,
1:1 page parity, or the full 60+ report list for its own sake).

This file is the shared backlog for the two scheduled developer agents (see
`AGENT_BACKEND_CYCLE.md` and `AGENT_FRONTEND_CYCLE.md`). Each run:

1. Picks the **first unchecked item in its lane**.
2. Implements it, verifies it, commits it.
3. Checks it off (`- [x]`) and adds a one-line note with the commit hash.
4. If the work surfaced new follow-ups, appends them to the bottom of its lane
   (don't reorder existing items — keep the queue stable across runs).
5. If a lane is empty, the agent picks the top item from "Cross-cutting"
   (claim it by moving it into your lane with your tag, so the other agent
   doesn't duplicate it).

Source material: `ERP_BENCHMARK.md` (parity matrix),
`CATALOG_PRODUCT_FINDER.md` (catalog/product-detail benchmark notes), and
`orchestration/gaps/*.md` (per-module gap analysis from the 2026-06-15
enterprise architecture assessment — one file per module, each ending in a
curated "what this turns into on the roadmap" section). Historical docs
(old three-agent prompt book, one-time audits, prior environment model) are
in `orchestration/_archive/` and are not source material for new work.

**2026-06-15 re-sequencing note:** BE-9..BE-17 and FE-10..FE-12 (added
2026-06-15 from the gap analysis) were re-ordered by value/dependency — see
"Next up" below. This is a one-time exception to rule 4 above (normally
agents don't reorder); the IDs and full descriptions are unchanged, only
pickup order moved, so every gap-file cross-reference (e.g. "see
`gaps/INVENTORY_GAPS.md`") still resolves correctly. No item was removed.
Likewise, every "out of scope" / "defer" verdict in `orchestration/gaps/*.md`
and every doc moved to `orchestration/_archive/` (via `git mv`, history
intact) remains fully documented as retained-but-deprioritized backlog —
nothing described in the 2026-06-15 assessment was deleted from the project's
records, only triaged into "build now" vs. "documented for later."

**Next up (optimized pickup order for BE-9..17 / FE-10..12):**
1. **BE-9** (inventory reservation/oversell guard) — highest-value, no
   dependencies, unblocks accurate `available` stock everywhere.
2. **BE-16** (age-restriction compliance flag) — small, no dependencies,
   quick win that unblocks FE-12's checkbox half.
3. **BE-13** (customer credit limit) — no dependencies, unblocks FE-10.
4. **BE-11** (partial PO receiving) — no dependencies; BE-12 builds on it.
5. **BE-12** (bill variance flag) — depends on BE-11's receive data.
6. **BE-14** (AR dunning) — no dependencies, reuses existing `ar-aging`.
7. **BE-17** (register sessions) — no dependencies, unblocks FE-12's
   register half.
8. **BE-10** (cycle count sessions) — larger, self-contained; scheduled
   after the smaller/dependency-unblocking items above.
9. **BE-15** (shipping tracking fields) — trivial, last.
10. **BE-18** (edition presets/feature-flag groups) — added 2026-06-15 for
    the hybrid retail/wholesale/enterprise direction; no dependencies on
    BE-9..17, but placed after them since it's purely additive grouping
    over features that should exist first.
11. **FE-11** (discount rule builder) — no backend dependency, can start
    immediately.
12. **FE-10** (credit limit UI) — once BE-13 lands.
13. **FE-12** (age-verification + register UI) — once BE-16/BE-17 land.
14. **FE-13** (edition-aware navigation) — once BE-18 lands; last, since it
    depends on every other group's routes already existing to gate.

---

## Infrastructure / Ops lane — FIRST PRIORITY (blocks enterprise deployment)

> **These items take priority over any feature work in the Backend or Frontend
> lanes.** Pick the first unchecked INF item before any BE or FE item.
>
> Assessment date: 2026-06-22. Eight issues identified as enterprise blockers.
> CI/CD and partial Service Worker already existed — see run log.

- [x] INF-1: Migration locking — wrap all module migrations in `db.tx()` with
      `pg_advisory_xact_lock(7381920)` so concurrent cold-starts on a
      multi-instance deploy serialize instead of racing. `schema_migrations`
      table created before the lock since `CREATE TABLE IF NOT EXISTS` is
      idempotent. `runIfNew` refactored to accept a transaction DB. (done in this commit)
- [x] INF-2: Graceful shutdown — replace bare `app.listen` in `server.ts`
      with a stored `server` handle; `SIGTERM`/`SIGINT` handlers call
      `server.close()` + `db.close()` with a 10 s force-exit fallback.
      Prevents lost in-flight requests during rolling deploys. (done in this commit)
- [x] INF-3: Structured logging — install `pino`; create `src/shared/logger.ts`
      with ISO timestamps and level labels; replace `console.warn`/`console.log`
      in `app.ts` and `server.ts` with typed `logger.*` calls. (done in this commit)
- [x] INF-4: Stripe webhook verification — register `POST /api/stripe/webhook`
      with `express.raw({ type: 'application/json' })` BEFORE `express.json()`
      so the raw buffer is available; verify using
      `stripe.webhooks.constructEvent()` + `STRIPE_WEBHOOK_SECRET` env var;
      publish verified events to the internal EventBus. (done in this commit)
- [x] INF-5: Durable EventBus — EventBus gained a Redis Pub/Sub bridge via
      `useRedis(redis)`. `publish()` dispatches locally then broadcasts to
      `"finder:events"` channel; all other instances receive and re-dispatch.
      Self-messages suppressed by instance ID. Falls back to local-only when
      REDIS_URL is unset. buildApp() wires the bridge and returns cleanup().
      openRedis() now returns `Redis | null` (full ioredis type). (done in a957060)
- [x] INF-6: Background job queue — Postgres-backed QueueConsumer/Producer was
      already in place with FOR UPDATE SKIP LOCKED. Added: `AR_DUNNING` queue
      name + arDunningJob handler (runs BillingService.runDunning per tenant,
      re-enqueues itself 24 h later). Bootstrap seeds one job per tenant on
      startup via enqueueOnce (idempotent). BullMQ deferred — Postgres queue
      is sufficient for current scale. (done in a957060)
- [x] INF-7: Connection pool sizing — add `PG_POOL_MAX` env var guidance to
      `.env.example`; document that Neon / Railway users should point
      `DATABASE_URL` at the pool proxy endpoint (not the direct DB). Add a
      `/readyz` pool-saturation check that returns 503 when all connections
      are in use. (done in ed732b4; /readyz + poolStats() already done in a957060)
- [ ] INF-8: Offline terminal — IndexedDB write-ahead queue for checkout
      commands when the network is unavailable; replay on reconnect with
      idempotency key deduplication. Extends the shell Service Worker
      (`web/public/sw.js`) already in place. See SYSTEM_DESIGN.md §7.
      Estimated effort: 3–4 days (FE-heavy).
- [ ] INF-9: E2E test suite (Playwright) — cover the golden paths: login →
      checkout, inventory receive, invoice pay. Run in CI against a real
      backend + Postgres (reuse the CI job's postgres service container).
      Estimated effort: 2–3 days.
- [x] INF-10: API key scope enforcement — `makeAuthMiddleware(db)` factory
      handles both JWT sessions (scopes:[]=unrestricted) and API key tokens
      (fpk_ prefix: DB lookup, SHA-256 verify, scope population). Added
      `requireScope(scope)` middleware factory. app.ts now uses
      makeAuthMiddleware(db) on /api/v1/*. Plain authMiddleware() kept for
      test compatibility. Exported from gateway/index.ts. (done in d74a87f)
- [x] INF-11: Replace remaining `console.*` — deleted debug _repro.ts; added
      moduleLogger to 14 source files across gateway, payments, orchestration
      jobs, sagas, queue-consumer, and workflow-runner. Zero console.* calls
      remain in non-test src/ (redis.ts done by parallel agent). (done in b67c080)

---

## Backend lane (src/, db/, contracts/, scripts/)

- [x] BE-1: Finish the RBAC matrix — apply `requireRole("manager")` from
      `src/gateway/auth.ts` to remaining sensitive mutations: purchasing
      vendor-credits/returns/PO-receive, discounts create/status, accounting
      deposit create, sales-order cancel/void, giftcard/customer redeem
      overrides. List each route touched in the commit message. (done)
- [x] BE-2: Refresh-token rotation/revocation — make refresh tokens single-use
      (rotate on `/api/identity/refresh`, invalidate the old one), add a
      revocation check on logout. Add tests.
- [x] BE-3: Reports — add `sales-by-rep` and `sales-by-vendor` pivots plus a
      basic P&L (`GET /api/v1/reports/pnl?range=`) using existing
      income/expense accounts from the COA.
- [x] BE-4: Multi-store filter — add `storeIds[]` to the JWT (from `outlets`)
      and accept `?storeIds=` on the major list endpoints (orders, inventory,
      sales-orders, invoices) filtering by `store_id`.
- [x] BE-5: Per-customer discount usage limit enforcement at redeem time
      (SECURITY_AUDIT M2 follow-up #4) — `discounts.evaluate`/`redeem` should
      check `per_customer_limit` against a usage ledger keyed by customer.
- [x] BE-6: Catalog — category tree (`categories` table with `parent_id` +
      `product_categories` join) and product detail fields (description,
      brand, dimensions/weight, image_url, preferred_vendor_id/vendor_upc,
      min/max qty to sell + qty increment). See `CATALOG_PRODUCT_FINDER.md`.
      (done in e04283b)
- [x] BE-7: Catalog — bulk operations: `POST /api/v1/catalog/bulk-update`
      (field updates for selected SKUs, manager-gated), CSV
      `import`/`export`, and bulk barcode generation. See
      `CATALOG_PRODUCT_FINDER.md`. (done in 904d3b6)
- [x] BE-8: Catalog — master/child product variants: `parent_product_id` +
      `variant_label` on `products`; master rows have price 0/qty 0 and are
      excluded from sellable lists; endpoint to bulk-assign children to a
      master. See `CATALOG_PRODUCT_FINDER.md`. (done in 038eeed)
- [x] BE-9: Inventory reservation — on `POST /api/v1/orders`, check
      `available` (onHand − committed) per line and reject (409
      `insufficient_stock`) if short; increment `committed` on order
      creation, release it on completion/void/refund. Make `committed` in
      `GET /inventory/levels` reflect real reservations (currently
      hardcoded to 0). See `gaps/INVENTORY_GAPS.md`. (done in this commit)
- [x] BE-16: Compliance — age-restriction flag: `products.age_restricted`
      (boolean, default false); `POST /api/v1/sales/sales-orders` and
      `POST /api/v1/orders` reject (400) if any line is age-restricted and
      the request lacks `ageVerified: true`. See
      `gaps/SETTINGS_TEAM_COMPLIANCE_GAPS.md`.
- [x] BE-13: Customers — credit limit: add `credit_limit_cents` (nullable)
      to `customers`; enforce on `POST /sales-orders` and `POST /invoices`
      (409 `credit_limit_exceeded` for `cashier`, allowed with a logged
      override for `manager`/`owner`). Surface `creditLimitCents` +
      `creditAvailableCents` in the customer financial summary. See
      `gaps/SALES_ORDERS_GAPS.md`.
- [x] BE-11: Purchasing — partial PO receiving: `POST
      /api/v1/purchasing/orders/:id/receive` accepts a `quantity` per line
      (≤ remaining); PO status tracks
      `open → partially_received → received`, repeatable until fully
      received. See `gaps/PURCHASING_GAPS.md`.
- [x] BE-12: Purchasing — bill variance flag: when an auto-drafted bill's
      total ≠ `sum(receivedQty * unitCost)` across all receives for its PO,
      set `bills.variance_cents` (signed) and surface it in
      `GET /billing/bills`. See `gaps/PURCHASING_GAPS.md`.
- [x] BE-14: Accounting — AR dunning: for invoices `> 30/60/90` days
      overdue (reuse `ar-aging` query), set `invoices.dunning_level` and
      emit `invoice.overdue` (consumed by `webhooks`). See
      `gaps/ACCOUNTING_GAPS.md`.
- [x] BE-17: Outlets — register sessions:
      `POST /registers/:id/open` (starting cash float),
      `POST /registers/:id/close` (counted cash, computes variance against
      float + cash-tender sales since open); read endpoint for session
      history. See `gaps/SETTINGS_TEAM_COMPLIANCE_GAPS.md`.
- [x] BE-10: Cycle count sessions —
      `POST /api/v1/inventory/counts` (open session with expected qtys per
      SKU), `POST /:id/lines` (record counted qty), `POST /:id/close`
      (manager-gated; posts variances as `inventory_movements`
      adjustments). See `gaps/INVENTORY_GAPS.md`.
- [x] BE-15: Shipping — add optional `tracking_number` + `carrier` text
      fields to shipping orders, settable on `POST /:id/ship`. No carrier
      API integration. See `gaps/FULFILLMENT_SHIPPING_GAPS.md`.
- [x] BE-18: Edition presets — extend `DEFAULT_FLAGS`
      (`src/modules/settings/service.ts`) with `groupRetailPOS`,
      `groupWholesale`, `groupEnterprise` (all default `true`). Add
      `POST /api/v1/settings/edition` (manager-gated, body:
      `"retail" | "wholesale" | "enterprise" | "hybrid"`) that sets the
      three group flags to a preset via the existing `setFlags`, individually
      overridable after. Gate `sales`/`billing`/`purchasing`/`accounting`
      routes behind `groupWholesale` and `giftcards`/register-session routes
      behind `groupRetailPOS` (404 when off). See
      `gaps/PRODUCT_SEGMENTATION.md`.

## Frontend lane (web/)

- [x] FE-1: Purchasing/Receiving UI — suppliers list, create PO (with
      lot/expiry lines), receive flow; surface `costCents` + margin on the
      inventory grid. Wire to `/api/v1/purchasing/*`. (done in 7d59820)
- [x] FE-2: Accounts (AP/AR) surface — bills/invoices lists with aging buckets
      from `GET /reports/ar-aging` and `/ap-aging`; pay actions. (done in
      a391420)
- [x] FE-3: Near-expiry/markdown report — table from
      `GET /api/v1/inventory/expiring` + `/expired`, with a lot column on the
      main inventory grid and a "Return to vendor" action
      (`/purchasing/returns`).
- [x] FE-4: Operations — Locations grid (assign products to bins via
      `/fulfillment/assign`) + Pick & Pack queue
      (`/fulfillment/pick-lists`, pick line, pack).
- [x] FE-5: Settings — Chart of Accounts tree editor
      (`/accounting/accounts*`) + Batch Deposits list/create/approve
      (`/accounting/deposits*`).
- [x] FE-6: Audit existing `web/mocks/mockHandlers.ts` against live
      backend routes; flip any still-mocked endpoints used by built pages to
      live `apiGet`/`apiPost` calls. (done in e85f0a9)
- [x] FE-7: Catalog filter/bulk-select UI on `/inventory` — category-tree
      filter, row checkboxes + "Actions" menu (bulk status/category update,
      CSV export), consuming BE-6/BE-7. See `CATALOG_PRODUCT_FINDER.md`.
      (done)
- [x] FE-8: Product detail/edit page (`/inventory/products/[id]`) with
      General, Categories, Price (live cost/price/margin/markup), Manage Qty,
      and Image sections, consuming BE-6. See `CATALOG_PRODUCT_FINDER.md`.
      (done)
- [x] FE-9: Variants UI — master/child editor on the product detail page plus
      a visual distinction for master rows in the `/inventory` list,
      consuming BE-8. See `CATALOG_PRODUCT_FINDER.md`. (done)
- [x] FE-11: Discounts — rule builder on `/discounts`: create/edit form
      covering `ruleType` (simple/volume/bxgy), `discountType`
      (fixed/percent), `applyTo`, `tierRestriction`,
      `minOrderCents`/`minQty`, `buyQty`/`getQty`, date window,
      `autoApplicable`, `usageLimit`/`perCustomerLimit`, coupon code.
      Consumes existing `/api/v1/discounts*` endpoints. See
      `gaps/DISCOUNTS_GAPS.md`. (done)
- [x] FE-10: Customers — show `creditLimitCents`/`creditAvailableCents` on
      the customer detail panel; warn (or block, with manager override) on
      SO/invoice creation when a customer is over their credit limit,
      consuming BE-13. See `gaps/SALES_ORDERS_GAPS.md`.
- [x] FE-12: Checkout/operations — age-verification checkbox on the cart
      when any line is `age_restricted` (consumes BE-16); register
      open/close screen with running cash-variance summary (consumes
      BE-17). See `gaps/SETTINGS_TEAM_COMPLIANCE_GAPS.md`. (done)
- [x] FE-13: Edition-aware navigation — read `/feature-flags` at app load;
      hide nav sections/routes for disabled groups (`groupWholesale` hides
      Sales Orders/Purchasing/Accounting, `groupRetailPOS` hides Gift
      Cards/Register Sessions). Add a "Business type" picker on
      `/settings/business` calling `POST /settings/edition`, plus the three
      group toggles for custom mixes. Consumes BE-18. See
      `gaps/PRODUCT_SEGMENTATION.md`.

- [x] FE-14: Compliance product flags + state enforcement — catalog/[id] gets a
      Compliance card (tobacco_type, flavored, menthol, msa_reportable, 50-state
      restricted_states grid) saved via PATCH /api/v1/catalog/:id/compliance. Terminal
      blocks add-to-cart when product.restrictedStates includes the outlet's state code.
      Types updated; MSW flavored vape seeded as restricted in CA/MA/NJ/RI/IL. (done in ceceff3)

- [x] FE-15: Terminal UX polish — CardReaderScreen component (4-state animation:
      waiting→reading→processing→approved, ~3300ms total, pulsing ring + progress bar)
      wired into TenderScreen for card payments. NumpadModal (3×4 grid, keyboard support,
      max 4 digits, qty≥1 validation) wired into CartPanel quantity display. (done in 6de146e)

- [x] BE-19: Notifications module — new `src/modules/notifications/` module. Table
      `notifications(id, tenant_id, type, severity, title, message, read, created_at)`.
      `GET /api/v1/notifications` (filter `?unread=true`, paginated), `PATCH
      /api/v1/notifications/:id/read`, `POST /api/v1/notifications/mark-all-read`.
      Emit notifications from EventBus handlers in other modules (low-stock, overdue
      invoice). See FE-6 audit: /notifications page and dashboard widget both call these. (done in 00c515a)
- [x] BE-20: Audit log read endpoint — the `audit_log` table already exists (Wave 0).
      Add `GET /api/v1/audit-log` to the identity router (no new module needed):
      filter by `?actor=`, `?resourceType=`, `?action=`, `?limit=`, `?offset=`.
      Returns `{ items: AuditEvent[], total }`. See FE-6 audit: /audit-log page uses this. (done in 15f4f4a)
- [x] BE-21: Loyalty programme — `GET/POST/PATCH/DELETE /api/v1/loyalty/tiers` (tier
      objects with UUID `id`, `name`, `level`, `points_required`, `discount_pct`,
      `description`); `GET /api/v1/loyalty/members` + `POST /api/v1/loyalty/members/:id/adjust`
      (points delta); `GET/POST/PATCH/DELETE /api/v1/loyalty/rewards` (reward catalogue:
      `name`, `points_cost`, `reward_type`, `status`). New `loyalty` module. Note: the
      simpler `loyalty_tier_rules` table used by /settings already lives in the customers
      module — this is a richer separate programme management feature. (done in 2b681b7)

- [x] BE-22: Compliance columns on products table — add `tobacco_type TEXT`,
      `flavored INTEGER DEFAULT 0`, `menthol INTEGER DEFAULT 0`,
      `msa_reportable INTEGER DEFAULT 0`, `restricted_states TEXT` (JSON array)
      to the `products` table via a migration. Expose `PATCH /api/v1/catalog/:id/compliance`
      (manager-gated) that updates those columns. Note: FE-14 already built the UI
      against a mock of this endpoint. (done in 41cd91e)

## Phase 2 — General Retail (Apparel, Electronics, Bike, Pet, Sporting Goods)

### Frontend lane (Phase 2)

- [x] FE-16: Service Orders page (`/service-orders`) — repair ticket management for
      bike shops, electronics repair, and other service-oriented retail. UI: list of
      tickets with status (draft/open/in_progress/ready/closed), create modal (customer,
      device/item description, estimated cost, assigned tech), status transitions, and
      ticket detail modal. Mock endpoints: `GET/POST /api/v1/service-orders`,
      `PATCH /api/v1/service-orders/:id`. Types: `ServiceOrder`, `ServiceOrderStatus`.
      Nav group: Operate.

- [x] FE-17: Serialized Inventory page (`/inventory/serials`) — track individual units
      by serial number for electronics and jewelry. List view of serial numbers with
      status (in_stock/sold/returned/service), search by serial, and link to product.
      Mock endpoints: `GET /api/v1/inventory/serials`, `POST /api/v1/inventory/serials`.
      Nav group: Manage. (done in 9ff2cc3)

- [x] FE-18: Workforce — Employee Scheduling (`/workforce`) — weekly schedule grid
      (Mon–Sun × employee rows), shift blocks with color coding by role, add/edit/delete
      shifts via modal, time-off requests list. Mock endpoints:
      `GET/POST/PATCH/DELETE /api/v1/workforce/shifts`, `GET /api/v1/workforce/employees`.
      Nav group: Manage. (done in 20b9148)

### Backend lane (Phase 2)

- [x] BE-23: Service Orders module (`src/modules/service_orders/`) — table:
      `service_orders (id, tenant_id, customer_id, title, description, status,
      assigned_to, estimate_cents, actual_cents, created_at, updated_at)`.
      CRUD endpoints: `GET/POST /api/v1/service-orders`,
      `GET/PATCH /api/v1/service-orders/:id`. Status transitions:
      draft→open→in_progress→ready→closed. EventBus: `service_order.status_changed`.
      (done in 9ff2cc3)

- [x] BE-24: Serialized Inventory module — table: `serial_numbers (id, tenant_id,
      product_id, serial, status, sold_at, service_order_id, created_at)`.
      Endpoints: `GET /api/v1/inventory/serials` (filterable by product/status),
      `POST /api/v1/inventory/serials` (receive), `PATCH /api/v1/inventory/serials/:id`
      (status update). Index on `(tenant_id, product_id)` and `(tenant_id, serial)`.
      (done in 9ff2cc3)

## Phase 3 — Operations Depth (Workforce, Accounts, Reports, Reorder)

### Backend lane (Phase 3)

- [x] BE-25: Workforce backend module (`src/modules/workforce/`) — three tables:
      `employees (id, tenant_id, name, role, email, avatar_color, created_at)`,
      `shifts (id, tenant_id, employee_id, date, start_time, end_time, notes, created_at, updated_at)`,
      `time_off_requests (id, tenant_id, employee_id, date_from, date_to, reason, status, created_at)`.
      CRUD endpoints matching FE-18 mock handlers exactly:
      `GET /workforce/employees`, `GET/POST/PATCH/DELETE /workforce/shifts`,
      `GET/PATCH /workforce/time-off`. Completes the real backend for FE-18. (done in 261c8cc)

- [x] BE-26: Customer contacts + addresses — two new tables:
      `customer_contacts (id, tenant_id, customer_id, name, role, email, phone, is_primary, created_at, updated_at)`,
      `customer_addresses (id, tenant_id, customer_id, label, line1, line2, city, state, zip, country, is_default, created_at, updated_at)`.
      Endpoints: `GET/POST/PATCH/DELETE /customers/:id/contacts`,
      `GET/POST/PATCH/DELETE /customers/:id/addresses`.
      Indexes on `(tenant_id, customer_id)` for both tables.
      Tables already existed; added PATCH+DELETE endpoints + ContactsPanel
      edit/remove UI on `/customers/[id]`. (done in 261c8cc)

- [x] BE-27: Reorder management — `GET /inventory/reorder-suggestions` returns
      products where `on_hand <= reorder_point` (non-zero reorder_point only),
      joined with preferred_vendor from catalog, grouped by vendor for
      bulk-PO creation. `POST /inventory/reorder-suggestions/create-po` accepts
      `[{ product_id, quantity, vendor_id }]` and creates a draft PO via
      purchasing module's service. EventBus: `inventory.reorder_triggered`.
      (done in 3ee1aa2)

### Frontend lane (Phase 3)

- [x] FE-22: Customer Account Detail — enhance `/customers/[id]` with two new
      tabs: Contacts (add/edit/delete contacts per account, star to set primary)
      and Addresses (add/edit/delete delivery addresses, set default). Consumes
      BE-26 endpoints. Mock handlers for both resources. (done in 289fc23)

- [x] FE-23: Reorder Dashboard (`/inventory/reorder`) — page showing all products
      at or below reorder point, grouped by vendor. Stat cards: SKUs below
      reorder, total vendors affected. Table: product, current stock, reorder
      point, suggested qty, vendor. Checkbox select + "Create Draft PO" bulk
      action calling BE-27. Mock endpoint: `GET /inventory/reorder-suggestions`.
      Nav group: Manage. (done in 3ee1aa2)

- [x] FE-24: Enhanced Reports (`/reports`) — replace static stub with a real
      analytics page. Date-range picker (last 7d/30d/90d/custom). Report cards:
      Sales by Product (top 20, sortable), Margin by Category (bar chart),
      Inventory Valuation (total cost value by category), Low Stock SKUs.
      CSV export button per report. Consumes existing
      `/reports/summary`, `/reports/top-products`, `/reports/inventory-valuation`,
      plus new mock for `/reports/sales-by-product`. (done in 28e1164)

- [x] FE-25: Receipt Templates (`/settings/receipts`) — per-outlet receipt
      customization. Fields: header text, footer text, show_logo (toggle),
      show_barcode (toggle), show_tax_breakdown (toggle), contact_info,
      return_policy (textarea). Live preview panel (thermal receipt mockup).
      Mock endpoints: `GET/POST/PATCH /settings/receipts/:outletId`.
      Nav: sub-item under Settings.

## Phase 4 — Operational Completeness (Cycle Counts, Register Sessions, Backend Wire-up)

Phase 4 closes the remaining frontend gaps where a backend already exists but
no page was built, and adds the last two high-value operational features
identified in the gaps analysis that survived the "defer" filter.

### Frontend lane (Phase 4)

- [x] FE-26: Cycle Count UI (`/inventory/counts`) — sessions list showing
      open/closed count sessions with stat cards (open sessions, total SKUs
      to count, variance items). "New Session" button (manager) opens a modal
      with optional note; creates a session seeded with all current stock levels.
      Session detail panel: per-SKU count table (product, SKU, expected qty,
      count input, variance badge). "Close Session" button (manager) posts
      variances as adjustments. Consumes BE-10 endpoints:
      `GET/POST /inventory/counts`, `GET/POST /inventory/counts/:id/lines`,
      `POST /inventory/counts/:id/close`. Mock handlers + types.
      Nav key: `"inventory-counts"`, group: Manage. (done in 84df7e8)

- [x] FE-27: Purchasing order detail page (`/purchasing/[id]`) — full PO detail
      view: header (vendor, status, PO number, created date), line items table
      (product, qty ordered, qty received, unit cost, line total), receive
      flow with per-line qty inputs (partial receiving per BE-11). Status
      chips: open / partially_received / received / cancelled. Link from
      `/purchasing` list rows. Mock handler for `GET /purchasing/orders/:id`.
      (already implemented — confirmed present in web/app/(protected)/purchasing/[id]/page.tsx + mock handler at line 1486)

- [x] FE-28: AR Dunning dashboard — surface `invoices.dunning_level` in the
      Accounting page's invoices list (colored badge: 30d/60d/90d overdue).
      Add a "Run Dunning Sweep" button (`POST /api/v1/reports/ar-aging/sweep`,
      manager) that flags overdue invoices and shows a count of records updated.
      Consumes BE-14. (done in cf32d47)

### Backend lane (Phase 4)

- [x] BE-29: Sales rep management — `sales_reps(id, tenant_id, name, email,
      commission_pct, active, created_at)` table + CRUD endpoints
      `GET/POST /api/v1/sales/reps`, `PATCH /api/v1/sales/reps/:id`. The
      existing `sales-by-rep` report currently references `sales_rep_id` in
      quotations/sales-orders but there is no way to create or manage reps.
      Also add `GET /api/v1/sales/reps/:id/performance` (total revenue, orders,
      avg deal size over a date range). (done in 5e4e09f)

- [x] BE-30: Purchasing — early payment discount on bills: add `discount_pct`
      and `discount_date` to `bills`; when `POST /billing/bills/:id/pay` is
      called before `discount_date`, apply the discount and record
      `discount_applied_cents`. Surface in `GET /billing/bills`. See
      `gaps/PURCHASING_GAPS.md`. (done in af7d7a7)

---

## Cross-cutting (claim into your lane when picked up)

- [x] DB-1: Enable Postgres row-level security on tenant tables as
      defense-in-depth (DB_REVIEW §6). (done in 15a1228)
- [x] DB-2: Distributed rate limiting via Redis (SECURITY_AUDIT H1 follow-up) —
      the in-memory limiter doesn't share state across serverless instances. (done in c5fe02c)
- [x] PERF-1: Cursor pagination on the largest list endpoints (orders,
      inventory, invoices, sales orders). (done in d7c40dc)
- [x] PROD-1: Reconciled `master` with `backend-cycle3`/`dev`/`testing`/`prod`
      (done in `216fc4c`) — merged the 28 Cycle 3 backend commits into
      `master`. Two conflicts (scripts/smoke.ts, giftcards/service.ts)
      resolved in favor of master's versions. `backend-cycle3`/`dev`/
      `testing`/`prod` are now ancestors of `master`; new work goes to
      `master` only per the agent playbooks. Those branches are left as-is
      (frozen, no data lost) — no further action needed.

- [x] SEC-1: Security audit + hardening (2026-06-21, done in 5af7a24) —
      full application security audit covering auth, authz, input validation,
      SQL injection, XSS, secrets, and rate limiting. Six vulnerabilities fixed:
      (HIGH) customer PATCH/POST privilege escalation — split schema into
      staff/manager tiers, added requireRole("manager") to PATCH /:id;
      (MED) receipt template endpoints missing role guard — added mgr to
      POST/PATCH /settings/receipts/:outletId;
      (MED) /metrics publicly accessible — added METRICS_TOKEN bearer guard;
      (MED) quotation state transitions (send/accept/cancel/convert) missing
      mgr guard;
      (LOW) logout read tenantId from request body — now taken from JWT only;
      (LOW) no frontend security headers — added web/middleware.ts with CSP,
      X-Frame-Options, Referrer-Policy, Permissions-Policy.
      See `orchestration/SYSTEM_DESIGN.md` for the production architecture
      document that was also created this session.

## Phase 5 — Production Hardening & Architecture (System Design)

These items are documented designs and future production-readiness work
identified during Phase 4. They are not ordered by priority — pick based
on go-live readiness needs.

### Backend lane (Phase 5)

- [x] BE-31: Move auth tokens to httpOnly cookies — refresh token moved from
      sessionStorage to httpOnly `finder_refresh` cookie set by the backend.
      Non-httpOnly `finder_session_hint` cookie enables JS + middleware reads.
      Next.js middleware now enforces auth server-side (redirect to /login).
      silentRefresh() uses session hint as gate; sends empty body (cookie
      sent automatically). logout() clears both cookies via clearAuthCookies().
      See `orchestration/SYSTEM_DESIGN.md §Auth`. (done in f7da017)

- [x] BE-32: Early payment discount on bills — duplicate of BE-30, which already
      implements discount_pct + discount_date + discount_applied_cents on bills
      with automatic application on payBill(). (done via BE-30 in af7d7a7)

- [x] BE-33: Webhook delivery system — persist `webhook_subscriptions` per
      tenant (event type, target URL, signing secret); on EventBus publish,
      enqueue a delivery job (BullMQ or pg-cron), POST to the URL with
      HMAC-SHA256 signature, retry on failure (exponential backoff × 5),
      log results in `webhook_deliveries`. Owner-only management endpoints.
      See `orchestration/SYSTEM_DESIGN.md §Webhooks`. (done in c1b8816)

- [ ] BE-34: Background job queue — introduce BullMQ (Redis-backed) for
      async work: dunning sweep, Core-Mark ETL sync, report pre-cache,
      webhook delivery, scheduled report emails. Add a `/api/v1/jobs` status
      endpoint (owner). Replaces the current synchronous sweep approach.
      See `orchestration/SYSTEM_DESIGN.md §Jobs`.

### Frontend lane (Phase 5)

- [ ] FE-29: Offline-first POS terminal — implement Service Worker + IndexedDB
      cache for the terminal page. Cache product catalog, pending orders queue
      (drain when online), and last-used payment modes. Show offline indicator
      in the EnterpriseShell header. See `orchestration/SYSTEM_DESIGN.md §Offline`.

- [ ] FE-30: Real-time dashboard updates — replace polling with SSE subscription
      (`GET /api/v1/stream`) on the Dashboard and Terminal pages. Show live
      order count, low-stock alerts, and payment notifications without manual
      reload. See `orchestration/SYSTEM_DESIGN.md §Realtime`.

- [ ] FE-31: Customer-facing receipt / display — second-screen support for a
      customer display (customer pole display or tablet). Shows cart items,
      subtotal, discount, tax, and total in real-time as items are added.
      Web-based (iframe or separate route `/display`) driven by BroadcastChannel.
      See `orchestration/SYSTEM_DESIGN.md §Hardware`.

---

## PROD — Production-Grade Gaps (audit 2026-06-22)

Findings from a full production readiness audit. Items marked CRITICAL were
fixed immediately in acc98ec. Remaining items below require dedicated sprints.

### Fixed in acc98ec (2026-06-22)
- [x] PROD-1: Catalog PATCH/DELETE missing requireRole("manager") — any cashier could edit products
- [x] PROD-2: DB transactions had no statement_timeout — runaway tx could exhaust pool
- [x] PROD-3: X-Forwarded-For spoofing in rate limiter — attacker could bypass per-IP limits
- [x] PROD-4: No updated_at trigger — application layer could silently omit timestamp updates
- [x] PROD-5: console.error leaking stack traces in browser in production error pages
- [x] PROD-6: No post-deploy smoke test — silent deployment failures possible
- [x] PROD-7: PG_TX_TIMEOUT_MS and TRUST_PROXY_DEPTH not documented in .env.example

### Completed (HIGH)

- [x] PROD-8: Foreign key constraints missing on commerce tables — `order_lines`, `payments`,
      `inventory`, `purchase_order_lines` reference `orders`/`products` but have no FK
      constraint in the SQL migrations. Orphaned rows silently accumulate on deletes.
      Fix: add `REFERENCES orders(id) ON DELETE CASCADE` (and equivalent) to all
      child tables in `src/modules/orders/index.ts`, `src/modules/payments/index.ts`,
      `src/modules/inventory/index.ts`, `src/modules/purchasing/index.ts`.

- [x] PROD-9: Apply updated_at triggers to all domain module tables — the trigger function
      `set_updated_at()` was created for identity tables (acc98ec) but not yet applied
      to commerce modules (orders, order_lines, payments, products, inventory, customers,
      purchase_orders, invoices, bills, etc.). Each module's `index.ts` needs a trigger
      migration appended.

- [x] PROD-10: No request-ID propagation to database queries — `req.requestId` is generated
      by the request-ID middleware and stored in `res.locals` but never set on the Postgres
      connection (`SET LOCAL app.request_id`). DB logs cannot correlate slow queries to
      HTTP requests. Fix: set the GUC at the start of every transaction in `db.tx()`.

- [x] PROD-11: Vercel cold-start + connection pool — no PgBouncer or connection pooler
      between the serverless functions and Postgres. Each cold-start opens new connections;
      under concurrent cold-starts the pool fills. Fix: use a pooler endpoint (Neon pooled
      connection string, Railway proxy, or standalone PgBouncer). Document in runbook.

### Completed (MEDIUM)

- [x] PROD-12: WAL-G backup stub — `db/backup/backup.sh` WAL archiving is a stub with no
      implementation. No point-in-time recovery (PITR) is possible. RPO = full backup
      interval (5 min). Fix: integrate WAL-G or pgBackRest; set `archive_mode=on` and
      `archive_command` in Postgres config.

- [x] PROD-13: No SLO/SLA definitions and no incident runbook — no defined p99 latency
      target, uptime SLO, RTO/RPO targets, or step-by-step runbook for common incidents
      (pool exhaustion, rate limit false positives, payment idempotency collisions). Fix:
      create `orchestration/RUNBOOK.md` with at least 5 common incident playbooks.

- [x] PROD-14: Pagination not enforced on all list endpoints — several endpoints in
      loyalty, customer-groups, audit-log, and attributes modules return unbounded SELECT
      results. Fix: audit every `GET /*` route; add `LIMIT @limit OFFSET @offset` with
      a max of 500 rows to any endpoint missing it.

- [x] PROD-15: No CORS regression test — CORS origin allowlist is correctly configured in
      production but untested. A future refactor could silently revert to wildcard.
      Fix: add one integration test asserting that an unknown origin is rejected.

### Completed (LOW)

- [x] PROD-16: 49 frontend promise chains without .catch() — pages using `.then(setData)`
      without `.catch(setError)` leave errors silently swallowed. Fix: audit all
      `web/app/(protected)/*/page.tsx` files; add `.catch((e) => setError(e))` or
      convert to async/await with try/catch.

- [x] PROD-17: No test coverage threshold in CI — tests run but coverage is not enforced.
      Fix: add `--coverage --coverageThreshold '{"global":{"lines":60}}'` to the backend
      test step in `.github/workflows/ci.yml` once coverage is measured and baselined.

- [x] PROD-18: Missing test files for 9 high-risk modules — accounting, billing, catalog,
      customers, discounts, fulfillment, giftcards, purchasing, sales have no `.test.ts`
      files. These cover financial data and POS checkout paths. Fix: add one smoke-level
      integration test per module (create + read + error case) as a minimum baseline.

---

## Phase 6 — Implementation Prompt Parity (FinderPOS_Implementation_Prompt.docx)

Gap analysis completed 2026-06-22 against `orchestration/FinderPOS_Implementation_Prompt.docx`.
Items below are features specified in that document that are absent or incomplete in the
current codebase. Ordered by value/dependency within each lane.

> Source doc: 9 modules (Dashboard, Sell/Register, Reporting, Catalog, Inventory,
> Customers, Finance, Setup, Ecommerce), 14 mandatory business rules, full API
> contract, and URL state management spec.

### Backend lane (Phase 6)

- [ ] BE-35: Store Credit payment mode — add `store_credit` as a valid
      `PaymentMethod` in the payments service; deduct from `customers.store_credit_cents`
      atomically inside `capture()`; add `POST /api/v1/customers/:id/store-credit`
      (delta endpoint: positive = add credit, negative = deduct; manager-gated for
      adds; enforce balance ≥ 0). Emit `store_credit.debited` event on checkout.
      Guards: store credit payment cannot exceed customer balance (rule #10).
      See §9 (Customer record > Store Credit tab) and §14 rule #10.

- [ ] BE-36: Register Closures report endpoint — `GET /api/v1/reports/register-closures`
      (list: outlet, register, opened_by, opened_at, closed_at, opening_cash,
      closing_cash, expected_cash, discrepancy, payment breakdown by mode);
      `GET /api/v1/reports/register-closures/:sessionId` (detail: header +
      payment breakdown table + transaction log of invoices in session +
      cash drawer movements in session). Reads from `register_sessions` +
      `cash_drawer_movements` + `payments` tables.
      See §6.2 Register Closures and §6.3 Register Closure Detail View.

- [ ] BE-37: Cash Movement report endpoint — `GET /api/v1/reports/cash-movement`
      (filter by `?registerId=&sessionId=&from=&to=`); reads `cash_drawer_movements`
      table; returns rows with direction (cash_in/cash_out), amount, reason,
      user, timestamp. Aggregates: total_in, total_out, net.
      See §6.2 Cash Movement and §15 POS Transaction → Report Feed Map.

- [ ] BE-38: Purchase/AP report endpoint — `GET /api/v1/reports/purchases`
      (filter by `?vendorId=&productId=&categoryId=&from=&to=`); joins
      `purchase_orders` + `purchase_order_lines` + `suppliers` + `products`;
      returns qty ordered, cost, units received, due amount per vendor/product/
      category pivot. See §6.2 Reporting sub-pages (Purchase Report).

- [ ] BE-39: Customer-specific product price overrides — new table
      `customer_product_prices (id, tenant_id, customer_id, product_id, price_cents,
      created_at, updated_at)`. Endpoints: `GET/POST/DELETE
      /api/v1/customers/:id/product-prices`. Price resolution in orders/sales
      must check this table FIRST (highest priority, before tier pricing).
      See §5.2 Product Data Resolution at POS (rule 1).

- [ ] BE-40: Employee time clock — new table `time_entries (id, tenant_id,
      employee_id, clock_in BIGINT, clock_out BIGINT, break_minutes INTEGER,
      created_at)`. Endpoints: `POST /api/v1/workforce/clock-in`, `POST
      /api/v1/workforce/clock-out` (sets clock_out, calculates break if
      re-clocked within shift). Report endpoint: `GET /api/v1/reports/time-cards`
      (filter by user/date; returns total_hours per employee + detail rows).
      See §6.2 User/Time Cards sub-page.

### Frontend lane (Phase 6)

- [ ] FE-41: Dashboard KPI alignment + outlet filter — replace current 8 KPI
      tiles with the 8 spec KPIs: Revenue, Sale Count, Gross Profit (revenue −
      cost), Customer Count (DISTINCT customer_id), Avg Sale Value, Avg Items/Sale,
      Discounted Amount, Discounted %. Each tile: current value, delta vs. prior
      period (absolute + % + directional arrow), sparkline (last 8 data points),
      "View report" deep-link. Add outlet dropdown filter bar (All Outlets +
      individual from `/api/v1/outlets`) that scopes all tile queries.
      See §4.1 KPI Tile Grid and §4.3 Dashboard Filter Bar.

- [ ] FE-42: Register Closures report page (`/reports/register-closures`) —
      list view: outlet, register, opened/closed times, opening float, closing
      float, discrepancy. Click row → detail view: header, payment breakdown
      table (cash/card/gift card/etc.), transaction log (invoice rows linking
      to `/sell/sale/:id`), cash movement events in session.
      Consumes BE-36. See §6.2 and §6.3.

- [ ] FE-43: Cash Movement report page (`/reports/cash-movement`) — table of
      cash in/out/petty cash events with register, user, reason, amount;
      aggregate totals at top. Filter by register and date range.
      Consumes BE-37. See §6.2 Cash Movement.

- [ ] FE-44: Purchase/AP report page (`/reports/purchases`) — vendor × product
      pivot with qty ordered, cost, received, due amount; "Export CSV" action.
      Consumes BE-38. See §6.2 Purchase Report.

- [ ] FE-45: Store Credit UI — (a) Customer detail: add "Store Credit" tab
      showing balance, add/deduct form (manager: add; cashier: deduct only),
      transaction history. (b) TenderScreen: add "Store Credit" payment option
      that shows balance, enforces balance ≥ payment amount. Consumes BE-35.
      See §5.4 Checkout payment modes and §9.2 Customer > Store Credit tab.

- [ ] FE-46: Lot code selection at POS — when a product with lot-tracked
      inventory is added to the cart, show a lot-picker dialog
      (`GET /api/v1/inventory/:productId/lots`) displaying lot code, expiry date,
      and available qty. Pre-select the earliest-expiry lot (FEFO). Attach
      `lotCode` to the cart line item sent to `POST /api/v1/orders`.
      See §5.3 Inventory Checks at Scan/Add (lot-tracked items).

- [ ] FE-47: Price Book page (`/catalog/price-book`) — grid of outlet-specific
      price overrides: product × outlet matrix. Inline-editable cells. Bulk
      import via CSV. Uses `POST/PATCH /api/v1/catalog/:id` (existing) with
      outlet-scoped price columns; or a new `product_outlet_prices` table if
      outlet-specific pricing is not yet in the schema.
      See §7.1 Catalog sub-pages > Price Book.

- [ ] FE-48: URL state management for report filters — all `/reports/*` pages
      encode their active filters as `?definition=<base64(JSON)>` so views
      are bookmarkable and deep-linkable. JSON shape: `{ metric, dimension,
      constraints[], granularity, periodType, periodCount, startDate, endDate,
      comparison, order, reportView, optionalAggregates }`.
      Dashboard Day/Week/Month toggle writes `granularity` to the URL and to
      global context (read as default when navigating to any report).
      See §6.1 Shared Report Filter Architecture and §16 URL State Management.

- [ ] FE-49: Time Cards report page (`/reports/time-cards`) — employee list
      with total hours per period; expandable to clock-in/out log per employee.
      Consumes BE-40. See §6.2 User/Time Cards.

- [ ] FE-50: Customer-specific price UI — add "Product Prices" tab on
      `/customers/[id]` listing per-product price overrides with add/edit/delete.
      At POS, when a customer is selected, show a "custom price" badge on
      products with overrides and apply the override in the cart.
      Consumes BE-39. See §9.2 Customer > Product Price tab and §5.2 rule 1.

---

## Run log (most recent first)

- 2026-06-14 human/assistant PROD-1 -> 216fc4c: merged backend-cycle3 into
  master, resolving 2 conflicts; backend+frontend typecheck clean, frontend
  tests (83) pass.
- 2026-06-14 frontend FE-1 -> 7d59820: added Purchasing/Receiving UI + margin
  column on inventory grid.
- 2026-06-14 frontend FE-2 -> a391420: added AP/AR aging surface (AR/AP
  cards, aging summaries, pay actions) to accounting page.
- 2026-06-14 backend BE-6 -> e04283b: added category tree + product detail
  fields to catalog module, with CRUD/assignment endpoints.
- 2026-06-14 backend BE-8 -> 038eeed: added master/child product variants
  (parent_product_id/variant_label, assign endpoint, excludeMasters,
  orders guard against selling a master row).
- 2026-06-14 backend BE-7 -> 904d3b6: added bulk-update, CSV import/export,
  and bulk EAN-13 barcode generation to the catalog module.

- 2026-06-16 frontend FE-7/FE-8/FE-9: fully functional product catalog UI —
  Catalog tab on /inventory (filter, bulk-select, bulk-status, CSV export,
  New product button); /inventory/products/[id] detail page (General,
  Categories, Pricing, Variants tabs); /inventory/products/new create form.

- 2026-06-18 human/assistant S4-CHARTS: revenue-trend endpoint + SVG LineChart/BarChart components + dashboard revenue trend + hourly bar chart cards.
- 2026-06-18 human/assistant S4-LOYALTY: loyalty_tier_rules table + CRUD + auto-upgrade in awardPoints + Loyalty Tiers section in /settings.
- 2026-06-18 human/assistant ROADMAP: marked BE-2..18, FE-3..5, FE-10, FE-13 as done (all were implemented in prior sessions).
- 2026-06-20 frontend FE-6 -> e85f0a9: mock audit complete; flipped /imports/products to live /catalog/import-csv; queued BE-19/20/21 for mock-only endpoints.
- 2026-06-20 backend BE-19 -> 00c515a: notifications module; GET/PATCH/POST endpoints; EventBus low_stock + invoice.overdue listeners.
- 2026-06-20 backend BE-20 -> 15f4f4a: audit-log read module; GET /api/v1/audit-log with actor/resource_type/action filters; JOIN users for actor fields.
- 2026-06-20 frontend FE-14 -> ceceff3: compliance flags on catalog/[id]; state enforcement on terminal; flavored vape restricted CA/MA/NJ/RI/IL.

- 2026-06-20 frontend FE-15 -> 6de146e: CardReaderScreen 4-state animation + NumpadModal qty editor wired into TenderScreen + CartPanel.
- 2026-06-20 backend BE-22 -> 41cd91e: compliance columns (tobacco_type/flavored/menthol/msa_reportable/restricted_states) + PATCH /api/v1/catalog/:id/compliance (manager-gated).
- 2026-06-20 backend PERF-1 -> d7c40dc: cursor pagination on inventory, invoices, sales-orders (replaces OFFSET/LIMIT 500).
- 2026-06-20 backend BE-21 -> 2b681b7: loyalty module; tiers/members/rewards CRUD; auto-tier-upgrade on points adjust; SSE loyalty.tier_upgraded.

- 2026-06-20 backend DB-1 -> 15a1228: RLS migration (DO block enables tenant_isolation policy on all tenant_id tables); DB.withTenant(tenantId) helper wraps queries in mini-tx with set_config for safe pool use.
- 2026-06-20 backend DB-2 -> c5fe02c: ioredis client + atomic Lua INCR/PEXPIRE in both rate limiters; REDIS_URL absent = in-memory fallback; Redis error = fail open.
- 2026-06-21 frontend FE-16 -> 06e8e22: Service Orders page — repair ticket list, stat cards, create modal, status transitions, detail modal; 5 MSW handlers.
- 2026-06-21 fullstack PRODUCT-DATA -> b6dc1f8: store locations (aisle/shelf/bin map + bulk assign), product expiry/batch tracking, customer invoicing (UPC scan builder, INV-sequence, lifecycle); 3 new backend modules, 3 new frontend pages, 4 nav entries.

- 2026-06-21 human/assistant fix(ci): VERCEL_SCOPE optional via shell param expansion -> 9c726f0
- 2026-06-21 frontend FE-24 -> d1cf2a0: enhanced reports — date-range picker (7d/30d/90d/custom), sales-by-product top-20 sortable table, margin-by-category bar chart, inventory valuation with potential-margin stat, low-stock SKUs; CSV export per section; 2 new mock endpoints + types.
- 2026-06-21 frontend FE-25 -> 8a4cc57: receipt templates section in Settings — per-outlet form (header/footer/contact/return policy + 3 toggles), live thermal receipt preview panel, GET/POST/PATCH mock handlers.

- 2026-06-21 human/assistant SEC-1 -> 5af7a24: full security audit; 6 fixes (customer privilege escalation, receipts/quotation guards, metrics token, logout body injection, CSP headers). Phase 5 system design items added to roadmap; SYSTEM_DESIGN.md created.
- 2026-06-21 backend BE-30 -> af7d7a7: early payment discount on bills — discount_pct/discount_date/discount_applied_cents columns; payBill applies discount on first payment before deadline; effectiveTotal guards overpayment; mocks seeded.
- 2026-06-22 fullstack BE-31 -> f7da017: httpOnly cookie auth — finder_refresh (httpOnly) + finder_session_hint (non-httpOnly) set on login/refresh; middleware enforces auth; silentRefresh uses hint cookie; logout clears cookies.

- 2026-06-22 human/assistant BE-33 -> c1b8816: webhook delivery — exponential backoff retries (×5), owner guards, toggle endpoint, attempt_count + last_response_body delivery log.
- 2026-06-22 human/assistant INF-7 -> ed732b4: .env.example pool sizing docs + redis.ts structured logging.

_Agents append a one-line entry here each run: date, agent, item, commit._
