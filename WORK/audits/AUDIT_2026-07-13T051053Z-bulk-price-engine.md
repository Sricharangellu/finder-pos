# Audit — Bulk price/cost engine (PRD #4)

Date: 2026-07-13T05:10:53Z
Session: Claude session A (Opus 4.8, Matrix Builder PRD backend slices)
Status label: **Built and verified** (backend + web gates; browser e2e not run — local auth harness blocks it)

Adds one server-computed bulk price/cost operation across many products, and wires
the Matrix Builder toolbar to it (replacing a per-row PATCH loop that did percent
math on the client). `catalog` module + `catalog/matrix` page only.

## Changes

- **Service** (`catalog/service.ts`):
  - `PriceTarget` = selling | cost; `PriceOp` = inc_pct | dec_pct | inc_amount |
    dec_amount | set | round_99 | round_95; `PRICE_OPS` exported for schema reuse.
  - `adjustPrice(current, op, value)` — pure helper. Percent ops round to nearest
    cent; `round_99`/`round_95` snap to `…99`/`…95` within the same 100-cent band;
    result clamped to `>= 0`. No I/O.
  - `bulkAdjustPrice(ids, target, op, value, tenantId)` — dedups ids, loads each
    product (tenant-scoped `getOrThrow` → 404 if any id is foreign/missing),
    computes the new value against `price_cents` (selling) or `raw_cost_price_cents`
    (cost, defaulting a null cost to 0), and persists via the existing `update()`
    (so events/validation stay consistent). Returns the updated rows.
- **Routes** (`catalog/routes.ts`): `POST /catalog/bulk-price` (manager-gated),
  `bulkPriceSchema` — `ids` 1..500, `target` enum, `op` from `PRICE_OPS`, `value`
  optional but **required unless** op is `round_99`/`round_95` (zod `.refine`).
- **Web** (`catalog/matrix/page.tsx`): the sticky bulk toolbar now calls
  `apiPost("/api/v1/catalog/bulk-price", …)` once for the whole selection instead
  of looping `apiPatch` per row. Added a **Sell/Cost** target `<select>`, kept the
  `±%` input (positive → inc_pct, negative → dec_pct), and added a **Round .99**
  button. Percent math is no longer duplicated on the client.

## Verification

- PASS: `npm run typecheck` (backend); `cd web && npm run typecheck && npm run lint
  && npm run build` (matrix route builds clean).
- PASS: `catalog.test.ts` via the pg harness in isolation — **43/43** (+4 for #4):
  inc/dec percent on selling; fixed-amount + `set` on cost; `round_99` snaps to
  `…99`; negative results clamp to 0; foreign id → 404; non-manager → 403.
- PASS: `npm run smoke` — 20/20; `npm run hygiene` — 927 files, clean.
- Full `npm test` showed 408/409 on one run with **1 flake** — reran and the failed
  set was empty; the catalog file is 43/43 in isolation. This is the documented
  `PG_POOL_MAX=1` parallel-contention flakiness, not a regression from this slice.

## Notes / still open (PRD)
- Browser e2e of the toolbar is still blocked by the local two-port auth harness +
  no seeded variant data (same limitation noted for the Matrix Builder v1 audit).
- `round_99`/`round_95` ignore `value` by design (schema makes it optional for them).
- Remaining PRD: #4 location-level price + promo/compare-at bulk, #9 storefront
  variant grouping, #10 virtualization/undo/keyboard shortcuts.
