import type { PosModule } from "../types.js";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { Router } from "express";
import { productBatchesService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_PRODUCT_BATCHES = `
CREATE TABLE IF NOT EXISTS product_batches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  batch_number TEXT NOT NULL DEFAULT '',
  expiry_date BIGINT,
  qty INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  received_at BIGINT NOT NULL,
  supplier_name TEXT,
  notes TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS product_batches_product_idx ON product_batches (tenant_id, product_id);
CREATE INDEX IF NOT EXISTS product_batches_expiry_idx ON product_batches (tenant_id, expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_batches_tenant_expiry_idx ON product_batches (tenant_id, expiry_date, qty) WHERE expiry_date IS NOT NULL AND qty > 0;
`;

export const productBatchesModule: PosModule = {
  name: "product_batches",
  // Routes are top-level resource names (router.get("/product-batches", …)); mount
  // at /api/v1 like store_locations, not the default /api/v1/product_batches which
  // 404s the client's hyphenated path (MSW masks it in dev).
  mountPath: "/api/v1",
  migrations: [CREATE_PRODUCT_BATCHES],
  register({ db, events, router }: { db: DB; events: EventBus; router: Router }) {
    const svc = productBatchesService(db, events);
    registerRoutes(router, svc);
  },
};
