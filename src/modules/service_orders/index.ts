import type { PosModule } from "../types.js";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { Router } from "express";
import { serviceOrdersService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_SERVICE_ORDERS = `
CREATE TABLE IF NOT EXISTS service_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  assigned_to TEXT,
  estimate_cents BIGINT NOT NULL DEFAULT 0,
  actual_cents BIGINT,
  notes TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS service_orders_tenant_status_idx
  ON service_orders (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS service_orders_customer_idx
  ON service_orders (tenant_id, customer_id) WHERE customer_id IS NOT NULL;
`;

export const serviceOrdersModule: PosModule = {
  name: "service_orders",
  // Routes are top-level resource names (router.get("/service-orders", …)); mount
  // at /api/v1 like store_locations, not the default /api/v1/service_orders which
  // 404s the client's hyphenated path (MSW masks it in dev).
  mountPath: "/api/v1",
  migrations: [CREATE_SERVICE_ORDERS],
  register({ db, events, router }: { db: DB; events: EventBus; router: Router }) {
    const svc = serviceOrdersService(db, events);
    registerRoutes(router, svc);
  },
};
