# Work Package 03: Catalog And Product Channel Visibility

## Goal

One product master, used differently across retail, wholesale, ecommerce, and
warehouse — without data collision. The same SKU may need different prices,
visibility, descriptions, barcodes, tax rules, restrictions, and pack sizes per
channel. Products are master data; channel behavior is an overlay.

## User feature separation

- Retail: scan-friendly names, each-unit sale, age restrictions, POS visibility only.
- Wholesale: case/box/unit pack sizes, minimum order qty, vendor + case UPCs, margin/cost (permitted roles), customer-specific visibility.
- Ecommerce: web names, images, descriptions/SEO, online visibility.

## Database changes

Master/overlay tables:

```txt
products                 product_variants        product_barcodes
product_categories       product_images          product_attributes
product_units            product_packaging       product_vendor_mappings
product_compliance_rules
```

Key product fields:

```txt
tenant_id  business_unit_id?  sku  name  base_unit  status  tax_class
age_restricted  track_inventory  msa_reportable  restricted_states
retail_visible  wholesale_visible  ecommerce_visible
```

Per-channel overlay:

```sql
product_channel_visibility (
  tenant_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  business_unit_id TEXT,
  channel TEXT NOT NULL,
  visible BOOLEAN NOT NULL DEFAULT true,
  display_name TEXT,
  description_override TEXT,
  image_override TEXT,
  min_qty INTEGER,
  max_qty INTEGER,
  qty_increment INTEGER,
  default_unit_code TEXT,
  PRIMARY KEY (tenant_id, product_id, business_unit_id, channel)
);
```

## Current repo files affected

- `src/modules/catalog`, `src/modules/product_batches`, `src/modules/serial_numbers`.
- `web/app/(protected)/admin/catalog` (channel-visibility tabs, barcode/unit mgmt).

## Backend endpoints

```txt
GET    /api/v1/catalog/products?channel=retail_pos
GET    /api/v1/catalog/products?channel=wholesale_b2b
POST   /api/v1/catalog/products
PATCH  /api/v1/catalog/products/:id
POST   /api/v1/catalog/products/:id/channel-visibility
GET    /api/v1/catalog/barcodes/:barcode/resolve
POST   /api/v1/catalog/import
GET    /api/v1/catalog/export
```

Barcode resolve must return the correct product + unit/pack for the scanned code.

## Frontend screens

- Shared product admin screen with channel tabs: Retail, Wholesale, Ecommerce.
- Barcode management; unit/pack-size management.
- Compliance fields for restricted products (age, restricted states, MSA).
- Product import/export.

## Tests required

- One product visible in retail but hidden in wholesale.
- Per-channel name and unit defaults (retail name vs wholesale name override).
- Barcode scan resolves the correct unit/pack.
- Wholesale users cannot edit POS-only settings unless permitted.
- Product data stays tenant-isolated.

## Acceptance criteria

- Product master stays shared while visibility and selling rules vary by channel.
- Retail name/each-unit vs wholesale case-unit resolve correctly at sale time.
- Barcode scan resolves the right unit/pack.
- Restricted-product compliance fields are enforced downstream (WP 05 age check).

## Implementation checklist

- [ ] `product_channel_visibility` table + service resolution by `channel`.
- [ ] Channel query param on catalog list; per-channel name/unit overrides.
- [ ] Barcode resolve returns unit/pack.
- [ ] Compliance fields on products (age_restricted, restricted_states, msa_reportable).
- [ ] Import/export honoring channel visibility.
- [ ] Admin UI channel tabs + barcode/unit/compliance management.
- [ ] Permission gate on POS-only vs wholesale-only edits (WP 02).
