# Ascend Retail — Product Module Enhancement Report

Date: 2026-07-13
Basis: code inspection of `src/modules/catalog` (75+ product fields, 49 passing
module tests), the product page (`/catalog/[id]`, 17 tabs), and this week's
consolidation work (one product editor, unified variant engine, bulk price/cost
engine). Benchmark: the reference ERP Product module supplied. Verdicts:
**Adopt / Redesign / Enhance / Simplify / Merge / Reject** — retail (B2C) only.

## 0. Where Ascend already meets or beats the reference

Verified in code, not aspiration: single product master with SKU/UPC/extra
barcodes (`product_barcodes`), brand/manufacturer/model/tags, multi-category
M2M + tree, SEO (url_alias, meta title/keywords/description), dimensions/
weight/size, MSRP + min-selling-price + cost, margin & markup auto-calc
(PricingTab), qty sell limits, media gallery with sort/primary/alt
(`product_images`), structured variant engine with non-destructive matrix
regeneration + per-channel variant ordering (ahead of the reference), variant
setup wizard (SKU/UPC → pricing → categories), bulk ops (status/online/price ±%
/round-.99, ≤500 ids), CSV import/export, label printing, duplicate product,
EAN-13 auto-barcode backfill, audit-log tab, analytics tab, ecommerce
publishing (online title/desc/price per product), age restriction, expiry
(FEFO cache), preferred vendor + vendor UPC + reorder qty, command-palette
global search.

## 1. Product Header — ENHANCE (small)

Has: status badge, tabs, Quick Sell action. Worth adding, in order:
**breadcrumb (Catalog → Category → Product)**, **Save & New** on the create
modal (retail teams enter products in runs), and a compact **activity strip**
(last 3 audit events, linking to the Audit Log tab). Reject: Save & Continue
(tabs already persist per-tab), separate Delete (archive is the retail-safe
verb and exists).

## 2. General Information — ADOPT 3 fields, REJECT the rest

- **ADOPT `launch_date` / `discontinue_date`** (verified absent). Retail needs
  seasonal set/sunset; pairs with lifecycle automation (§14).
- **ADOPT `internal_notes`** (buyer-facing, never rendered in storefront).
- Pack/case-pack: already covered (`unit_description`, qty_increment,
  min/max sell) — **MERGE**, no new fields.
- Tobacco/MSA/nicotine fields exist but are correctly isolated behind the
  compliance tab and module gating — **keep out of Retail UI** (already are);
  do not generalize into a "compliance framework" until a second regulated
  vertical demands it (**REJECT for now**).

## 3. Categories — ENHANCE via tags, not new trees

Multi-category M2M + tree exist. The reference's collections/merchandising
groups are, for retail scale, **saved product filters**. Ascend already has
`tags` on products: **ENHANCE** by making tags first-class in the catalog
filter bar + storefront ("Featured", "Summer"). **REJECT** a separate
collections engine — it would duplicate categories + tags with a third
grouping mechanism.

## 4. Pricing — ADOPT price history + scheduled prices surface; REJECT B2B

- **ADOPT — product price-change history.** Verified absent (only PO-side
  `product_costs`). Cheapest correct design: no new writes path — subscribe to
  the existing `product.updated` event (payload already carries changed
  `price_cents`) and append to a `product_price_history` table; render as a
  Pricing-tab timeline. Enterprise auditability with zero new UI writes.
- **ENHANCE — scheduled/clearance pricing.** The Pricing Engine already has a
  Scheduled tab (`/api/v1/pricing/scheduled`); the *product page* doesn't show
  upcoming scheduled changes. Surface a read-only "upcoming price changes"
  card on the product Pricing tab. Clearance = a scheduled price + a tag; no
  new engine.
- **ADOPT (light) — price approval.** Reuse the `po_approvals` pattern only if
  asked; margin-floor guardrails already exist (margin-rules tab). **DEFER.**
- **REJECT:** wholesale tiers, customer price levels, dealer/distributor
  pricing — explicitly out per retail rules. Note: `wholesale_price_cents` /
  `enterprise_price_cents` columns exist at the data layer for the wholesale
  package; they are not shown in retail UI and must stay that way (add to the
  package-isolation CI guard from the ERP gap analysis).
- MAP (min advertised): a single optional column with a POS/storefront floor
  warning — **ADOPT only on request** (uncommon below mid-market retail).

## 5. Inventory — ENHANCE visibility, REJECT bin logic

Has: on-hand, lots/expiry, movements ledger w/ costs, transfers, counts,
reorder point + suggestions→draft POs, serials/IMEI. Gaps worth taking:
- **ENHANCE — availability breakdown on the product Inventory tab:**
  on-hand / reserved (open orders) / incoming (open PO lines) / available.
  All three inputs exist (order lines, po lines received_qty); this is a
  read-model, not new state.
- **ADOPT — safety-stock field** distinct from reorder point (forecasting
  input); reorder suggestions already exist to consume it.
- **REJECT:** bin/shelf locations (warehouse-package scope), damaged/quarantine
  buckets (arrives with the GRN slice of the procurement PRD — don't build
  twice).

## 6. Product Relationships — ADOPT one table, one tab

