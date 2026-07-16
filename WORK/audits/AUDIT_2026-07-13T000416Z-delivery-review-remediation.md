# Audit — Delivery pipeline code-review remediation (findings 1–7)

Date: 2026-07-13T00:04:16Z
Session: Claude session A (Opus 4.8, code-review remediation)
Status label: **Built and verified**

Implements fixes for all 7 findings from the delivery-pipeline review, in severity order.

## Fixes

1. **[High — authz] Server-side manager gating.** `fulfillment/routes.ts` and
   `shipping/routes.ts` now apply `requireRole("manager")` to every mutation
   (pick-list create + from-sales-order, pick, pack; shipment create/from-sales-order,
   ship, deliver, cancel, pack-line). GETs stay open. The delivery UI's "manager only"
   gating is now actually enforced server-side. Auto-create-on-pack runs service-to-
   service, so it is unaffected.

2. **[Medium — robustness] pack→shipment is now idempotent and re-pack-recoverable.**
   Replaced the fire-once `sales_order.packed` listener with a direct, idempotent call:
   `FulfillmentService` composes `ShippingService` and `pack()` calls
   `createFromSalesOrder` itself. If a prior pack advanced the order to `packed` but the
   shipment failed to create, re-packing now creates it (the old path relied on a status-
   change event that a re-pack — already `packed` — could not re-fire). Removed the
   shipping event listener.

3. **[Medium — UI] "Delivered" badge on picked lines.** A picked pick-list line now
   shows a dedicated **"Picked"** pill instead of reusing the green "Delivered" stage badge.

4. **[Medium — concurrency] `ship_number` race.** `ShippingService.persist` retries on
   `23505` (unique_violation) up to 5 times, regenerating `ship_number` from a fresh
   COUNT — so two concurrent creates no longer 500 on a duplicate number. Idempotency
   (invoice/sales-order) is still guarded by the upstream existence check.

5. **[Low — robustness] `fulfillment_status` integrity.** Added a `CHECK` constraint on
   `sales_orders.fulfillment_status` (matching the invoices/bills pattern) and guarded the
   transition-map lookup (`FULFILLMENT_TRANSITIONS[...] ?? []`) so an unexpected value
   yields a clean 409, not a TypeError 500.

6. **[Low — UI race] `/delivery` stale render.** `loadDetail` now tags each load with a
   monotonic ref id and drops responses superseded by a newer selection, so rapidly
   switching orders can't paint one order's pick list/shipment/invoice under another.

7. **[Low — types] `SalesOrderStatus` drift.** Web type now mirrors backend `SOStatus`
   (`invoiced`/`partially_invoiced`; removed the non-existent `fulfilled`).

## Tests added (`delivery-pipeline.test.ts`)

- **authz:** a `cashier` gets `403 forbidden` on `pick-lists/from-sales-order` and
  `shipping/from-sales-order`; the same call as manager/owner succeeds (201).
- **recovery (#2):** pack with shipping unwired leaves the order `packed` with **no**
  shipment; re-pack with shipping wired creates the missing shipment — proving re-pack
  recovers even though the order is already `packed` (no status-change event).

## Verification

- PASS: `npm run typecheck` (backend) + `cd web && npm run typecheck`.
- PASS: `delivery-pipeline.test.ts` in isolation — **14/14** (12 prior + 2 new).
- PASS: `npm test` — **396/396** (394 + 2 new); `npm run smoke` — 20/20;
  `node tools/hygiene-check.mjs` — 918 files. No regressions from the new role gating,
  the CHECK-constraint migration, or the fulfillment↔shipping composition change.
- PASS: `cd web && npm run lint` (pre-existing warnings only) / `npm run build`
  (`/delivery` emitted).

## Not changed / notes
- `nextNumber`'s COUNT pattern is codebase-wide (invoices/quotes/SOs); only shipping got
  the retry since it is the one newly on an auto-create-on-pack path. A shared sequence
  would be the deeper fix if this recurs elsewhere.
- The `/delivery` page still has no browser e2e (the standing gap); #3/#6 are covered by
  code review + typecheck/build only.
