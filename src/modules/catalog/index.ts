import type { PosModule } from "../types.js";
import { CatalogService } from "./service.js";
import { registerRoutes } from "./routes.js";
import { dropLegacyNoTenant } from "../../shared/migrate.js";

// Mirrors db/migrations/0002_commerce.sql — db/ is the canonical DDL owner.
// tenant_id TEXT NOT NULL: every commerce row is scoped to a tenant (tnt_* prefix).
// The UNIQUE constraint moves from (sku) to (tenant_id, sku) so tenants can share SKUs.
const CREATE_PRODUCTS_TABLE = `
CREATE TABLE IF NOT EXISTS products (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  sku          TEXT NOT NULL,
  name         TEXT NOT NULL,
  price_cents  BIGINT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'general',
  tax_class    TEXT NOT NULL DEFAULT 'standard',
  barcode      TEXT,
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL,
  UNIQUE (tenant_id, sku)
);
`;

const CREATE_PRODUCTS_INDEXES = `
CREATE INDEX IF NOT EXISTS products_tenant_status_idx ON products (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS products_tenant_category_idx ON products (tenant_id, category);
`;

// Multiple UPCs per product (each/single/box/case/vendor/alt). A scan of any
// barcode resolves to the product; pack_size lets box/case scans map to eaches.
const CREATE_PRODUCT_BARCODES = `
CREATE TABLE IF NOT EXISTS product_barcodes (
  tenant_id  TEXT NOT NULL,
  product_id TEXT NOT NULL,
  barcode    TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'each',
  pack_size  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, barcode)
);
CREATE INDEX IF NOT EXISTS product_barcodes_product_idx ON product_barcodes (tenant_id, product_id);
`;

// BE-6: product detail fields (description/brand/dimensions/weight/image/preferred
// vendor/qty-sell limits). Dimensions in millimeters, weight in grams (BIGINT, like
// money: integer base units, never floats). qty_increment defaults to 1 (sellable
// in single units unless a tenant configures case-pack-only SKUs).
const ALTER_PRODUCTS_DETAIL_FIELDS = `
ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS length_mm BIGINT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS width_mm BIGINT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS height_mm BIGINT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_grams BIGINT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS preferred_vendor_id TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vendor_upc TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS min_qty_to_sell INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS max_qty_to_sell INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS qty_increment INTEGER NOT NULL DEFAULT 1;
`;

// BE-6: category tree. `parent_id` is a self-reference (app-layer; no FK, matching
// the suppliers/preferred_vendor_id reference convention) so categories can nest
// arbitrarily. `products.category` (flat string, used by resolveTaxClass) is kept
// unchanged — this tree is additive, for filtering/browsing.
const CREATE_CATEGORIES_TABLE = `
CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  parent_id  TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS categories_tenant_parent_idx ON categories (tenant_id, parent_id);
`;

const CREATE_PRODUCT_CATEGORIES = `
CREATE TABLE IF NOT EXISTS product_categories (
  tenant_id   TEXT NOT NULL,
  product_id  TEXT NOT NULL,
  category_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, product_id, category_id)
);
CREATE INDEX IF NOT EXISTS product_categories_category_idx ON product_categories (tenant_id, category_id);
`;

// BE-8: master/child product variants. `parent_product_id` is an app-layer
// self-reference (no FK, matching preferred_vendor_id convention). A "master"
// row is any product referenced as a parent by at least one other product;
// masters are conventionally created with price_cents=0 and are excluded from
// sellable lists (see CatalogService.list excludeMasters + orders guard).
const ALTER_PRODUCTS_VARIANTS = `
ALTER TABLE products ADD COLUMN IF NOT EXISTS parent_product_id TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_label TEXT;
CREATE INDEX IF NOT EXISTS products_tenant_parent_idx ON products (tenant_id, parent_product_id);
`;

// BE-16: age-restricted flag — must be verified at register before sale.
const ALTER_PRODUCTS_AGE = `
ALTER TABLE products ADD COLUMN IF NOT EXISTS age_restricted INTEGER NOT NULL DEFAULT 0;
`;

// BE-22: compliance columns for regulated tobacco/vape/CBD retail.
// restricted_states is a JSON array of 2-letter state codes (e.g. '["CA","MA"]').
const ALTER_PRODUCTS_COMPLIANCE = `
ALTER TABLE products ADD COLUMN IF NOT EXISTS tobacco_type TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS flavored INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS menthol INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS msa_reportable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS restricted_states TEXT;
`;

// Expiry date: denormalized cache of the soonest active lot expiry from inventory_lots.
// Written by InventoryService.syncProductExpiry() on every lot create/depletion.
// NULL = no lot tracking (non-perishable) or all lots fully depleted.
const ALTER_PRODUCTS_EXPIRY = `
ALTER TABLE products ADD COLUMN IF NOT EXISTS expiry_date BIGINT;
CREATE INDEX IF NOT EXISTS products_tenant_expiry_idx ON products (tenant_id, expiry_date) WHERE expiry_date IS NOT NULL;
`;

