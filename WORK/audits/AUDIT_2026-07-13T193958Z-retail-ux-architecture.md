# Audit — Retail (B2C) Architecture & UX Review

Date: 2026-07-13T19:39:58Z
Session: Claude session A
Status label: **Audit complete; fix slice 1 shipped** (duplicate product editor + duplicate sales report). Remaining findings are prioritized below and unfixed unless marked.

Scope: the full web app (143 page routes) reviewed for duplicates, orphans, dead
ends, nav reachability, and retail/B2B isolation, per the "Retail (B2C) Complete
Architecture & UX Redesign" PRD.

## Inventory

- **143 page routes** under `web/app`.
- **35 are deliberate one-line alias pages** (`export { default } from …`) kept for
  URL compatibility — e.g. `/setup/* → /settings|/team|/integrations`,
  `/reporting/{p-l,ar-aging,…} → /reports/*`, `/catalog/gift-cards → /gift-cards`,
  `/inventory/count → /inventory/counts`. These are NOT duplicates of logic;
  they're routing shims. Leave them.
- **Vertical packages** (golf ×4, restaurant ×4, automotive, education,
  entertainment, healthcare, hospitality, rental, manufacturing, appointments)
  are module-gated in `EnterpriseShell` (`moduleGate` + `enabledModules`), so a
  retail tenant does not see them. Retail/B2B isolation therefore exists at nav
  level; `accountMode` (RETAIL/WHOLESALE/ENTERPRISE) comes from feature-flag groups.

## Confirmed real duplicates

1. **FIXED — Two complete product editors.** `/catalog/[id]` (rich 16-tab page)
   vs `/inventory/products/[id]` + `/inventory/products/new` (second editor with
   its own cruder `VariantsTab` — paste-product-IDs textarea; the source of the
   "create variant vs generate variants" inconsistency). Fix shipped: legacy
   routes now `redirect()` to `/catalog/[id]` / `/catalog?new=1`; the duplicate
   `_components` (General/Pricing/Categories/Variants tabs) deleted; all 5
   inbound links (dashboard quick action + top lists, inventory CatalogTab ×2,
   reports/sales) repointed; catalog ProductsTab opens its create modal on
   `?new=1`.
2. **FIXED — Two different Sales reports.** `/reporting/sales` (155-line
   group-by list, linked from ReportsSubNav) vs `/reports/sales` (457-line
   category/customer/product/trend report, linked from main nav). Fix shipped:
   `/reporting/sales` is now an alias of `/reports/sales`, matching its sibling
   alias pages.

## Remaining findings (prioritized)

3. **Promotions vs Discounts split.** `/catalog/promotions` ("Promotion Engine",
   1090 lines, `/api/v1/promotions` + coupons) and `/discounts` ("Discounts",
   167 lines, `/api/v1/discounts`) are separate engines with separate backends.
   PARTIAL FIX shipped: `/ecommerce/promotions` now aliases the promotion engine
   (it pointed at plain discounts). The engine merge itself still needs a
   product decision before code.
4. **FIXED — Reports tree split.** All 13 report pages now physically live under
   `/reports/*`; every `/reporting/*` route is a one-line alias. `ReportsSubNav`
   lists all 13 (Purchases, Cash Movement, Register Closures, Time Cards added —
   they were URL-only dead ends) with canonical hrefs and alias-aware active
   matching; the four moved pages plus End of Day now render the sub-nav.
5. **FIXED — `/catalog/price-book` folded into the Pricing Engine.** The page
   was a complete orphan (zero inbound links) holding customer-specific price
   overrides under a name that collided with the engine's price books. Now a
   "Customer Overrides" tab on `/pricing` (same `/customers/:id/product-prices`
   backend, pricing.manage-gated edit); the old URL redirects to
   `/pricing?tab=customer-overrides` (the page supports `?tab=` deep links).
6. **POS surfaces**: `/terminal` (canonical, aliased by `/sell`), plus
   `/display` (customer display?) and `/store/*` (public storefront) — verify
   purpose labels; no action yet.
7. **RESOLVED — `/bills` is not a duplicate.** It's the purposeful AP Bill List
   (supplier/status filters, auto-drafted on PO receive) linked from the Finance
   nav. FIX shipped: `/finance/bills` alias now points at `/bills` (it pointed
   at the `/finance` hub — wrong target).
8. **Breadcrumbs/back-nav** are inconsistent across detail pages (catalog has
   them; purchasing/[id], orders/[id], customers/[id] vary). Standardize via a
   shared header component.
9. **Two settings trees** — `/setup/*` (15 aliases) vs `/settings/*` (real).
   Aliases fine, but `/settings` itself packs many panes; audit which setup
   aliases point at the right settings section (several all point at the root).

## Verification (fix slice 1)

- PASS: `cd web && npm run typecheck && npm run build` (redirects compile; no
  dangling imports after deleting the duplicate editor's components).
- Grep-verified: zero remaining references to `/inventory/products/*` outside
  the redirect stubs.

## Notes

- The 35 alias pages inflate the "duplicate pages" impression; the true
  duplication was concentrated in findings 1–5.
- Browser e2e remains blocked by the local auth harness (standing constraint).
