# Audit — Behavior-preserving pipeline refactor

Date: 2026-07-12T23:04:49Z
Session: Claude session A (Opus 4.8, refactor/optimization pass)
Status label: **Built and verified** — no behavior change, existing tests prove it

## Scope

Two focused, behavior-preserving cleanups in the delivery-pipeline services.
No route, schema, contract, or frontend changes.

## Changes

### 1. `fulfillment/service.ts` — remove a redundant existence query
`createPickListForSalesOrder` queried `pick_lists` to decide whether to advance
the sales order, then `buildPickList` queried the **same row again**. `buildPickList`
now returns `{ pickList, created }`; the caller advances the sales order only when
`created` is true. Same semantics (a repeat call still returns the existing list
without re-advancing — which would otherwise 409 on an already-packed order), one
fewer `SELECT` on the sales-order path. `createPickList` (retail) reads `.pickList`.

### 2. `shipping/service.ts` — extract a shipment factory
`createFromInvoice` and `createFromSalesOrder` each built the same 12-field
`ShippingOrder` literal (id, ship_number, status, method default, four nulls, two
timestamps), differing only in `invoice_id`/`sales_order_id`/`customer_id` and the
optional method/expectedDate/notes. Extracted `newShipment(tenantId, src)` so the
boilerplate lives once and the two paths can't drift.

## Why these (evidence)

- The double `pick_lists` read was visible in the two `WHERE order_id = @o` queries
  (caller + `buildPickList`); the outer one existed only to gate `setFulfillmentStatus`.
- The shipment literal was duplicated verbatim across the two create methods.

Both are the kind the request targets: duplicated logic and a redundant slow path,
fixed without changing behavior or widening the API.

## Verification

- PASS: `npm run typecheck`.
- PASS: focused pipeline run — **44/44** (embedded Postgres). The behavior-critical
  cases pass unchanged:
  - `pick list from a sales order is idempotent` (guards the `created`-flag logic —
    a repeat call must not re-advance the order),
  - `shipment from a sales order is idempotent (auto + manual converge)` and
    `createFromInvoice is idempotent` (guard both `newShipment` paths),
  - `full pipeline …`, `fulfillment status cannot skip stages`,
    `pick-lists and shipments are queryable by sales order`.
- PASS: `npm test` — **389/389** (count unchanged; pure refactor, no tests
  added/removed); `npm run smoke` 20/20; `node tools/hygiene-check.mjs` 916 files.

## Notes

Considered but deliberately skipped (would be broader rewrites for little gain):
- Centralizing the `where[]/params{}` filter builder shared by sales/billing/shipping
  `list` methods — cross-module coupling risk, low payoff.
- Batching per-line INSERTs in `persist`/`buildPickList` — line counts are small
  (order lines); added complexity not justified.