Verified absent (no related/cross-sell/bundles beyond a `composite_product`
flag). Retail-right design: **one `product_relations` table**
(product_id, related_id, kind: related|accessory|replacement|upsell) + a
"Related" product tab + storefront "You may also like". **REJECT** separate
bundles/kits/gift-sets engines for now — bundles belong to the BOM decision
already logged in the ERP gap analysis; "frequently bought together" as an
*automated* feature is an analytics job to schedule later (§16 of ERP doc).

## 7. Media — ENHANCE ordering UI; DEFER pipeline

Table supports sort/primary/alt; **ENHANCE** the Media tab with drag-reorder +
set-primary (reuse the variant drag pattern). Videos/360/documents:
**ADOPT** a `media_type` column when a customer supplies such assets — schema
tweak, not a build. Compression/CDN: **REJECT** in-app; that's the hosting
layer's job (Vercel/静 asset host).

## 8. Variants — already ahead; two ENHANCEs

Reference parity achieved this week (structured options, non-destructive
regen, wizard, bulk edit, per-channel ordering, hyphen-free naming). Remaining:
- **ENHANCE — per-variant images** (product_images already keys by product_id;
  variants are products — the gap is only a "use parent images" fallback
  toggle in the storefront read path).
- **ENHANCE — variant drag-reorder UI** calling the existing
  `reorderVariants` endpoint (backend shipped in PRD #3, UI deferred then).

## 9. Product History — ADOPT the two cheap composites

Has: audit-log tab (writes), analytics, movements. **ADOPT:** price history
(§4) and a **unified timeline tab** that interleaves existing sources
(audit log + movements + price history + PO receipts) — read-only composition,
no new writes. **REJECT** version-restore: append-only audit + archive status
covers retail risk without snapshot machinery.

## 10–13. Connections (Purchasing / Sales / Ecommerce / Accounting)

- Purchasing: preferred vendor, vendor UPC, lead time, reorder→draft PO, PO
  price history all exist. **ENHANCE:** show "last purchase cost" (from
  `product_costs`) next to cost on the Pricing tab — one query.
- Sales/POS: covered (deduction, returns, discounts, promotions, loyalty,
  gift cards). Layaway: **REJECT** (niche; service_orders covers holds).
- Ecommerce: publishing/online fields/coupons exist; reviews/ratings verified
  absent — **ADOPT later** only with moderation workflow, storefront-first.
- Accounting: the new posting ledger (5e00451) posts inventory/COGS-relevant
  entries at the flow level. **ADOPT (small):** optional per-category account
  override map (category → revenue/COGS accounts) instead of per-product
  account dropdowns — retail-simple, one settings table. **DEFER** until
  ledger adoption proves demand.

## 14. Lifecycle — ENHANCE with two automations

Has: draft/active/archived (+ online visibility as a separate axis — richer
than the reference's single enum; keep). **ADOPT:** `launch_date`/
`discontinue_date` driving automatic activate/archive via the existing
background-jobs runner. **REJECT** pending-approval product states until a
customer with a merchandising team asks.

## 15. Search & Productivity — ADOPT saved views; recents

Has: global palette, filters, sort, bulk bar, import/export, duplicate.
**ADOPT:** saved catalog views (serialize the existing filter state — same
mechanism recommended for reports) and recent products in the palette
(localStorage). **DEFER:** pinning, split views.

## 16. Automation — three concrete adoptions

1. **Auto-SKU on create** (pattern exists in `nextVariantSku` — generalize to
   a tenant SKU pattern setting).
2. **Lifecycle dates job** (§14).
3. **Validation lint on activate:** block activating a product missing
   image/barcode/cost (configurable checklist) — cheap data-quality gate.
**REJECT:** AI descriptions/image optimization in-core (integration surface,
not module code).

## 17–18. Pages & Navigation

Post-consolidation the architecture is sound (one editor, 17 grouped tabs,
wizard). Remaining moves: **MERGE** the Compliance tab out of retail nav when
`accountMode=RETAIL` and no regulated flags are on (it's noise for a gift
shop); **breadcrumbs** (§1); **traceability chips** on Purchasing/Transactions
tabs → the PO/order documents (part of the ribbon item in the ERP gap doc).

## 19. Ranked adoption list (retail product module)

1. Product price-change history (event-driven table + Pricing-tab timeline).
2. Availability breakdown (on-hand/reserved/incoming/available) on Inventory tab.
3. `launch_date`/`discontinue_date` + lifecycle job; `internal_notes`.
4. Related products (one table, one tab, storefront block).
5. Variant drag-reorder UI + per-variant image fallback.
6. Saved catalog views + palette recents; Save & New; breadcrumb.
7. Activate-validation checklist; auto-SKU setting.
8. Media drag-reorder/set-primary; media_type column.

**Rejected (explicit):** wholesale/customer/dealer tiers in retail, collections
engine, bin locations, version restore, layaway, in-app image pipeline/CDN,
AI content generation in-core, tobacco-field generalization.

**Isolation note:** wholesale price columns exist at the data layer only; the
package-isolation CI guard (ERP gap doc §14) should also assert retail pages
never render `wholesale_price_cents`/`enterprise_price_cents`.
