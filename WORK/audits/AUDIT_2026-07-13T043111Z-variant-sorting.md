# Audit — Independent online/offline variant sorting (PRD #3)

Date: 2026-07-13T04:31:11Z
Session: Claude session A (Opus 4.8, Matrix Builder PRD backend slices)
Status label: **Built and verified** (backend)

Adds per-channel variant sorting — a master's variants can be ordered independently
for the online store and the offline/POS view. `catalog` module only.

## Changes

- **Schema** (`catalog/index.ts`): `products.online_sort_order` / `offline_sort_order`
  (INTEGER DEFAULT 0 — manual drag order per channel) and `online_variant_sort` /
  `offline_variant_sort` (TEXT DEFAULT 'default', on the master — the sort mode).
- **Service** (`catalog/service.ts`):
  - `VariantSortMode` = default | manual | price_asc | price_desc | name_asc | name_desc;
    `variantOrderBy()` maps each to a safe ORDER BY (channel enum → fixed column names,
    no interpolation of user input).
  - `listVariants(masterId, tenantId, channel?)` orders by the channel's stored mode.
  - `reorderVariants(masterId, channel, orderedIds, tenantId)` — persists a manual order
    for one channel (in a transaction) and flips that channel's mode to `manual`; rejects
    (`400`) unless `orderedIds` is exactly the master's current variants.
  - `setVariantSort(masterId, channel, mode, tenantId)` — sets a channel's sort mode.
  - `Product` interface gains the four fields; `create()` defaults them.
- **Routes** (`catalog/routes.ts`, all manager-gated except the GET):
  - `GET /catalog/:id/variants?channel=online|offline` — sorted per that channel.
  - `POST /catalog/:id/variants/reorder { channel, orderedIds }`.
  - `PATCH /catalog/:id/variants/sort { channel, mode }`.

No web change (the drag-reorder UI is a later slice); no new dependencies.

## Verification

- PASS: `npm run typecheck`.
- PASS: `catalog.test.ts` in isolation — **39/39** (4 new):
  - manual reorder is per-channel and **independent** (online reordered; offline stays
    default order);
  - `price_asc` mode orders variants by price;
  - reorder rejects ids that aren't the master's variants (400);
  - reorder/sort require the manager role (403 for cashier).
- PASS: `npm test` — **405/405** (+4); `npm run smoke` — 20/20; `npm run hygiene` — 927.
  The schema migration + `Product` interface change caused no regression.

## Notes / still open (PRD)
- The online store / matrix UI drag-and-drop reorder that calls these endpoints is a
  separate slice; the web api-client `Product` type doesn't yet carry the sort fields
  (web ignores the extra JSON fields — no breakage).
- Remaining PRD: #4 locations + promo/compare-at bulk, #9 storefront variant grouping,
  #10 virtualization/undo/shortcuts.
