# Inventory — gap notes

**Source:** the 2026-06-15 "Complete Enterprise Architecture Assessment"
(erp.fairtradetx.com benchmark, pasted into this session). Like
`ERP_BENCHMARK.md`, this is **inspiration only** — see `ROADMAP.md`'s
framing note. This file pulls the subset of the assessment's Module 2
(Inventory) gaps worth building for Finder, and turns it into roadmap items.

Updated: 2026-06-15.

## Where Finder's inventory stands today

- `src/modules/inventory`: per-product on-hand qty, `inventory_movements`
  ledger, manual adjustments, auto-decrement on sale (FEFO across
  `inventory_lots` for expiry-tracked products — see `SCOPE_EXPANSION.md`),
  restock on refund, reorder points, near-expiry/expired reports.
- `GET /api/v1/inventory/levels` already returns `onHand`, `committed`,
  `available`, `reorderPoint`, `costCents`, `velocity` — but `committed` is
  **hardcoded to 0** (`src/modules/inventory/service.ts:267`). There is no
  reservation mechanism, and `src/modules/orders/service.ts` does not check
  stock before creating an order — **oversell is possible today.**
- Purchasing already has a receive flow (`POST
  /api/v1/purchasing/orders/:id/receive`) that posts `inventory_movements`
  and creates lots. The assessment's "no receiving module" finding does
  **not** apply to Finder.

## Curated gaps (assessment → verdict for Finder)

| Gap | Verdict |
|---|---|
| Inventory reservation on order creation (oversell prevention) | **Worth building.** `committed` is already a field in the API contract — wire it up. Highest-value item in this file. |
| Stock transfer between locations / multi-warehouse | **Defer.** Finder is single-warehouse per tenant today (`outlets` exist but inter-store stock movement isn't modeled). Revisit alongside BE-4 (multi-store filter) once tenants actually run >1 warehouse. |
| Cycle counting / physical count sheets | **Worth a minimal version** — a "count session" that records expected-vs-counted per SKU and posts the delta as an `inventory_movements` adjustment (the adjustment endpoint already exists; this just batches it). |
| Bin/location management, pick/pack | **Already partially covered** by the `fulfillment` module (locations + pick lists) — see `FULFILLMENT_SHIPPING_GAPS.md`, don't duplicate here. |
| Demand forecasting, FIFO/LIFO/WAC valuation method selection | **Out of scope.** Finder uses FEFO for expiry-tracked SKUs and a single cost basis; a configurable valuation method is ERP-generic complexity Finder's users won't ask for. |
| Shrinkage/variance tracking | **Folds into cycle counting above** — a count session's deltas *are* the shrinkage report; no separate feature needed. |
| Consignment inventory, cross-docking | **Out of scope** — not relevant to Finder's wholesale/retail customer base. |

## What this turns into on the roadmap

- **BE-9** — Inventory reservation: on `POST /api/v1/orders`, check
  `available` (onHand − committed) per line and reject (409) if
  insufficient; on order creation increment `committed`, on
  completion/void/refund release it. Make `committed` in
  `GET /inventory/levels` reflect real reservations.
- **BE-10** — Cycle count sessions: `POST /api/v1/inventory/counts` (open a
  session with expected qtys), `POST /:id/lines` (record counted qty),
  `POST /:id/close` (posts variance as `inventory_movements` adjustments,
  manager-gated).

Everything else in the table above is explicitly **not** on the roadmap
unless a future need justifies it.
