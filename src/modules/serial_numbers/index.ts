import type { PosModule } from "../types.js";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { Router } from "express";
import { serialNumbersService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_SERIAL_NUMBERS = `
CREATE TABLE IF NOT EXISTS serial_numbers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  serial TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_stock',
  sold_at BIGINT,
  service_order_id TEXT,
  received_at BIGINT NOT NULL,
  notes TEXT,
  created_at BIGINT NOT NULL,
  UNIQUE (tenant_id, serial)
);
CREATE INDEX IF NOT EXISTS serial_numbers_tenant_product_idx
  ON serial_numbers (tenant_id, product_id, status);
CREATE INDEX IF NOT EXISTS serial_numbers_tenant_serial_idx
  ON serial_numbers (tenant_id, serial);
`;

export const serialNumbersModule: PosModule = {
  name: "serial_numbers",
  // routes.ts registers full paths ("/inventory/serials", …) expecting a root
  // mount, not the default `/api/v1/${name}` — without this override every
  // route registered at /api/v1/serial_numbers/inventory/serials, which the
  // frontend (web/app/(protected)/inventory/serials/page.tsx) never called.
  mountPath: "/api/v1",
  migrations: [CREATE_SERIAL_NUMBERS],
  register({ db, events, router }: { db: DB; events: EventBus; router: Router }) {
    const svc = serialNumbersService(db, events);
    registerRoutes(router, svc);
  },
};
