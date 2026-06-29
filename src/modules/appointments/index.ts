import type { PosModule, ModuleContext } from "../types.js";
import { appointmentsService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_SERVICES_CATALOG = `
CREATE TABLE IF NOT EXISTS services_catalog (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  duration_mins INTEGER NOT NULL DEFAULT 60,
  price_cents   BIGINT NOT NULL DEFAULT 0,
  category      TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS services_catalog_tenant_active_idx ON services_catalog (tenant_id, active);
`;

const CREATE_APPOINTMENTS = `
CREATE TABLE IF NOT EXISTS appointments (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  customer_id TEXT,
  employee_id TEXT,
  service_id  TEXT,
  starts_at   BIGINT NOT NULL,
  ends_at     BIGINT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','confirmed','in_progress','completed','cancelled','no_show')),
  notes       TEXT,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS appointments_tenant_employee_idx ON appointments (tenant_id, employee_id, starts_at);
CREATE INDEX IF NOT EXISTS appointments_tenant_starts_idx ON appointments (tenant_id, starts_at);
CREATE INDEX IF NOT EXISTS appointments_tenant_customer_idx ON appointments (tenant_id, customer_id);
`;

export const appointmentsModule: PosModule = {
  name: "appointments",
  migrations: [CREATE_SERVICES_CATALOG, CREATE_APPOINTMENTS],
  register({ db, events, router }: ModuleContext) {
    const svc = appointmentsService(db, events);
    registerRoutes(router, svc);
  },
};
