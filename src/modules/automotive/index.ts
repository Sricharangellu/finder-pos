import type { PosModule, ModuleContext } from "../types.js";
import { automotiveService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_VEHICLES = `
CREATE TABLE IF NOT EXISTS vehicles (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  customer_id   TEXT,
  vin           TEXT NOT NULL DEFAULT '',
  make          TEXT,
  model         TEXT,
  year          INTEGER,
  color         TEXT,
  license_plate TEXT,
  mileage       INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS vehicles_tenant_customer_idx ON vehicles (tenant_id, customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_tenant_vin_idx ON vehicles (tenant_id, vin) WHERE vin != '';
`;

const CREATE_WORK_ORDERS = `
CREATE TABLE IF NOT EXISTS work_orders (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  vehicle_id     TEXT,
  customer_id    TEXT,
  technician_id  TEXT,
  title          TEXT NOT NULL,
  description    TEXT,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','ready','closed','cancelled')),
  estimate_cents BIGINT NOT NULL DEFAULT 0,
  actual_cents   BIGINT NOT NULL DEFAULT 0,
  labour_cents   BIGINT NOT NULL DEFAULT 0,
  mileage_in     INTEGER NOT NULL DEFAULT 0,
  mileage_out    INTEGER NOT NULL DEFAULT 0,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS work_orders_tenant_vehicle_idx ON work_orders (tenant_id, vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS work_orders_tenant_status_idx ON work_orders (tenant_id, status);
`;

export const automotiveModule: PosModule = {
  name: "automotive",
  migrations: [CREATE_VEHICLES, CREATE_WORK_ORDERS],
  register({ db, events, router }: ModuleContext) {
    const svc = automotiveService(db, events);
    registerRoutes(router, svc);
  },
};
