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
  ],
  async register({ db, events, router }) {
    const service = new CatalogService(db, events);
    // Idempotent demo seed (only runs when the table is empty for tnt_demo).
    await service.seed();
    registerRoutes(router, service);
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
