# Catalog & products

## Product types

| Type | When to use |
|---|---|
| Simple product | Single SKU, single price — most common |
| Product with variants | One product, multiple options (size, color, flavor) |
| Bundle / kit | Multiple SKUs sold together at a combined price |
| Service item | No inventory; used for appointments or repairs |

## Adding a product

1. Go to **Inventory → Catalog → New product**
2. Fill in:
   - **Name** — shown on receipts and the POS screen
   - **SKU** / **Barcode** (EAN-13 or UPC-A) — scan or type; auto-generated if blank
   - **Price** (in dollars; stored as integer cents internally)
   - **Tax class** — Standard or Exempt
   - **Category** — used for reports and menu grouping (restaurant)
   - **Status** — Active, Draft, or Archived
3. Optional: **Cost price** (for margin reports), **Reorder point**, **Supplier**
4. Click **Save**

## Variants

On the product detail page, go to the **Variants** tab:
1. Click **Add variant**
2. Enter the variant label (e.g. "12oz", "Red")
3. Set the variant's own SKU, barcode, and price override (leave price blank to inherit)
4. At the POS, selecting the parent product opens a variant picker

## Bulk import

**Inventory → Catalog → Import CSV**

Download the template, fill it in, and upload. Required columns: `name`, `sku`, `price_cents`, `tax_class`. Optional: `barcode`, `category`, `cost_cents`, `reorder_point`.

Rows with duplicate SKUs update the existing product (upsert). Invalid rows are listed in an error report — partial imports succeed.

## Compliance fields (tobacco / vape / cannabis)

For regulated products, go to the product's **Compliance** tab:
- `tobacco_type` — cigarettes, cigars, smokeless, vape, other
- `flavored` — triggers age-gate prompt at checkout
- `restricted_states` — blocked from sale in selected states (CA, MA, NJ, etc.)
- `msa_reportable` — included in MSA reports

Compliance fields are manager-only.

## Categories

**Inventory → Categories**. Categories are hierarchical (up to 3 levels). Products can belong to multiple categories. Categories appear as tabs in the restaurant menu builder and in report groupings.

## Archiving vs. deleting

- **Archive** a product to hide it from the POS and reports without losing history
- **Delete** is blocked if the product appears on any order — archive instead

## Barcodes

- Ascend generates EAN-13 barcodes for products without one
- **Inventory → Catalog → Barcodes** — select products and print a label sheet (PDF)
- Barcode label format: 2.25 × 1.25 inch (Dymo / Zebra compatible)
