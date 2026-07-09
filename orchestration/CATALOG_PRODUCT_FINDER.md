# Catalog / Product Ascend — benchmark & gap notes

**Source:** a feature audit of the Salesgent ERP "Products" module (Product
Ascend list + 10-tab product editor), pasted as a full build spec.

**How to read this doc:** like `ERP_BENCHMARK.md`, this is **inspiration
only** — a feature menu, not a spec Ascend must match. Ascend is a
standalone retail/wholesale POS, not a generic ERP, so several items below
are deliberately **out of scope** (multi-company context switcher, MSA
tobacco-compliance fields, IMEI tracking, drop-shipment, a 10-tab editor for
every SKU). The goal of this doc is to pull out the subset that makes
Ascend's existing `/inventory` catalog genuinely more useful, and turn that
subset into roadmap items — not to chase 1:1 page parity.

Updated: 2026-06-14.

---

## Where Ascend's catalog stands today

- **Data model** (`src/modules/catalog`): `products` (sku, name, price_cents,
  category *(flat string)*, tax_class, barcode, status) + `product_barcodes`
  (multi-UPC per product, with pack_size for case/box scans).
- **Frontend** (`web/app/(protected)/inventory/page.tsx`): catalog-driven
  operations screen — search, category/status filter (flat dropdowns), stock
  KPIs, low-stock triage, a selected-SKU detail panel, margin column
  (FE-1). No create/edit form, no categories tree, no images, no variants,
  no bulk actions.
- **Inventory levels** (`GET /api/v1/inventory/levels`): onHand, committed,
  available, reorderPoint, costCents, velocity — already covers most of the
  spec's "Inventory Status" tab in list form.

## Mapping the spec to Ascend

