# Work Package 03: Catalog And Product Channel Visibility

## Goal

Allow one product master to be used differently in retail, wholesale, ecommerce, and warehouse contexts.

## User Feature Separation

- Retail sees scan-friendly names, each-unit sale, age restrictions, and POS visibility.
- Wholesale sees case/box units, minimum order quantity, vendor UPCs, margin, and customer-specific visibility.
- Ecommerce sees web names, images, descriptions, SEO fields, and online visibility.

## Data Scheme

Extend catalog with:

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

Related tables:

```txt
products
product_variants
product_barcodes
product_categories
product_images
product_attributes
product_units
product_packaging
product_vendor_mappings
product_compliance_rules
```

## Existing Files To Touch

- `src/modules/catalog`
- `src/modules/product_batches`
- `web/app/(protected)/admin/catalog`

## Backend Endpoints

```txt
GET    /api/v1/catalog/products?channel=retail_pos
GET    /api/v1/catalog/products?channel=wholesale_b2b
POST   /api/v1/catalog/products/:id/channel-visibility
GET    /api/v1/catalog/barcodes/:barcode/resolve
POST   /api/v1/catalog/import
GET    /api/v1/catalog/export
```

## Tests

- Product can be visible in retail and hidden in wholesale.
- Product can have per-channel name and unit defaults.
- Barcode resolves correct pack/unit.

## Acceptance Criteria

- Product master data stays shared, while visibility and selling rules vary by channel.

