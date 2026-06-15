# Finder — Living Roadmap (backlog for scheduled dev agents)

**Product framing:** Finder is a standalone POS/business-management platform.
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

Source material: `ERP_BENCHMARK.md` (parity matrix), `BACKEND_HANDOFF.md`
("Suggested UI" notes per module), `CONTINUE_IN_ANTIGRAVITY.md` §6,
`SECURITY_AUDIT.md` recommended-next, `DB_REVIEW.md` §6,
`CATALOG_PRODUCT_FINDER.md` (catalog/product-detail benchmark notes).

---

## Backend lane (src/, db/, contracts/, scripts/)

- [ ] BE-1: Finish the RBAC matrix — apply `requireRole("manager")` from
      `src/gateway/auth.ts` to remaining sensitive mutations: purchasing
      vendor-credits/returns/PO-receive, discounts create/status, accounting
      deposit create, sales-order cancel/void, giftcard/customer redeem
      overrides. List each route touched in the commit message.
- [ ] BE-2: Refresh-token rotation/revocation — make refresh tokens single-use
      (rotate on `/api/identity/refresh`, invalidate the old one), add a
      revocation check on logout. Add tests.
- [ ] BE-3: Reports — add `sales-by-rep` and `sales-by-vendor` pivots plus a
      basic P&L (`GET /api/v1/reports/pnl?range=`) using existing
      income/expense accounts from the COA.
- [ ] BE-4: Multi-store filter — add `storeIds[]` to the JWT (from `outlets`)
      and accept `?storeIds=` on the major list endpoints (orders, inventory,
      sales-orders, invoices) filtering by `store_id`.
- [ ] BE-5: Per-customer discount usage limit enforcement at redeem time
      (SECURITY_AUDIT M2 follow-up #4) — `discounts.evaluate`/`redeem` should
      check `per_customer_limit` against a usage ledger keyed by customer.
- [x] BE-6: Catalog — category tree (`categories` table with `parent_id` +
      `product_categories` join) and product detail fields (description,
      brand, dimensions/weight, image_url, preferred_vendor_id/vendor_upc,
      min/max qty to sell + qty increment). See `CATALOG_PRODUCT_FINDER.md`.
      (done in e04283b)
- [ ] BE-7: Catalog — bulk operations: `POST /api/v1/catalog/bulk-update`
      (field updates for selected SKUs, manager-gated), CSV
      `import`/`export`, and bulk barcode generation. See
      `CATALOG_PRODUCT_FINDER.md`.
- [x] BE-8: Catalog — master/child product variants: `parent_product_id` +
      `variant_label` on `products`; master rows have price 0/qty 0 and are
      excluded from sellable lists; endpoint to bulk-assign children to a
      master. See `CATALOG_PRODUCT_FINDER.md`. (done in 038eeed)

## Frontend lane (web/)

- [x] FE-1: Purchasing/Receiving UI — suppliers list, create PO (with
      lot/expiry lines), receive flow; surface `costCents` + margin on the
      inventory grid. Wire to `/api/v1/purchasing/*`. (done in 7d59820)
- [x] FE-2: Accounts (AP/AR) surface — bills/invoices lists with aging buckets
      from `GET /reports/ar-aging` and `/ap-aging`; pay actions. (done in
      a391420)
- [ ] FE-3: Near-expiry/markdown report — table from
      `GET /api/v1/inventory/expiring` + `/expired`, with a lot column on the
      main inventory grid and a "Return to vendor" action
      (`/purchasing/returns`).
- [ ] FE-4: Operations — Locations grid (assign products to bins via
      `/fulfillment/assign`) + Pick & Pack queue
      (`/fulfillment/pick-lists`, pick line, pack).
- [ ] FE-5: Settings — Chart of Accounts tree editor
      (`/accounting/accounts*`) + Batch Deposits list/create/approve
      (`/accounting/deposits*`).
- [ ] FE-6: Audit existing `web/mocks/lightspeedHandlers.ts` against live
      backend routes; flip any still-mocked endpoints used by built pages to
      live `apiGet`/`apiPost` calls.
- [ ] FE-7: Catalog filter/bulk-select UI on `/inventory` — category-tree
      filter, row checkboxes + "Actions" menu (bulk status/category update,
      CSV export), consuming BE-6/BE-7. See `CATALOG_PRODUCT_FINDER.md`.
- [ ] FE-8: Product detail/edit page (`/inventory/products/[id]`) with
      General, Categories, Price (live cost/price/margin/markup), Manage Qty,
      and Image sections, consuming BE-6. See `CATALOG_PRODUCT_FINDER.md`.
- [ ] FE-9: Variants UI — master/child editor on the product detail page plus
      a visual distinction for master rows in the `/inventory` list,
      consuming BE-8. See `CATALOG_PRODUCT_FINDER.md`.

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

_Agents append a one-line entry here each run: date, agent, item, commit._