| Spec area | Status | Verdict for Ascend |
|---|---|---|
| Ascend list: search/sort/pagination | 🟡 | Have search+filter+KPIs on `/inventory`; missing pagination (catalog is small per tenant today) and column customization. **Low priority** — revisit if tenant catalogs grow. |
| Filter drawer (UPC/SKU/Name/Brand/Tags/Category tree/Status) | ⬜ | **Worth building** once categories are a tree and `brand`/`tags` exist (see BE-6). Folds into the existing inline filters rather than a separate drawer. |
| Column settings (show/hide/reorder, persisted) | ⬜ | **Nice-to-have, low priority.** Ascend's inventory table has ~8 columns; not yet painful. Defer. |
| Bulk actions (8: bulk field update, bulk image, bulk barcode, bulk inventory insert, master-child mapping, import, export, update) | ⬜ | **Worth building a useful subset:** bulk status/category update, CSV import/export, bulk barcode generation (BE-7). Skip "bulk image" and "insert bulk inventory" as separate flows — image upload and inventory adjustments already have (or will have) dedicated single-item flows. |
| Product detail — GENERAL tab (UPC/SKU/name/URL alias/short+full description/brand/model/size/dimensions/weight) | ⬜ | **Worth building**, trimmed: name, SKU, barcodes (existing), description (plain text, not WYSIWYG), brand, dimensions/weight as optional fields (BE-6 + FE-8). Skip URL alias (no storefront page yet — ties to ecommerce module separately), WYSIWYG rich text (overkill for a POS product description), nicotine/volume/MSA fields (regulatory niche, add only if a tenant actually needs it). |
| CATEGORIES tab (tree, multi-select) | 🟡→build | Ascend's `category` is a flat string. **Worth building:** a real category tree (`categories` table with `parent_id`) + many-to-many `product_categories`, surfaced as a tree-select on the product editor (BE-6 + FE-8). |
| PRICE tab (cost/price/margin/markup live recalc, 5 price tiers, customer-specific pricing, update-child-price) | 🟡 | Margin already shown read-only (FE-1). **Worth building:** live cost/price/margin/markup editing on the product editor (FE-8). Tiered pricing (Tier1-5) and customer-specific pricing are already tracked as Wave B in `ERP_BENCHMARK.md` — don't duplicate, just make sure FE-8's Price tab is ready to consume that contract when it lands. |
| MANAGE QTY tab (min/max qty to sell, qty increment) | ⬜ | **Small, worth adding** as fields on the product editor's Inventory section (BE-6 + FE-8) — useful for case-pack-only SKUs. |
| ACCOUNTING tab (income/expense/inventory-asset account links, permission-gated) | ⬜ | **Defer** until Chart of Accounts (ERP_BENCHMARK Wave C / accounting module) is further along; then link `products.income_account_id` etc. Not blocking. |
| MARKETING tab (linked/related products) | ⬜ | **Skip for now** — no storefront cross-sell surface yet; revisit alongside the ecommerce module. |
| INVENTORY tab (status + location sub-tabs, min/reorder qty, track-inventory flags, preferred vendor, drop-shipment, vendor UPC) | 🟡 | Mostly covered by `/api/v1/inventory/levels` + purchasing suppliers. **Worth adding:** `preferred_vendor_id` and `vendor_upc` on a product (useful for PO creation). Skip IMEI tracking, drop-shipment, bin/location sub-tab (fulfillment module already owns locations — see FE-4 on the roadmap). |
| IMAGE tab (multi-image, reorder, primary) | ⬜ | **Worth a minimal version:** one `image_url` per product, shown in the inventory grid/detail panel (BE-6 + FE-8). Multi-image gallery/reorder — defer until there's real image storage (S3/Blob) wired up. |
| VARIANTS tab (master/child products) | ⬜ | **Worth building**, this is the highest-value item for tenants selling flavored/sized SKUs (vapes, drinks, apparel): `parent_product_id` + `variant_label` on `products`, master rows ($0 price / 0 qty) visually distinguished in the list (BE-8 + FE-9). |
| HISTORY tab (audit log + sales/purchase history) | 🟡 | `audit_log` already exists tenant-wide (identity module). **Worth building:** a per-product audit view + a "where used" list (recent order lines / PO lines referencing this SKU) — both are read-only queries against existing tables. Lower priority than variants/categories. |
| Ecommerce flag + sync | 🟡 | Ascend already has an `ecommerce` module/outlet concept. Adding a per-product `ecommerce` boolean is cheap; the *sync pipeline* itself stays out of scope until the ecommerce module needs it. |
| Multi-company context switcher | ⬜ | **Out of scope.** Ascend's tenant = the company; `storeIds[]`/outlets (ERP_BENCHMARK #18, BE-4) already covers multi-store within a tenant. A second switcher on top of that would be confusing. |
| MSA / tobacco compliance fields, nicotine/volume tooltips | ⬜ | **Out of scope by default.** The spec/validation schema shouldn't hard-require these; if a convenience-store tenant needs them, add as optional `metadata` JSON rather than dozens of dedicated columns. |

---

## What this turns into on the roadmap

Added to `ROADMAP.md` (appended, not reordering existing items):

- **BE-6** — Category tree + product detail fields (description, brand,
  dimensions/weight, image_url, preferred vendor/vendor UPC, min/max/qty
  increment).
- **BE-7** — Bulk catalog operations: bulk field update, CSV import/export,
  bulk barcode generation.
- **BE-8** — Master/child product variants.
- **FE-7** — Catalog filter/bulk-select UI on `/inventory` (category tree
  filter, row selection, bulk actions menu) consuming BE-6/BE-7.
- **FE-8** — Product detail/edit page (General, Categories, Price, Manage
  Qty, Image) consuming BE-6.
- **FE-9** — Variants UI: master/child editor + list-row distinction,
  consuming BE-8.

Everything else in the table above (URL alias, WYSIWYG descriptions, MSA
fields, accounting-account links on products, marketing/linked-products,
multi-company switcher, drop-shipment/IMEI, multi-image galleries) is
explicitly **not** on the roadmap. If a future need makes one of these
valuable, add it as a new roadmap item with its own justification rather than
treating this spec as a checklist to complete.
