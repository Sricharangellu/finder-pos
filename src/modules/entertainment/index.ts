import type { PosModule, ModuleContext } from "../types.js";
import { entertainmentService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_EVENTS = `
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  venue       TEXT,
  starts_at   BIGINT NOT NULL,
  ends_at     BIGINT,
  capacity    INTEGER NOT NULL DEFAULT 0,
  price_cents BIGINT NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','cancelled','past')),
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_tenant_status_starts_idx ON events (tenant_id, status, starts_at);
`;

const CREATE_EVENT_TICKETS = `
CREATE TABLE IF NOT EXISTS event_tickets (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  customer_id   TEXT,
  customer_name TEXT,
  qr_code       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','redeemed','cancelled')),
  price_cents   BIGINT NOT NULL DEFAULT 0,
  redeemed_at   BIGINT,
  created_at    BIGINT NOT NULL,
  UNIQUE (qr_code)
);
CREATE INDEX IF NOT EXISTS event_tickets_tenant_event_idx ON event_tickets (tenant_id, event_id, status);
CREATE INDEX IF NOT EXISTS event_tickets_tenant_customer_idx ON event_tickets (tenant_id, customer_id);
`;

export const entertainmentModule: PosModule = {
  name: "entertainment",
  migrations: [CREATE_EVENTS, CREATE_EVENT_TICKETS],
  register({ db, events, router }: ModuleContext) {
    const svc = entertainmentService(db, events);
    registerRoutes(router, svc);
  },
};
