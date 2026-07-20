import type { PosModule } from "../types.js";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { Router } from "express";
import { storeLocationsService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_STORE_LOCATIONS = `
CREATE TABLE IF NOT EXISTS store_locations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  outlet_id TEXT,
  aisle TEXT NOT NULL,
  shelf TEXT NOT NULL DEFAULT '',
  bin TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL,
  description TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS store_locations_tenant_idx ON store_locations (tenant_id, aisle, shelf);
`;

// NOTE: this is intentionally NOT named `product_locations` — the `fulfillment`
// module (registered earlier in src/modules/index.ts) already owns a table by
// that exact name with a completely different, incompatible schema (single
// pick-location per product: PRIMARY KEY (tenant_id, product_id), no `id`/
// `qty_at_location`/`notes`/`created_at` columns). Because migrations run as
// `CREATE TABLE IF NOT EXISTS`, whichever module registers first wins the
// race and every query from the other module 500s on missing columns — this
// exact collision pattern previously took down the `quotes` module (vs.
// `sales`'s `quotations` table). Use a distinct name to store aisle/shelf/bin
// placement with per-location quantity, separate from fulfillment's single
// pick-location assignment.
const CREATE_PRODUCT_LOCATIONS = `
CREATE TABLE IF NOT EXISTS store_location_products (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  qty_at_location INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (tenant_id, product_id, location_id)
);
CREATE INDEX IF NOT EXISTS store_location_products_product_idx ON store_location_products (tenant_id, product_id);
CREATE INDEX IF NOT EXISTS store_location_products_location_idx ON store_location_products (tenant_id, location_id);
`;

export const storeLocationsModule: PosModule = {
  name: "store_locations",
  // Routes are top-level resource names (/store-locations, /product-locations),
  // which the frontend + mocks call at /api/v1/<resource> — mount there so a
  // uniform /api/v1/store_locations prefix doesn't 404 those calls.
  mountPath: "/api/v1",
  migrations: [CREATE_STORE_LOCATIONS, CREATE_PRODUCT_LOCATIONS],
  register({ db, events, router }: { db: DB; events: EventBus; router: Router }) {
    const svc = storeLocationsService(db, events);
    registerRoutes(router, svc);
  },
};
