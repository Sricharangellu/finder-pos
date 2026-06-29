import type { PosModule, ModuleContext } from "../types.js";
import { manufacturingService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_PRODUCTION_ORDERS = `
CREATE TABLE IF NOT EXISTS production_orders (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  product_id   TEXT,
  quantity     INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_progress','completed','cancelled')),
  notes        TEXT,
  started_at   BIGINT,
  completed_at BIGINT,
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS production_orders_tenant_status_idx ON production_orders (tenant_id, status, created_at DESC);
`;

const CREATE_BOM_LINES = `
CREATE TABLE IF NOT EXISTS bom_lines (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  production_order_id TEXT NOT NULL,
  raw_material_id     TEXT,
  raw_material_name   TEXT,
  qty_required        NUMERIC NOT NULL,
  qty_consumed        NUMERIC NOT NULL DEFAULT 0,
  unit                TEXT NOT NULL DEFAULT 'units',
  created_at          BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS bom_lines_tenant_order_idx ON bom_lines (tenant_id, production_order_id);
`;

export const manufacturingModule: PosModule = {
  name: "manufacturing",
  migrations: [CREATE_PRODUCTION_ORDERS, CREATE_BOM_LINES],
  register({ db, events, router }: ModuleContext) {
    const svc = manufacturingService(db, events);
    registerRoutes(router, svc);
  },
};
