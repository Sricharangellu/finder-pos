# Product Module — Enterprise UX/Architecture Review

Grounded, code-verified review of everything under Catalog + Inventory + adjacent
product-detail surfaces, on `develop` as of 2026-07-20. Every finding below cites a
real file/route/table — this document does not repeat the generic "what enterprise
software should have" checklist without checking whether Ascend already has it,
already needs it, or is being asked to copy a feature Ascend's stage doesn't justify
yet (see [[DESIGN_PRINCIPLES]]'s rule zero: evidence beats the charter).

Companion to [`GAPS.md`](GAPS.md) (which already lists the `credits`/receiving/
issues/EDI gaps this doc also touches) and [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## 1. UX audit — what's actually there today

**Structure:** the product surface is NOT one command-center page today. It is
`/catalog` (product list) → `/catalog/:id` (**15 tabs**: general, variants,
overview, pricing, categories, inventory, purchasing [3 sub-tabs], expiry,
transactions [5 sub-tabs], media, ecommerce, compliance, labels, analytics,
audit-log) plus a **parallel, mostly-disconnected inventory tree** of 15 more
routes (`/inventory`, `/inventory/pipeline` [6 tabs], `/inventory/receive-stock`,
`/inventory/counts`, `/inventory/errors`, `/inventory/expiry`,
`/inventory/expiry-pool`, `/inventory/locations`, `/inventory/reorder`,
`/inventory/serials`, plus 6 pure redirect/re-export routes).

**Real problems found (not hypothetical):**

| # | Finding | Evidence |
|---|---|---|
| 1 | **`/inventory/transfers` is a broken redirect** — it re-exports `/operations`, whose only tabs are Locations / Pick Lists / Outlets / Stock-Locations. There is no transfers UI at that URL at all. Real transfer data lives on `/inventory`'s own "Transfers" tab, a completely different page. | `web/app/(protected)/inventory/transfers/page.tsx` → `operations/page.tsx:15` |
| 2 | **Two independent, non-overlapping batch/expiry data models** with zero shared code: `product_batches` table (own module, powers only `/inventory/expiry`) and `inventory_lots` table (inventory module, powers `/inventory/expiry-pool` AND catalog's per-product Expiry tab AND the real receive/FEFO flow). A user managing expiry has **3 different pages that don't reconcile with each other** because they read from 2 different tables. | `src/modules/product_batches/index.ts` vs `src/modules/inventory/index.ts:86` — no cross-reference between the two anywhere in either module |
| 3 | **6 routes are pure re-exports or dead redirects, adding navigation clutter with zero unique functionality, and zero incoming links anywhere in the codebase** (verified via grep — nothing else references them): `/catalog/products` (= `/catalog`), `/catalog/gift-cards` (= `/gift-cards`), `/catalog/suppliers` (= `/vendors`), `/inventory/count` (= `/inventory/counts`), `/inventory/returns` (= `/returns`), `/inventory/products/:id` and `/inventory/products/new` (dead legacy redirects, replaced by `/catalog`). | grep across `web/app/(protected)/catalog/*/page.tsx`, `inventory/*/page.tsx` — confirmed zero `<Link>`/`router.push` references to any of these 6 paths |
| 4 | **No pagination UI on the two most-used list pages**, despite the backend supporting it. `ProductsTab.tsx` hardcodes `limit=50&offset=0` — there is no button to reach product 51 in a catalog of thousands. `inventory/page.tsx`'s movements table has the same gap. | `catalog/_components/ProductsTab.tsx:246` |
| 5 | **No shared enterprise data-table component.** `web/components/Table.tsx` (the only generic table primitive) has no sort, no filter, no pagination, no column resize/pin, no saved views, no row selection. Every page (`ProductsTab`, `inventory/page.tsx`, `promotions/page.tsx`, `pricing/page.tsx`) hand-rolls its own `<table>`, filter bar, and sort logic — visually consistent (copy-pasted Tailwind) but functionally duplicated 4+ times. | `web/components/Table.tsx` (109 lines, read in full) |
| 6 | **5+ pages exist but are not linked from primary nav** — reachable only by typing the URL: `/inventory/locations`, `/inventory/counts`, `/inventory/reorder`, `/inventory/serials`, `/catalog/categories/:id`. | `EnterpriseShell.tsx:144-175` |
| 7 | **Two frontend TypeScript interfaces model the same `products` row** (`Product` and `CatalogProduct`, overlapping but non-identical fields) — a maintenance hazard, not yet a bug. | `web/api-client/types.ts:638+, 1079+` |
| 8 | **`/catalog/:id/credits` tab has no backend at all** (already tracked in GAPS.md) — no schema concept of a product-level credit exists anywhere. | confirmed via grep, no route |
| 9 | Inventory Pipeline's **Receiving / Issues / Errors / Summary-funnel tabs are UI-only** — GET+PATCH only, no detection engine, no receiving-session concept in the schema (already tracked in GAPS.md as NEEDS-SRI). | `docs/architecture/GAPS.md` |

**What's already good and should NOT be touched:** the 71-column XLSX import
mapping, the price-tier/price-history schema, the multi-UPC `product_barcodes`
table, the per-location `inventory_stock` model (a real, already-correct upgrade
over the legacy flat `inventory` table, with a working backfill), and the
module-ordering fix for `serial_numbers`/`inventory` mount collision. These are
solid foundations — the review below builds on them, it does not propose
replacing them.

---

## 2. UI improvement report (Phase 2/10-12 findings, evidence-gated)

Cognitive-load problems that are real (not hypothetical Shopify-comparison items):

- **15 tabs on one page with no grouping visible in the tab bar itself** — the
  code groups them internally (`core | inventory | activity | content |
  insights`, `catalog/[id]/page.tsx:43-59`) but nothing in the rendered UI shows
  that grouping to the user; it's flat.
- **"Transactions" tab has 5 of its own sub-tabs** (Sales, By Customer, Returns,
  Credit Notes, Purchase Invoices) and **"Purchasing" tab has 3** — a
  tab-inside-a-tab pattern that adds a full extra click+wait to reach data that
  could be flattened or merged into fewer top-level destinations.
- **No page-size control anywhere** in catalog/inventory — Phase 10/11's ask is
  not a "nice to have," it's a page-51-is-unreachable bug for any tenant with
  more than 50 products in a category.
- **Density/compact-mode, column pinning, saved views**: none of these exist
  because the underlying `Table` component doesn't support them — this is a
  component-layer gap, not a per-page styling gap. Building one shared
  `DataGrid` fixes it everywhere at once (see §11 Component changes).

---

## 3. Architecture recommendations

1. **Retire `/inventory/expiry`, do NOT migrate its data into `inventory_lots`
   (corrected after investigation, 2026-07-21).** This section originally
   proposed backfilling `product_batches` rows into `inventory_lots` as a
   straightforward table merge. Reading `product_batches/service.ts` closely
   before writing that migration surfaced a real risk it missed: `createBatch`
   never touches `inventory_stock`/`inventory` at all — a "batch" created
   through `/inventory/expiry` has **zero relationship to real on-hand
   quantity anywhere else in the system**. `inventory_lots`, by contrast, is
   the live operational ledger — its `qty_on_hand` is depleted by real sales
   (FEFO), credited by the real receive pipeline, and swept into
   `expiry_writeoffs` with accounting loss entries. Backfilling
   `product_batches.qty` into `inventory_lots.qty_on_hand` would have injected
   **phantom sellable stock** into the real depletion engine — quantities a
   user typed into a form, not stock that was ever actually received. Sri
   confirmed: retire the disconnected page (redirect `/inventory/expiry` →
   `/inventory/expiry-pool`), leave the `product_batches` table and any
   existing rows untouched (no data loss, no migration, no phantom-stock
   risk). If a real need for a standalone batch-tracking feature resurfaces,
   it should be built to actually credit `inventory_stock` on creation, not
   merged into the FEFO engine's own ledger.
2. **Build one shared `DataGrid` component** (sort, filter, pagination with a
   page-size selector, column visibility, row selection) to replace the
   4+ hand-rolled table implementations. This is the single highest-leverage
   architecture change: every list page in catalog/inventory (and eventually
   reports, purchasing, sales) inherits pagination/sort/filter for free instead
   of each page reinventing it.
3. **Consolidate `Product`/`CatalogProduct` frontend types** into one shared type
   (superset of both), used by both the list and detail views.
4. **Do not merge the backend routes.** The backend's module boundaries
   (catalog, inventory, product_batches, serial_numbers) are architecturally
   sound per [[DESIGN_PRINCIPLES]] (module owns its data/routes/tests) — the
   problems found are entirely in (a) which table backs a concept and (b) how
   the frontend organizes pages, not in backend module structure. Resist the
   temptation to also restructure the backend module tree; that would be a
   much larger, unjustified blast radius for a UX problem.

---

## 4. Business logic improvements

- **Pagination is a correctness issue, not cosmetic**: a tenant cannot currently
  reach products 51+ through the UI. Fix regardless of anything else in this
  doc — it's the most defensible "Critical" item here.
- **Fix the `/inventory/transfers` redirect** to point at `/inventory?tab=transfers`
  instead of `/operations` — a one-line, zero-risk correctness fix for a broken
  navigation path.
- **Retiring `/inventory/expiry`** (above) removes a worse correctness risk
  than "two pages disagree" — it was actively misleading users into thinking a
  manually-entered batch quantity reflected real stock, when it never did.

---

## 5. Missing enterprise features — evidence-gated, not a wishlist copy

The prompt's Phase 17 list (PLM, AI enrichment, product versioning, approval
workflows, multi-currency, kits/bundles, DAM, etc.) is real enterprise-software
territory, but per [[ascend-cto]] doctrine, **"it's in Shopify Plus/NetSuite" is
not evidence of need** — each of these is a multi-week-to-multi-month build.
None of them are declined here; they are correctly triaged as **NEEDS-SRI**
(a business/scope decision, not an engineering one) rather than silently built:

| Feature | Why it's NEEDS-SRI, not auto-built |
|---|---|
| Product kits/bundles | Real demand signal exists (promotions module already has "Bundle Rules" — `catalog/promotions/page.tsx`) but no product-level kit/BOM concept exists in the schema. Needs a decision: extend `products` with a kit flag + component table, or is this covered by manufacturing's BOM concept already? |
| Product versioning / approval workflows | `approval_chains`/`workflow_run_history` tables already exist and are real (per GAPS.md) but nothing invokes them for product changes — this is the SAME open item GAPS.md already tracks ("which real action should check a chain"), not a new build. |
| Multi-currency pricing | No currency column anywhere in the pricing tables today — a genuine new-scope item, not a gap in existing work. |
| AI-assisted enrichment, DAM, PLM-as-a-formal-discipline | No existing partial implementation to extend; these are net-new, large scope. Do not start without a business case — Ascend's current stage (per [[ascend-cto]]: "could 20 engineers operate this?") does not yet show evidence these are the bottleneck versus the correctness/pagination/duplication issues above. |

**Recommendation:** ship the evidence-based fixes (§3, §4) first; revisit this
table only when a specific one of these is blocking a real deal or workflow.

---

## 6. Screens/pages that should be merged or removed

**Remove outright (pure duplicates/dead code, zero functionality lost, zero
incoming references verified):** `/catalog/products`, `/catalog/gift-cards`,
`/catalog/suppliers`, `/inventory/count`, `/inventory/returns`,
`/inventory/products/:id`, `/inventory/products/new`.

**Adjacent finding, out of scope for this Product-module review:** the entire
`reporting/*` tree is *also* a pure re-export alias of `reports/*` — but unlike
the routes above, it **is** actively linked from `DashboardKpiSection.tsx` and
`finance/page.tsx` (9 references, verified via grep, one with a name mismatch —
`/reporting/closing` → `reports/end-of-day`, not `reports/closing`). Removing
it requires updating those 9 call sites first; it belongs to the Reports
module's own cleanup, not this one. Flagged in `GAPS.md` for that module's
future review, not fixed here.

**Fix, don't remove:** `/inventory/transfers` — repoint the redirect target to
the real transfers tab instead of deleting the route (it's a reasonable URL
for users to expect).

**Retire, don't merge (corrected 2026-07-21, see §3.1):** `/inventory/expiry`
now redirects to `/inventory/expiry-pool`. No schema merge — `product_batches`
was never tied to real stock, so there's nothing safe to merge; the table and
its rows are left untouched, just no longer surfaced through this page.

**Do NOT merge** (each already has a distinct real backend, despite living
inside `/catalog/:id`'s 15 tabs): Pricing, Purchasing, Expiry, Media, Compliance,
Labels are correctly separated already at the *tab* level — the problem is tab
*count and grouping*, not that they exist. See IA redesign below for grouping,
not deletion.

**Nav visibility fix (no page changes needed, just add links):** surface
`/inventory/locations`, `/inventory/counts`, `/inventory/reorder`,
`/inventory/serials` in the Inventory nav section — they're built and real,
just invisible.

---

## 7/8. New navigation hierarchy + redesigned Product Information Architecture

**Correction after implementation (2026-07-20):** this section originally
proposed a full two-level tab bar (group row → sub-tab row) before reading
`catalog/[id]/page.tsx` closely. The actual code already has more grouping
than assumed: a `GROUP_BREAKS`/divider mechanism from an earlier consolidation
pass (the file's own comment: "14 tabs (down from 21)") renders a thin visual
separator between groups — the real gap was that the divider was silent (no
label), not that grouping was entirely absent. A full two-level bar would have
been a materially bigger rewrite (new state for which group is expanded,
new mobile/scroll behavior, retested click paths) for a smaller marginal gain
than initially scoped — not justified once the existing code was actually
read. **Shipped instead:** a small uppercase group label (Core / Inventory /
Activity / Content / Insights) at each existing divider, same single-row tab
bar, zero change to click behavior or `activeTab` state. This directly
addresses the real finding ("nothing in the rendered UI shows the grouping")
without the larger, less-justified rewrite.

```
Product [name] ── Product Details · Master & Variants · Overview · Pricing · Categories
  │ INVENTORY │ Inventory · Purchasing · Expiry
  │ ACTIVITY  │ Transactions
  │ CONTENT   │ Media · Online · Compliance · Labels
  │ INSIGHTS  │ Analytics · Audit Log
```

(One row, scrollable — the diagram above shows the grouping the labels now
make visible, not a literal multi-row layout.)

**Inventory nav fix** (§6): add the 4 orphaned pages to the sidebar under
Inventory. No IA redesign needed there — the pages are fine, they're just
unlinked.

---

## 9. Database impact

| Change | Migration shape |
|---|---|
| Everything in this doc, including the retired `/inventory/expiry` page | **Zero schema changes.** `product_batches` and its rows are left exactly as they were — no migration, no backfill, no drop. Route removal, redirect fixes, nav links, `Pagination`/keyset-cursor work, and tab-bar labels are all frontend/route-layer only. |

---

## 10. API changes

**None required anywhere in this doc.** The `product_batches` backend module
(routes, service, table) is untouched — only the frontend page that surfaced
it was retired. Its 5 routes remain live and unchanged in case anything else
ever calls them directly; no deprecation window needed since nothing was
removed from the API surface.

---

## 11. Component changes

**New:** `web/components/DataGrid.tsx` — sort, client-or-server-driven filter,
pagination (page-size selector: 25/50/100/250/500/1000/All, remembered via
`localStorage` per user, matching Phase 11's ask), column visibility toggle,
row selection + bulk-action slot. Built once, adopted incrementally starting
with `ProductsTab.tsx` (highest-traffic page) and `inventory/page.tsx`.

**Changed:** `catalog/[id]/page.tsx`'s tab bar becomes two-level (§7/8) —
same 15 tab components underneath, just regrouped in the render.

**Removed:** the 8 redirect/re-export page files (§6) and their route folders.

**Not changed:** every tab's own component (`GeneralTab.tsx`, `PricingTab.tsx`,
etc.) — none of them are being rewritten, only re-grouped in the parent tab bar.

---

## 12. Step-by-step implementation roadmap (dependency-ordered)

| Phase | Work | Depends on |
|---|---|---|
| 1 | Remove 6 dead/duplicate routes; fix `/inventory/transfers` redirect; add 4 orphaned pages to nav | Nothing — **shipped** (PR #106) |
| 2 | `Pagination` component; adopted in `ProductsTab.tsx` (fixes the "can't reach product 51" issue) | Nothing — **shipped** (PR #106) |
| 3 | Group labels on `catalog/[id]/page.tsx`'s existing tab-divider mechanism (corrected scope, see §7/8) | Nothing — **shipped** |
| 4 | Keyset cursor pagination added to `inventory.listTransfers` (was a flat `LIMIT 200`, worse than catalog's gap — no pagination mechanism at all); shared "Load more" button wired across `/inventory`'s Orders/Transfers/Returns tabs, all three now the same envelope shape | Nothing — **shipped** (PR #108) |
| 5 | ~~Batch/expiry data migration~~ → **retired `/inventory/expiry`, no migration** (corrected 2026-07-21, see §3.1): investigation before writing the migration found `product_batches` has zero connection to real stock — merging it into `inventory_lots` would have injected phantom sellable quantity into the live FEFO engine. Redirected the page instead; `product_batches` table/data untouched | Nothing — **shipped** |
| — | Consolidate `Product`/`CatalogProduct` types | Can happen any time; touches both list and detail views. Only remaining item from this review with no fixed priority yet |

---

## 13. Priority matrix

| Priority | Items |
|---|---|
| **Critical** | Pagination on `ProductsTab` (Phase 2) — real usability ceiling on any catalog >50 items — **done** |
| **High** | Dead-route removal + broken transfers redirect fix (Phase 1) — zero risk — **done** |
| **High** | Retire `/inventory/expiry` (Phase 5, redefined) — was silently misleading users with phantom-stock-looking data — **done** |
| **Medium** | Tab-bar group labels (Phase 3) — real cognitive-load win, no correctness risk — **done** |
| **Medium** | Nav visibility fixes for orphaned pages (Phase 1) — **done** |
| **Medium** | Keyset pagination for `inventory` transfers/returns + shared Load-more (Phase 4) — **done** |
| **Low** | `Product`/`CatalogProduct` type consolidation — maintenance hygiene, no user-facing effect |
| **Deferred (NEEDS-SRI)** | Everything in §5's table — no build without a business decision first |

---

## 14. Estimated implementation complexity

| Item | Complexity | Why |
|---|---|---|
| Dead-route removal + redirect fix | **Trivial** (hours) | Delete files, one-line redirect change, no tests needed beyond a build check — **done** |
| Nav links for orphaned pages | **Trivial** (hours) | Config-only change in `EnterpriseShell.tsx` — **done** |
| `Pagination` component + `ProductsTab` adoption | **Small** (under a day, smaller than originally estimated) | Backend already supported `limit`/`offset` — just needed a reusable control + wiring, not a full data-grid rewrite — **done** |
| Tab-bar group labels | **Trivial** (under an hour, smaller than originally estimated) | Once the code was read, a full two-level bar wasn't justified — the existing divider mechanism just needed a label, not a rewrite — **done** |
| Keyset pagination for `inventory` transfers | **Small** (much smaller than originally estimated) | `listTransfers` just needed the same `shared/pagination.ts` pattern already used by `listMovements`/`listOrders`/`listReturns` — a few lines, not a redesign — **done** |
| Retire `/inventory/expiry` | **Trivial** (much smaller than the original "Large" migration estimate) | Investigation revealed the "migration" would have been actively dangerous (phantom stock), not just large — the real fix was a redirect, zero data movement — **done** |
| Type consolidation | **Small** | Mechanical, but touches many call sites — needs a full typecheck pass |

---

## 15. Before vs. after

**Before (today):**
```
/catalog ──▶ /catalog/:id (15 flat tabs, no page-size control)
/inventory ──▶ 15 more routes, 6 of them dead redirects,
               1 of them broken (transfers → operations, no transfers tab there),
               4 of them invisible (not in nav),
               2 parallel expiry systems that don't agree with each other
```

**After (shipped, PRs #106–#108 + the expiry retirement):**
```
/catalog ──▶ /catalog/:id (15 tabs, now labeled into 5 groups; ProductsTab
              has real page-size pagination — was hard-capped at 50)
/inventory ──▶ 9 real routes, all linked in nav, transfers redirect fixed,
               transfers/orders/returns share one keyset-paginated envelope,
               /inventory/expiry retired (redirects to the real system —
               product_batches was never tied to actual stock, so there was
               nothing safe to merge, only a misleading page to stop showing)
```

---

## 16. Final recommendation

Shipped in dependency order: Phase 1 (dead-route removal, redirect fix, nav
links) first since it was zero-risk and answered "can this be merged/removed"
with verified duplication, not guesswork. Then the `Pagination` component
adopted in `ProductsTab` — the single highest-priority fix, since catalogs
over 50 items had no way to reach the rest of their inventory at all. Then
tab-bar group labels, corrected down from an originally-proposed full
two-level rewrite once the existing code turned out to already have most of
the needed structure. Then keyset pagination for `inventory` transfers, which
turned out to have *no* pagination at all (worse than catalog's unused-support
gap). The batch/expiry item is the clearest lesson from this review: the
original recommendation (migrate `product_batches` into `inventory_lots`) was
sound-looking from a schema comparison alone, but reading the actual service
code before writing the migration surfaced that `product_batches` was never
wired to real stock — merging it would have created phantom sellable
inventory. The fix that shipped (retire the page, touch no data) was smaller,
safer, and only findable by reading the code, not by comparing table shapes.
Defer Phase 17's larger feature wishlist to NEEDS-SRI — Ascend's current
bottleneck, per this audit's actual evidence, was duplication, missing
pagination, and one actively misleading page, not a shortage of
PLM/AI/kit-building features.
