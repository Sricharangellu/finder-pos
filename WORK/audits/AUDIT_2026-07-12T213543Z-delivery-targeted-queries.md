# Audit — /delivery detail via targeted queries (robustness/perf)

Date: 2026-07-12T21:35:43Z
Session: Claude session A (Opus 4.8, persistent-agent: continue + improve)
Status label: **Built and verified** (backend); **Built but not verified** (web page — compiles, no e2e)

## What & why

The `/delivery` panel's `loadDetail` fetched **all** pick lists (server LIMIT 200) and
**all** shipments (LIMIT 500) for the tenant, then filtered client-side to find the
selected order's pick list / shipment. Two problems:
- **Correctness:** once a tenant exceeds 200 pick lists / 500 shipments, the target row
  can fall outside the page and the panel silently shows "no pick list / no shipment".
- **Performance:** a full-table fetch on every order selection.

Fixed by querying each resource by the selected order directly — the same filter pattern
already used for invoices (`?salesOrderId=`) and sales orders (`?fulfillmentStatus=`).

## Changes

- `shipping` — `ShippingService.list(tenantId, { status?, salesOrderId? })` (was
  `list(tenantId, status?)`); `GET /api/v1/shipping/?salesOrderId=` filters server-side.
  Sole caller (the route) updated.
- `fulfillment` — `FulfillmentService.listPickLists(tenantId, orderId?)`; passing `orderId`
  returns just that order's pick list (`order_id` holds the retail/sales-order source id).
  `GET /api/v1/fulfillment/pick-lists?orderId=`. Sole caller updated.
- `web/app/(protected)/delivery/page.tsx` — `loadDetail` now issues
  `pick-lists?orderId=`, `shipping/?salesOrderId=`, `billing/invoices?salesOrderId=` and
  takes `items[0]`; no client-side scan/filter. Behaviour identical for small tenants,
  correct + cheap for large ones.

No schema changes, no new dependencies, no signature changes with more than one caller.

## Verification

- PASS: `npm run typecheck` (backend) and `cd web && npm run typecheck`.
- PASS: focused pipeline run — **44/44** (embedded Postgres), incl. new
  "pick-lists and shipments are queryable by sales order (no full-table scan)": asserts the
  filters return exactly the order's pick list + shipment, and empty for an unrelated order.
- PASS: `npm test` — **389/389** (+1 vs 388 baseline); `npm run smoke` 20/20;
  `node tools/hygiene-check.mjs` 913 files.
- PASS: `cd web && npm run lint` (pre-existing warnings only) / `npm run build`
  (`/delivery` emitted, 5.29 kB).

## Notes / remaining
- Still open (unchanged): a Playwright e2e for `/delivery` driving the buttons (the page is
  render-verified in a real browser but the in-browser click-through is gated by the demo
  auth harness); partial pick / partial shipment.