// XLSX import schema: all 71 columns from the product export mapped to normalized columns.
// Prices → cents (BIGINT). Physical measures use native integer units (mg, ml, oz×100).
// Multi-unit UPCs (single/box/case/upc1/upc2) live in product_barcodes; these columns
// are product-level attributes that can't be derived from a barcode scan alone.
const ALTER_PRODUCTS_XLSX_FIELDS = `
ALTER TABLE products ADD COLUMN IF NOT EXISTS url_alias TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS short_description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS full_description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS alternative_name TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS model_name TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS manufacturer TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS msrp_cents BIGINT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS min_selling_price_cents BIGINT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS raw_cost_price_cents BIGINT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tags TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS size TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS nicotine_strength_mg INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS volume_ml INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS oz_per_product_x100 BIGINT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS state_description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS federal_description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS msa_category_code TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS msa_promotion_indicator INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS msa_promotion_description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS msa_manufacturer_description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS meta_title TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS meta_keywords TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS meta_description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS preferred_vendor_name TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS primary_vendor TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS drop_shipment INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS reorder_quantity INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS returnable INTEGER NOT NULL DEFAULT 1;
ALTER TABLE products ADD COLUMN IF NOT EXISTS service_product INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS customer_specific INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS exclude_from_po INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS composite_product INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS track_inventory INTEGER NOT NULL DEFAULT 1;
ALTER TABLE products ADD COLUMN IF NOT EXISTS track_inventory_by_imei INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS products_tenant_msa_idx ON products (tenant_id, msa_category_code) WHERE msa_category_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_tenant_service_idx ON products (tenant_id, service_product);
`;

// Account-mode tiered pricing: one retail price (price_cents, already exists) plus
// optional wholesale and enterprise override prices. Null = fall back to retail price.
const ALTER_PRODUCTS_TIERED_PRICING = `
ALTER TABLE products ADD COLUMN IF NOT EXISTS wholesale_price_cents BIGINT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS enterprise_price_cents BIGINT;
`;

export const catalogModule: PosModule = {
  name: "catalog",
  migrations: [
    dropLegacyNoTenant("products"),
    CREATE_PRODUCTS_TABLE,
    CREATE_PRODUCTS_INDEXES,
    CREATE_PRODUCT_BARCODES,
    ALTER_PRODUCTS_DETAIL_FIELDS,
    CREATE_CATEGORIES_TABLE,
    CREATE_PRODUCT_CATEGORIES,
    ALTER_PRODUCTS_VARIANTS,
    ALTER_PRODUCTS_AGE,
    ALTER_PRODUCTS_COMPLIANCE,
    ALTER_PRODUCTS_EXPIRY,
    ALTER_PRODUCTS_XLSX_FIELDS,
    ALTER_PRODUCTS_TIERED_PRICING,
    `
CREATE TABLE IF NOT EXISTS product_images (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  product_id  TEXT NOT NULL,
  image_url   TEXT NOT NULL,
  alt_text    TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS product_images_product_idx ON product_images (tenant_id, product_id, sort_order);
`,
    `
CREATE TABLE IF NOT EXISTS product_attributes (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  name              TEXT NOT NULL,
  data_type         TEXT NOT NULL DEFAULT 'text',
  is_filterable     BOOLEAN NOT NULL DEFAULT false,
  is_variant_option BOOLEAN NOT NULL DEFAULT false,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);
`,
    `
CREATE TABLE IF NOT EXISTS product_attribute_values (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  product_id    TEXT NOT NULL,
  attribute_id  TEXT NOT NULL,
  value_text    TEXT,
  value_number  NUMERIC,
  value_boolean BOOLEAN,
  created_at    BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS product_attribute_values_unique_idx ON product_attribute_values (tenant_id, product_id, attribute_id);
`,
    `
CREATE TABLE IF NOT EXISTS product_units (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  unit_code         TEXT NOT NULL,
  unit_name         TEXT NOT NULL,
  base_unit         TEXT,
  conversion_factor NUMERIC NOT NULL DEFAULT 1,
  created_at        BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS product_units_code_idx ON product_units (tenant_id, unit_code);
`,
  ],
  async register({ db, events, router }) {
    const service = new CatalogService(db, events);
    // Idempotent demo seed (only runs when the table is empty for tnt_demo).
    await service.seed();
    registerRoutes(router, service, db);
  },
};

export { CatalogService } from "./service.js";
export type {
  Product,
  CreateProductInput,
  UpdateProductInput,
  ListProductsQuery,
  TaxClass,
  ProductStatus,
  Category,
  CreateCategoryInput,
  UpdateCategoryInput,
} from "./service.js";
