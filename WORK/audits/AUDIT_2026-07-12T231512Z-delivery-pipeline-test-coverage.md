# Audit — Delivery pipeline test coverage

Date: 2026-07-12T23:15:12Z
Session: Claude session A (Opus 4.8, test-coverage pass)
Status label: **Test-only** — no product code changed

## Feature under test

The sales/ecommerce delivery pipeline (`sales` → `fulfillment` → `shipping` →
`billing`). Framework: `node:test` + a real embedded Postgres per file
(`scripts/pg-harness.ts`); route-level assertions via `test-request.ts`, error
envelope checked as `json.error.code` (matching `catalog.test.ts`).

## Gaps found → tests added (`src/modules/shipping/delivery-pipeline.test.ts`)

The suite covered happy paths + basic idempotency but missed failure states, the
status-filter contract, and a regression window opened by the recent
`buildPickList` refactor. Added 5 focused, assertion-driven tests (no snapshots):

1. **Regression — re-pick a packed order.** After pack (order = `packed`), calling
   `pick-lists/from-sales-order` again returns the **same** pick list and the order
   **stays `packed`** — it is not moved back to `picking` (which would 409). Guards
   the `created`-flag logic in `buildPickList`.
2. **Pack before all lines picked** → `409 not_picked`, and the order stays
   `picking`. Failure state on the fulfillment guard.
3. **Deliver before ship** → `409`. Failure state on the shipping state machine.
4. **Missing sales order** → `404 not_found` for both
   `fulfillment/pick-lists/from-sales-order` and `shipping/from-sales-order`.
5. **`?fulfillmentStatus=` filter** returns only orders at that stage and excludes
   others (both `picking` and `unfulfilled` directions). Guards the list filter
   added earlier.

## Bug found & fixed (in test code)

The new filter test creates two sales orders in one app; that surfaced a latent
**test-helper defect**: `mkSalesOrder` used fixed SKUs (`PIPE-A`/`PIPE-B`), so a
second call collided on the tenant-unique SKU constraint and silently produced an
invalid order. Made the helper's SKUs unique per call. This also **strengthens the
pre-existing "queryable by sales order" test**, whose second order was previously a
silent failed-create (its assertions passed only vacuously).

No product/source code was changed — the fix was entirely in the test file.

## Verification

- PASS: `npm run typecheck`.
- PASS: `delivery-pipeline.test.ts` in isolation — **12/12** (7 prior + 5 new).
- `npm test` — 394 total (389 + 5 new), 392 pass. The **2 failures are unrelated
  pre-existing flakes** under the parallel `node --test` runner
  (`orders/lifecycle.test.ts` "…voided order", `outlets/outlets.test.ts` "…register
  session") — both **pass in isolation (8/8 verified)**, are in modules this change
  does not touch, and match the parallel-run noise the earlier audits documented.
  My new tests all pass. `node tools/hygiene-check.mjs` — 917 files, clean.
  (No smoke run — changes are test-only and do not affect runtime behavior.)

## Notes / still open
- A `/delivery` frontend Playwright golden path remains the main coverage gap
  (page is render-verified; button-drive blocked by the demo-auth harness).
- Partial pick / partial shipment paths don't exist yet, so nothing to test there.
