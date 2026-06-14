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

export const catalogModule: PosModule = {
  name: "catalog",
  migrations: [dropLegacyNoTenant("products"), CREATE_PRODUCTS_TABLE, CREATE_PRODUCTS_INDEXES, CREATE_PRODUCT_BARCODES],
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
} from "./service.js";
