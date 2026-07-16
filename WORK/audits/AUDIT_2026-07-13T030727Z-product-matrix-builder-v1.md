# Audit — Product Matrix Builder workspace (PRD slice #4/#6, v1)

Date: 2026-07-13T03:07:27Z
Session: Claude session A (Opus 4.8, Product Matrix Builder PRD)
Status label: **Built but not verified** (compiles + wired to real APIs; no browser e2e — local auth harness blocks it, and the demo seed has no variant hierarchy)

## Scope

First slice of the multi-week PRD: the **Matrix Builder workspace UI**. Frontend only,
wired to the **existing** catalog APIs — no backend changes. The master/variant model,
per-variant pricing, categories, and bulk-update endpoint already existed; this adds the
management workspace on top.

## Delivered — `web/app/(protected)/catalog/matrix/page.tsx` (+ nav)

- **Hierarchy** (PRD #4/#7): master products with expandable variant rows; each master
  shows its category badge + variant count; standalone products render as leaf rows.
- **Inline editing** (PRD #4): click selling price / cost to edit in place (dollars →
  cents), Enter/blur saves via `PATCH /catalog/:id`, Esc cancels — no separate screen.
- **Per-row toggles**: Put online / Take offline (`ecommerce`), Activate / Deactivate
  (`status`), with Online/Offline + status badges (PRD #6 visual indicators).
- **Bulk selection** (PRD #4): row checkboxes; a master checkbox selects/deselects all its
  variants; Select all / Deselect all.
- **Sticky bulk toolbar** (PRD #4): Activate, Deactivate, Enable online, Disable online
  (single `POST /bulk-update` calls); Adjust selling price by ±% (per-row `PATCH` loop,
  since bulk-update sets one value for all).
- **Find & organize** (PRD #5): debounced-feeling client search over name/SKU/variant;
  Expand all / Collapse all.
- **UX/states** (PRD #6): skeleton loading, empty state (search-aware), `role="alert"`
  errors, `Button` loading via `busy`, responsive horizontal scroll (`min-w-[720px]`),
  sticky header, a11y (checkbox/expand `aria-*`, labelled search).
- **Permissions** (PRD #11): all mutations gated on `hasRole("manager")` (the catalog
  PATCH/bulk-update routes are already `requireRole("manager")` server-side); read-only
  users see everything but can't edit.
- **Nav**: "Matrix Builder" under Catalog (`catalog-matrix` NavKey, `featureGate: catalog`).

## Verification

- PASS: `cd web && npm run typecheck` / `npm run lint` / `npm run build`
  (`/catalog/matrix` route emitted, 6.13 kB). No backend change → backend gates untouched.
- NOT done: browser e2e / screenshot — the local Playwright auth harness fails at login
  (documented), and the demo seed has no master/variant products to render a meaningful
  matrix. Logic verified by code review; wired to real endpoints
  (`GET /catalog`, `PATCH /catalog/:id`, `POST /catalog/bulk-update`).

## Deferred (later PRD slices — not built, honestly out of scope for v1)

- #1 category-inheritance **enforcement** + cascade; #3 independent online/offline **sort
  order** + drag-drop reorder; #4 location management, promo/compare-at editing, price
  rounding presets, tax-class bulk; category-section grouping (v1 shows category as a
  badge, sorted by category); #8 storefront naming without hyphen; #9 storefront variant
  grouping; #10 virtual scrolling / pagination beyond 200 rows, undo, keyboard shortcuts;
  an explicit **offline-visibility** field (backend only has `ecommerce`/online + `status`).

These are separate, mostly backend-touching slices; each warrants its own change + tests.
