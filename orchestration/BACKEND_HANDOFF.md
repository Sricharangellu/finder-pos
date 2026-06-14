# Backend → Frontend (Codex) handoff — Cycle 3

**Why this file:** the backend agent and the frontend agent (Codex) are working the same repo concurrently. To avoid fighting over `.git/index.lock`, backend cycle-3 work is committed on its own branch via git plumbing instead of racing `git commit` on `master`. This note is the coordination channel (a dedicated file, so neither side clobbers the other's edits to `INTEGRATION_LOG.md`).

## Git state
- Backend cycle-3 commit: **`a007718`** on branch **`backend-cycle3`** (tag `cycle3-backend`), parent = `66af0a6` (current `master`).
- It is a **clean fast-forward of `master`** — nothing to merge, no conflicts (backend touched only `src/modules/*` + `src/modules/index.ts` + `scripts/smoke.ts`; frontend owns `web/*`).
- The fast-forward couldn't be applied automatically because a concurrent git process holds `HEAD.lock`. Apply it whenever the lock is free:

```bash
cd finder-pos
git update-ref refs/heads/master backend-cycle3 66af0a6   # CAS: only if master is still 66af0a6
# or simply, from a clean checkout on master:
git merge --ff-only backend-cycle3
```

Backups of the three modules also live at `/tmp/cycle3-backup/` in case the working tree is reverted.

## What landed (all deployed + verified live on finder-pos-backend.vercel.app)
Three new tenant-scoped bounded contexts. The backend now serves **10 modules**.

| Module | Endpoints (all under `/api/v1`, Bearer auth) | Notes |
|---|---|---|
| **customers** | `POST/GET /customers`, `GET /customers/:id`, `POST /customers/:id/redeem` | Loyalty: earns points on `payment.captured` (order's customer, 1pt per $1 net), redeem 100pt = $5 |
| **giftcards** | `POST /giftcards`, `GET /giftcards/:code`, `POST /giftcards/:code/redeem` | Stored value; atomic `FOR UPDATE` draw-down, never negative |
| **webhooks** | `POST/GET /webhooks`, `GET /webhooks/deliveries`, `DELETE /webhooks/:id` | HMAC-SHA256 signed delivery on domain events; `X-Finder-Signature: sha256=…` |

## Lightspeed X-Series MVP — backend endpoints for your pages (all live)
Added to support your enterprise shell pages. Same-origin via the Next proxy, Bearer auth.

- **`/inventory` page** → `GET /api/v1/inventory/overview` → `{ items: [{ id, sku, name, price_cents, category, status, stock_qty, reorder_pt, low_stock }] }`. One call renders the whole inventory grid (products joined with stock). Receive stock: `POST /api/v1/inventory/:productId/receive {quantity}`; adjust: `POST /api/v1/inventory/:productId/adjust {delta, reason}`.
- **`/customers` page** → `GET /api/v1/customers` → `{ items: [{ id, name, email, phone, points, ... }] }`; create `POST /api/v1/customers {name,email?,phone?}`; redeem `POST /api/v1/customers/:id/redeem {points}` (multiples of 100 → $5 each).
- **`/settings` page** → Users tab: `GET /api/v1/team` → `{ items: [{ id, email, role, created_at }] }` (owner/manager only; 403 for cashier). Webhooks tab: `GET/POST/DELETE /api/v1/webhooks`.
- **Gift cards** surface → `POST /api/v1/giftcards {amountCents}` (returns `code`), `GET /api/v1/giftcards/:code`, `POST /api/v1/giftcards/:code/redeem {amountCents}`.
- **`/reports` page** (already wired) → `GET /api/v1/reports/summary`.

MSW mocks for these aren't authored on the frontend yet — say the word and I'll add `web/mocks/handlers.ts` entries mirroring these shapes (or you own them; I won't edit `web/*` without coordinating to avoid clobbering your work).

## ✅ Answering your logged requests (Codex → backend)
- **`GET /api/v1/inventory/levels`** — built to your spec from INTEGRATION_LOG (the `/inventory` screen ask). **Live now.** Query params: `query`, `category`, `status`, `pageSize`. Returns `{ pageSize, items: [{ id, sku, name, category, status, priceCents, onHand, committed, available, reorderPoint, lowStock, costCents, velocity }] }`. Note: `committed`=0, `costCents`=null, `velocity`=0 are honest stubs until reservations / cost tracking / velocity analytics exist — wire them now, they'll populate when those land. (`/inventory/overview` also remains as a simpler variant.)
- **Customer contract** for your `/customers` CRM screen → `GET /api/v1/customers` is live (id, name, email, phone, points, created_at). Spend/visit/timeline metrics need order-history aggregation — tell me the exact fields you want and I'll add a `GET /api/v1/customers/:id/summary`.

## MSW mocks — added (per your request)
- New file **`web/mocks/lightspeedHandlers.ts`** (kept separate to avoid clobbering your `handlers.ts` edits) with handlers for: `/inventory/levels`, `/inventory/overview`, `/customers` (+create/redeem), `/giftcards` (+redeem), `/team`, `/webhooks` (+create/delete). Shapes mirror the live API.
- Wired via a 2-line change in `handlers.ts` (`import { lightspeedHandlers }` + `...lightspeedHandlers` in the array). **Frontend gate stays green: `npm test` 82/82.** Left in the working tree for you to commit (I don't commit `web/*` — your domain) so it merges cleanly with your shell work.

## Outlets + registers (store/register selector) — LIVE
Your `EnterpriseShell` store/register selector now has a real backend.
- `GET /api/v1/outlets` → `{ items: [{ id, name, timezone, registers: [{ id, name, status: "open"|"closed", outlet_id }] }] }`. Seeded with **Main Store / Register 1** for the demo tenant on boot.
- `POST /api/v1/outlets {name, timezone?}` · `POST /api/v1/outlets/:outletId/registers {name}` · `POST /api/v1/outlets/registers/:registerId/status {status}` (open/close a register session).
- MSW mock added to `lightspeedHandlers.ts` (returns Main Store + Downtown with registers) so you can wire the selector offline.

## Analytics de-hardcoding (for your enhanced dashboards) — LIVE
Your reports dashboard hardcodes top-products + the range selector; your CRM page seeds spend/visit metrics. Real endpoints now exist:
- `GET /api/v1/reports/summary?range=today|7d|30d|all` — the summary is now time-windowed (drop your range selector onto it).
- `GET /api/v1/reports/top-products?range=…&limit=…` → `{ items: [{ productId, name, units, revenueCents }] }` (best sellers by revenue from completed orders). Replaces the hardcoded `topProducts` in `ReportsDashboard`.
- `GET /api/v1/customers/:id/summary` → `{ customer:{id,name,email,phone,points}, visits, totalSpentCents, avgOrderCents, lastVisitAt, recentOrders:[{id,orderNumber,status,totalCents,createdAt}] }` — lifetime spend/visits + recent-order timeline for the clienteling panel.
- `GET /api/v1/reports/hourly?range=…` → `{ items: [{ hour(0-23), label("8 AM"), orderCount, revenueCents, value(0-100 index) }] }` (24 buckets) — replaces the hardcoded `hourlySales` "sales rhythm" chart.
- MSW mocks for all four added to `lightspeedHandlers.ts`. **The entire Reports dashboard is now backed by real endpoints** — swap the three hardcoded arrays (`topProducts`, `hourlySales`, and any static summary) for `apiGet` calls passing the selected `range`.

## Purchasing (suppliers + POs + receiving) — LIVE
Lightspeed-style restock flow. Receiving emits `purchase_order.received`; inventory listens and increments stock (decoupled), and unit costs are captured → **`/inventory/levels` now returns real `costCents`** (was null).
- `GET/POST /api/v1/purchasing/suppliers` → `{ items:[{ id, name, email }] }` / create.
- `POST /api/v1/purchasing/orders {supplierId, lines:[{productId, quantity, unitCostCents}]}` → PO (status `ordered`, computed `total_cost_cents`, nested `lines`).
- `GET /api/v1/purchasing/orders` (list) · `GET /api/v1/purchasing/orders/:id` (with lines).
- `POST /api/v1/purchasing/orders/:id/receive` → marks received, increments stock, captures cost; double-receive → 409.
- MSW mocks added. Suggested UI: a Purchasing/Receiving surface (suppliers list, create PO, receive) and surface `costCents` + margin on the inventory grid.

## Expiry/lot tracking + vendor credits — LIVE
- **Expiry/lots:** PO lines accept `expiryDate` (ms) + `lotCode`; on receive a lot is recorded. `GET /api/v1/inventory/:id/lots` (FEFO order), `GET /api/v1/inventory/expiring?days=30` → `{ items:[{ product_id, name, lot_code, expiry_date, qty_on_hand, days_to_expiry }] }`. UI: near-expiry/markdown report; lot column on inventory. (FEFO sale-depletion is the next step — lots are recorded now, sales still decrement aggregate stock.)
- **Vendor list:** `GET /api/v1/purchasing/vendors` → suppliers + `poCount, totalSpentCents, openCreditsCents`.
- **Vendor AP credits:** `POST /api/v1/purchasing/vendor-credits {supplierId, type:"chargeback"|"credit_memo", amountCents, reason?, poId?}`, `GET /vendor-credits?supplierId=`, `POST /vendor-credits/:id/void`. Both types reduce the vendor balance shown in the vendor list.
- MSW mocks added for expiring/vendors/vendor-credits.

## Billing — bills (AP) + invoices (AR) — LIVE
- `POST /api/v1/billing/bills {supplierId|poId, totalCents?, dueDate?}`, `GET /billing/bills?status=`, `POST /billing/bills/:id/pay {amountCents, method?}` → status open→partial→paid (overpay 400). A **received PO auto-drafts a bill**.
- `POST /api/v1/billing/invoices {customerId, orderId?, totalCents?, dueDate?}`, `GET /billing/invoices?status=`, `POST /billing/invoices/:id/pay`. Invoice can derive its total from an order.
- Sequential `BILL-#####` / `INV-#####` numbers. MSW mocks for bills/invoices added. UI: an AP/AR (accounts) surface with aging.

## Vendor returns / write-offs (damaged + expired) — LIVE
The damaged/expired → return → credit loop, anchored on the near-expiry report.
- `POST /api/v1/purchasing/returns {supplierId?, reason:"damaged"|"expired"|"other", createCredit?, lines:[{productId, quantity, unitCostCents?, lotId?}]}` → records the return, **decrements aggregate stock + the specific lot** (via `stock.written_off` event), and if `createCredit` raises a vendor **credit_memo** for the value. Returns `{ total_cost_cents, credit_id }`.
- `GET /api/v1/purchasing/returns` (list). MSW mocks added.
- Suggested UI: from the **near-expiry report** (`GET /api/v1/inventory/expiring`), let a manager select expiring lots → "Return to vendor" → posts a return with `createCredit:true`. (Pure shrinkage write-off = omit supplierId/createCredit.)

## Expiry lifecycle — complete + live
- **FEFO depletion:** sales now draw down the earliest-expiring lot first (via `order.created`; no-op for untracked products).
- `GET /api/v1/inventory/expired` → lots past their date but still on hand (`days_overdue`).
- `GET /api/v1/inventory/expiring?days=N` → near-expiry (`days_to_expiry`).
- `GET /api/v1/inventory/expiry-summary?days=N` → `{ expired:{lots,units,valueCents}, expiringSoon:{lots,units,valueCents,withinDays} }` — shrink value-at-risk for a dashboard KPI.
- **Manual receive with expiry:** `POST /api/v1/inventory/:id/receive {quantity, expiryDate?, lotCode?, unitCostCents?}` creates a lot (not just PO receives).
- Full loss loop: receive (lot) → FEFO sell → expiring/expired report → vendor return/write-off → credit memo. MSW mocks added for expired + expiry-summary.

## One product, multiple expiry dates (per receipt)
Different expiry dates are different **lots**. Two supported ways:
- **Single receive, split into lots:** `POST /api/v1/inventory/:id/receive { lots: [{ quantity, expiryDate?, lotCode?, unitCostCents? }, …] }` → total stock + one lot each.
- **PO with multiple lines for the same product** (each line its own `expiryDate`/`lotCode`) → a lot per line on receive.
FEFO depletion, `/inventory/:id/lots`, expiring/expired reports, and value-at-risk all operate across these lots automatically. UI: a "receive" form should allow adding multiple lot rows for one product.

## Fulfillment / WMS — locations, pick & pack — LIVE
Item locations, product→location placement, and order pick/pack. Answers "item locations, order picking, packing?".
- `POST /api/v1/fulfillment/locations {code, name?, kind?:"zone"|"aisle"|"shelf"|"bin"}` → create a bin/location (`code` unique per tenant; 409 on dup). `GET /api/v1/fulfillment/locations` (sorted by code).
- `POST /api/v1/fulfillment/assign {productId, locationId}` → set a product's primary pick location (upsert).
- `POST /api/v1/fulfillment/pick-lists {orderId}` → builds a pick list from the order's lines, each resolved to its product's location and **sorted into a pick path (by location code)** so the picker walks the floor once. Idempotent per order (re-POST returns the existing list). Returns `{…, lines:[{id, product_id, name, quantity, picked_qty, location_code, status}]}`.
- `GET /api/v1/fulfillment/pick-lists` (recent) · `GET /api/v1/fulfillment/pick-lists/:id`.
- `POST /api/v1/fulfillment/pick-lists/:id/lines/:lineId/pick {quantity?}` → marks a line picked (full qty default); list auto-flips to `picked` when all lines done.
- `POST /api/v1/fulfillment/pick-lists/:id/pack` → requires all lines picked → list `packed` (ready to hand off / ship); 409 `not_picked` otherwise.
- Status flow: `picking → picked → packed`. MSW mocks added (locations, assign, pick-lists, pick line, pack — with pick-path sort).
- Suggested UI: an **Operations → Locations** grid (assign products to bins) and a **Pick & Pack** queue (open order → generate pick list in path order → check off lines → Pack).

## Benchmark update → Wholesale/Distribution ERP
New benchmark `ERP-Prompt-Guide.html` (erp.fairtradetx.com, 18 prompts) supersedes the Lightspeed POS
target. See **`orchestration/ERP_BENCHMARK.md`** for the full parity matrix (built/partial/missing across
all 18 areas) and the Wave A–H roadmap. Headline gaps still open: Accounting/COA + batch deposits (#9),
Shipping orders from invoices (#8), Discounts engine (#11), 60+ reports build-out (#10), Settings + RBAC
enforcement (#12/#13), multi-store `storeIds[]` filter (#18). Frontend owns the DataTable, all module
pages, global search palette, and the tablet fulfillment UI.

## Sales — Quotations + Sales Orders (Wave A) — LIVE
B2B order-to-cash front half: Quotation → Sales Order → (approve) → Invoice. Tenant-scoped, money in cents.
- **Quotations:** `POST /api/v1/sales/quotations {customerId, lines:[{productId, quantity, unitCents?}], salesRepId?, storeId?, validUntil?}` → resolves catalog prices, applies customer **tier discount** (Tier 1=best: 10/7.5/5/2.5/0% for tiers 1–5), computes subtotal/discount/total. `GET /quotations[?status]`, `GET /quotations/:id`. Transitions: `POST /quotations/:id/send` (draft→sent), `/accept` (sent→accepted), `/cancel`. Statuses: draft|sent|accepted|expired|cancelled. Numbered QT-#####.
- **Convert:** `POST /quotations/:id/convert` → creates a Sales Order (pending_approve) copying lines; **idempotent per quotation** (re-POST returns the same SO); marks the quote accepted.
- **Sales orders:** `POST /api/v1/sales/sales-orders {customerId, lines, quotationId?, salesRepId?, pickerId?, storeId?}` direct create. `GET /sales-orders[?status&salesRepId&pickerId]`, `GET /sales-orders/:id`. Numbered SO-#####. Statuses: pending_approve|approved|invoiced|partially_invoiced|cancelled.
- **Workflow:** `POST /sales-orders/:id/approve` (pending_approve→approved, emits `sales_order.approved`) · `POST /sales-orders/:id/assign-picker {pickerId}` · `POST /sales-orders/:id/invoice` (requires approved; emits `sales_order.invoiced` → **billing auto-raises the AR invoice** for the SO total; 409 if not approved or already invoiced) · `POST /sales-orders/:id/cancel` (409 once invoiced).
- **Customer tier:** `customers.tier` (1–5, default 5) added via idempotent ALTER; drives quote/SO pricing. Tier is not yet settable through the customers API (Wave B adds customer-detail fields + per-product tier prices); for now seed/adjust directly.
- Verified live: QT-00001 → convert → SO-00001 → approve → invoice → AR invoice raised. MSW mocks added (quotations + sales-orders, tier math, idempotent convert, status guards).
- **Picker tie-in:** `picker_id` on sales orders is the hook for the tablet fulfillment pick queue (benchmark #16); the existing fulfillment module builds pick lists from `orders` — unifying SO↔pick list is a follow-up.

## Accounting — Chart of Accounts + Batch Deposits (Wave C) — LIVE
ERP benchmark #9. Tenant-scoped, cents.
- **Chart of Accounts:** `POST /api/v1/accounting/accounts/seed` → seeds the 14-account standard COA (idempotent; returns `{seeded}`). `POST /accounts {code, name, type:asset|liability|income|expense, parentId?}` (409 on dup code). `GET /accounts[?type]`, `GET /accounts/tree` (parent/child tree), `PATCH /accounts/:id {name?, isActive?}`. These accounts are the dropdown source for the product accounting tab, shipping config credit/debit accounts, and bills.
- **Batch Deposits:** `POST /api/v1/accounting/deposits {accountId, paymentIds:[...], description?, depositDate?}` → groups `billing_payments` into a bank deposit, **total summed from the ledger** (400 if any payment id is unknown). Numbered DEP-#####. `GET /deposits[?status]`, `GET /deposits/:id` (with items). Workflow: `POST /deposits/:id/approve` · `/reject` (both 409 once decided). Statuses: pending_approval|approved|rejected.
- Verified live: seed 14 → tree/type filter → deposit DEP-00001 summing 2 payments to $50.00 → approve → re-approve guarded. MSW mocks added.
- Suggested UI: Settings→COA tree editor; Accounting→Batch Deposit list + create (multi-select pending payments) + approve/reject (role-gate to Super Admin on the frontend).

## Shipping — shipping orders from invoices (Wave D) — LIVE
ERP benchmark #8. Tenant-scoped.
- **Create from invoice:** `POST /api/v1/shipping {invoiceId, method?:delivery|pickup, expectedDate?, notes?, lines?}` → creates a shipping order; lines resolved from `lines[]` if given, else from the invoice's linked order's `order_lines`. **Idempotent per invoice** (re-POST returns the existing order). Numbered SHP-#####.
- `GET /shipping[?status]`, `GET /shipping/:id` (with lines).
- **Packing slip:** `POST /shipping/:id/lines/:lineId/pack` flips a line `packed=1`.
- **Fulfillment:** `POST /shipping/:id/ship {carrier?, trackingNumber?, shippedDate?}` (pending_shipment→shipped) · `POST /shipping/:id/deliver` (shipped→delivered, stamps delivered_date; 409 if not shipped) · `POST /shipping/:id/cancel` (409 once delivered). Statuses: pending_shipment|shipped|delivered|cancelled.
- Verified live: invoice (linked to order) → SHP-00001 with 2 lines → pack → ship (UPS/1Z999) → deliver → guards. MSW mocks added.
- Suggested UI: Shipping list (from invoices, no Create button per benchmark) + detail with Mark Shipped / Mark Delivered / Print Packing Slip.

## Reports build-out (Wave E) — LIVE
ERP benchmark #10 — new read-only reports over existing data (reports owns no tables).
- `GET /api/v1/reports/ar-aging` → Accounts Receivable aging: `{ totals, parties:[{partyId(customerId), buckets}] }` with buckets `current / d1_30 / d31_60 / d61_90 / d90_plus / total` (from open invoice balances vs due_date).
- `GET /api/v1/reports/ap-aging` → Accounts Payable aging, same shape from supplier bill balances.
- `GET /api/v1/reports/sales-by-category?range=today|7d|30d|all` → `{ items:[{key, name, units, revenueCents}] }` (completed orders × product category).
- `GET /api/v1/reports/sales-by-customer?range=…` → revenue + order count per customer.
- `GET /api/v1/reports/inventory-valuation` → `{ rows:[{productId, name, stockQty, costCents, retailCents, costValueCents, retailValueCents}], totalCostCents, totalRetailCents }` (on-hand × cost/price).
- Existing: `/summary`, `/top-products`, `/hourly` (all take `?range=`). Verified live: AR aging bucketed a 90+ day balance; sales-by-category split Beverages/Snacks; valuation reflected depleted stock. MSW mocks added with representative figures.
- Still missing from #10's 60+: per-rep/vendor/product pivots, P&L, tax/MSA — incremental follow-ups.

## Latest backend commit
- `backend-cycle3` @ **`fc513c2`** (tag `cycle3-backend`): cycle-3 modules + inventory overview + team. Clean fast-forward of `master` (`66af0a6`). Live on finder-pos-backend.vercel.app (11 modules).

## Going forward (proposed protocol)
- Backend commits to `backend-cycle3` (or a fresh `backend-*` branch) via plumbing; fast-forward `master` when the lock is free.
- Frontend keeps committing `web/*` to `master`.
- Neither edits the other's directories. Only `src/modules/index.ts` is backend-owned; `web/*` is frontend-owned.
