# Audit — Purchase cost-entry page + Receive Stock per-line location (session D, Sri feature)

Date: 2026-07-16
Session: Claude session D (Fable 5, Sri-directed feature — paused the inventory loop)
Branch: `feat/delivery-pipeline` (PR #70)

## Request (Sri, full-stack)

1. Receive Stock: replace the per-line Lot code field with a per-line Product
   Location selector.
2. New Purchase page: received goods (final qty) flow in for cost entry, with
   reference prices (previous cost from the SAME vendor, last purchase cost, our
   selling price) and a top-bar toggle to hide the reference columns; saving a
   cost updates product cost + inventory valuation.

Answers chosen: full-stack; save updates product_costs + valuation; toggle hides
the reference-price columns; per-line location on Receive Stock.

## Slices shipped

- **52643c2 — backend cost-entry.** GET /purchasing/cost-entry (received PO
  lines + reference prices via correlated subquery for prev-same-vendor cost,
  product_costs for last cost, catalog price for selling); POST /purchasing/
  cost-entry (manager+) upserts product_costs + emits product.cost_updated.
  Tests: reference-price flow + cashier-403.
- **d55e719 — Purchase page.** /purchase (nav child under Inventory, purchasing-
  gated): cost input pre-filled from PO cost, live margin badge, reference
  columns toggled by a top-bar checkbox, save → POST. MSW mocks added.
- **(this) — Receive Stock per-line location.** Backend: ReceiveLineInput.
  locationId threaded through receive() → purchase_order.received event → the
  inventory handler credits the chosen location's inventory_stock (in addition
  to the product-level aggregate). Frontend: ReceiveLinesCard lot-code field
  replaced with a Location <select> (from /inventory/locations); receive types
  swap lotCode→locationId; existing buildReceiveLines unit test updated.

## Delivery standard

- **Architecture impact**: new purchasing cost-entry endpoints; receive flow
  now location-aware (additive — locationId optional; omitting it preserves the
  prior product-level-only behavior).
- **Database impact**: none (reuses product_costs, inventory_stock; no schema
  change).
- **Testing evidence**: purchasing 22/22 isolated real-PG (cost-entry flow,
  cashier-403, receive-into-location credits inventory_stock); receiveStock
  vitest 6/6; backend typecheck CLEAN; web typecheck CLEAN (installed the
  absent local web node_modules to validate); web build compiles (/purchase
  5.37 kB, /receive-stock 7.82 kB); smoke 20/20.
- **Security impact**: cost submission is manager-gated; reads open.
- **Rollback**: revert the three commits.
- **Monitoring**: none new.

## Known model nuance (documented, not a bug)
Receiving credits BOTH the product-level `inventory` aggregate and the chosen
location's `inventory_stock`. These are separate views (inventory overview vs
warehouse/location grid); summing all locations will not necessarily equal the
product aggregate for stock received before location routing existed. Full
product-level ↔ location-level reconciliation is a larger costing/valuation
design item, out of scope for this feature.
