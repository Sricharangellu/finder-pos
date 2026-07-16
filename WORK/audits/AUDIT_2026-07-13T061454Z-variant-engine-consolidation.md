# Audit — Variant Management & Matrix Builder Consolidation

Date: 2026-07-13T061454Z
Session: Claude session A (Opus 4.8)
Status label: **Built and verified** (backend + web gates; browser e2e not run — local auth harness blocks it)

Unifies variant creation onto one engine and reworks the generator UX per the
"Variant Management & Matrix Builder Consolidation" PRD. Shipped in three verified
slices, all in the `catalog` module + the product Variants tab.

## Commits
- `aff41cb` — Slice 1: backend foundation (structured options + non-destructive regen)
- `ac8bbd4` — Slice 2: generator UX (Enter-chips, drag-sort attributes, live preview)
- (this commit) — Slice 3: 3-step setup wizard + SKU reassignment

## Slice 1 — Backend foundation (#1, #3, #4, #6, #8)
- New nullable `products.variant_options` (TEXT, canonical JSON of the attribute
  map, e.g. `{"Size":"S","Color":"Red"}`) gives a variant a stable identity
  independent of its display label. Migration `ALTER_PRODUCTS_VARIANT_OPTIONS`.
- One standardized separator `VARIANT_SEPARATOR = " - "` for labels and names;
  the old `combo.join(" / ")` is gone. `name = "Master - S - Red"`.
- `generateVariants` is non-destructive: each requested combination is matched to
  an existing variant by **order-independent signature** (falling back to a parsed
  legacy label), then **updated in place** — preserving id/sku/upc/inventory/
  pricing/images — or created when missing. Combinations no longer listed are left
  untouched. Nothing is deleted, unlinked, or duplicated.
- `update()` recomputes a variant's label+name from `variant_options` when its
  values change, preserving everything else.

## Slice 2 — Generator UX (#2, #7, #9)
- Enter-based value chips replace comma entry (one chip per value; Backspace/×
  removes; multi-line paste splits). No commas.
- Drag-and-drop attribute ordering via a handle (native HTML5 DnD, no new deps);
  order drives variant naming order.
- Live combination preview: search, A–Z/Matrix sort, and click-to-exclude/include
  per combination; counter shows "N of M will be created".
- Backend: `POST /catalog/:id/variants/generate` accepts optional `exclude`
  (value combinations to skip, matched order-independently).

## Slice 3 — Setup wizard (#5)
- `VariantSetupWizard`: a 3-step modal editing every generated variant at once —
  Step 1 SKU + UPC/barcode table; Step 2 pricing (Selling/Compare-at/Cost with a
  "Use parent selling price" toggle); Step 3 multi-category checkboxes (writes the
  existing `product_categories` M2M via `POST /catalog/:id/categories`).
- Auto-opens after a successful generate; also reachable via "Set up variants".
- Backend: `sku` is now reassignable through `update()` (Step 1) — guarded by a
  tenant-unique pre-check plus a 23505→409 backstop. `UpdateProductInput` widened
  from `Omit<…, "sku">` to `Partial<CreateProductInput>`.

## Verification
- PASS: backend `npm run typecheck`; `catalog.test.ts` in isolation — **49/49**
  (+8 across the three slices): structured options stored; regen keeps existing
  variants (same id/sku/price/barcode) and only adds new; order-independent
  identity (no dup on attribute reorder); in-place options edit; standardized
  separator, never "/"; exclude list honored; sku reassignment + 409 on collision.
- PASS: `npm run smoke` — 20/20; `npm run hygiene` — 930 files clean.
- PASS: web `npm run typecheck && npm run lint && npm run build`.
- Full `npm test` showed 0–3 flaky failures across runs (e.g. `business.test.ts`
  "me/context … seeded units"); each passes in isolation (business 7/7). This is
  the documented `PG_POOL_MAX=1` parallel-contention flakiness, not a regression.

## Notes / still open (PRD)
- Browser e2e of the generator + wizard is blocked by the local two-port auth
  harness (unchanged, per standing instruction not to touch it).
- Variant-level drag-reorder UI (persisting via the existing `reorderVariants`
  endpoint) and storefront variant grouping (#9 storefront side) are not part of
  these slices.
- Compare-at maps to `msrp_cents`; "internal code" (optional in the PRD) was not
  added — no column exists for it.
