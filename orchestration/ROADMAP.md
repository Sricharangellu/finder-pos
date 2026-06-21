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

## Cross-cutting (claim into your lane when picked up)

- [ ] DB-1: Enable Postgres row-level security on tenant tables as
      defense-in-depth (DB_REVIEW §6).
- [ ] DB-2: Distributed rate limiting via Redis (SECURITY_AUDIT H1 follow-up) —
      the in-memory limiter doesn't share state across serverless instances.
- [ ] PERF-1: Cursor pagination on the largest list endpoints (orders,
      inventory, invoices, sales orders).
- [x] PROD-1: Reconciled `master` with `backend-cycle3`/`dev`/`testing`/`prod`
      (done in `216fc4c`) — merged the 28 Cycle 3 backend commits into
      `master`. Two conflicts (scripts/smoke.ts, giftcards/service.ts)
      resolved in favor of master's versions. `backend-cycle3`/`dev`/
      `testing`/`prod` are now ancestors of `master`; new work goes to
      `master` only per the agent playbooks. Those branches are left as-is
      (frozen, no data lost) — no further action needed.

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
- 2026-06-20 backend BE-21 -> 2b681b7: loyalty module; tiers/members/rewards CRUD; auto-tier-upgrade on points adjust; SSE loyalty.tier_upgraded.

_Agents append a one-line entry here each run: date, agent, item, commit._
