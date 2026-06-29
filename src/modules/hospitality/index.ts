import type { PosModule, ModuleContext } from "../types.js";
import { hospitalityService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_ROOMS = `
CREATE TABLE IF NOT EXISTS rooms (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  outlet_id   TEXT,
  room_number TEXT NOT NULL,
  type        TEXT,
  floor       TEXT,
  rate_cents  BIGINT NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'available',
  notes       TEXT,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  UNIQUE (tenant_id, outlet_id, room_number)
);
CREATE INDEX IF NOT EXISTS rooms_tenant_status_idx ON rooms (tenant_id, status);
`;

const CREATE_ROOM_CHARGES = `
CREATE TABLE IF NOT EXISTS room_charges (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  room_id      TEXT NOT NULL,
  description  TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  order_id     TEXT,
  posted_at    BIGINT NOT NULL,
  created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS room_charges_tenant_room_idx ON room_charges (tenant_id, room_id, posted_at DESC);
`;

export const hospitalityModule: PosModule = {
  name: "hospitality",
  migrations: [CREATE_ROOMS, CREATE_ROOM_CHARGES],
  register({ db, events, router }: ModuleContext) {
    const svc = hospitalityService(db, events);
    registerRoutes(router, svc);
  },
};
