# Audit — Delivery pipeline for sales / ecommerce orders

Date: 2026-07-12T06:28:01Z
Session: Claude session A (Opus 4.8 — user feature: retail order / invoices / sales orders (ecommerce) / delivery pipelines)
Status label: **Built and verified** (backend); **Built but not verified** (web page — compiles, no e2e yet)

## Context

The four requested areas already existed individually — retail POS orders (smoke-verified),
AR invoices (`customer_invoices` + billing raising an invoice on `sales_order.invoiced`),
sales orders (`sales`; ecommerce checkout reuses `sales.createSalesOrder`), and the delivery
building blocks (`fulfillment` pick/pack, `shipping` ship/deliver). **The gap was the seams:**
fulfillment pick-lists only worked on retail `order_lines`; shipping only built from invoices;
packing never created a shipment; nothing propagated delivery status back to the order.

This slice connects them into one tracked pipeline for **sales / ecommerce orders**.

## What changed

### New concept — `sales_orders.fulfillment_status`
`unfulfilled → picking → packed → shipped → delivered`, independent of the order-to-cash
`status`. Forward-only transitions enforced by `SalesService.setFulfillmentStatus`
(skipping/reversing a stage is a 409). Each transition publishes `sales_order.<status>`.

### Fulfillment — pick lists from sales orders
- `pick_lists.source_type` (`order` | `sales_order`); `order_id` holds the source id either way.
- `POST /api/fulfillment/pick-lists/from-sales-order` → builds a pick list from
  `sales_order_lines` (resolved to pick locations) and moves the SO to `picking`.
- `pack` on a sales-order pick list moves the SO to `packed`, which emits `sales_order.packed`.
- Retail pick-list path unchanged (shared private builder; still idempotent).

### Shipping — sales-order-aware
- `shipping_orders.invoice_id` is now nullable; added `sales_order_id` with partial-unique
  indexes (`WHERE … IS NOT NULL`) so a shipment maps to at most one invoice **or** one SO.
- Listens to `sales_order.packed` → auto-creates a shipment from the sales order (idempotent).
- `POST /api/shipping/from-sales-order` for manual/again creation (converges with the auto one).
- `ship` / `deliver` propagate the SO to `shipped` / `delivered`. Propagation runs **before**
  the shipment row mutates, so an illegal SO transition leaves both records untouched (no drift).
- Existing invoice→shipment path unchanged.

### Cross-module wiring
Both `fulfillment` and `shipping` compose `SalesService` (mirrors how `ecommerce`/`billing`
compose). `SalesService` args are optional so retail-only callers and unit tests need no wiring.

### Sales API
- `fulfillment_status` returned on SO get/list; `?fulfillmentStatus=` filter on the list route.

### Frontend — `/delivery` page
- New nav entry (Inventory group, `featureGate: "shipping"`), `NavKey: "delivery"`.
- Master-detail: sales orders with a stage badge on the left; a stage stepper + the single
  stage-appropriate action on the right (Start picking → Pick lines → Pack → Mark shipped →
  Mark delivered). Manager-gated; loading/empty/error states. Uses the real API client
  (`apiGet`/`apiPost`) — no mocks. api-client types extended (`SOFulfillmentStatus`,
  `SalesOrder.fulfillment_status`, `Shipment.sales_order_id`, `PickList.source_type/order_id`).

## Verification

Backend:
- PASS: `npm run typecheck`.
- PASS: focused run of the affected modules (embedded Postgres) — 33/33, incl. the new
  `delivery-pipeline.test.ts`: full pipeline propagation, pick-list idempotency, auto+manual
  shipment convergence, and the skip-stage 409 guard.
- PASS: `npm test` — **389/389** (0 fail; +5 vs the 384 baseline in `AUDIT_2026-07-12T013607Z`).
- PASS: `npm run smoke` — 20/20 (retail POS lifecycle unaffected).
- PASS: `node tools/hygiene-check.mjs` — 912 files, no junk.

Frontend:
- PASS: `cd web && npm run typecheck`.
- PASS: `cd web && npm run lint` — only the pre-existing hook warnings; none from the new page.
- PASS: `cd web && npm run build` (exit 0).

## Follow-ups (not in this slice)

- Playwright e2e driving the `/delivery` page end-to-end (page is **Built but not verified**).
- Partial pick / partial shipment (currently a pick line is picked in full; a shipment covers
  the whole SO).
- Optionally gate `createPickListForSalesOrder` on SO `status = approved` (today any non-
  cancelled SO can be picked).
- Surface the AR invoice (already auto-raised on `sales_order.invoiced`) on the delivery panel.
