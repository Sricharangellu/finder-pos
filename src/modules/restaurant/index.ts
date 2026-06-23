import type { PosModule, ModuleContext } from "../types.js";
import { RestaurantService } from "./service.js";
import { registerRoutes } from "./routes.js";

// ── BE-R1: Tables + sessions ──────────────────────────────────────────────────

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS restaurant_tables (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  outlet_id    TEXT,
  table_number TEXT NOT NULL,
  capacity     INTEGER NOT NULL DEFAULT 4,
  floor_section TEXT,
  status       TEXT NOT NULL DEFAULT 'available',
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL,
  UNIQUE (tenant_id, outlet_id, table_number)
);
CREATE INDEX IF NOT EXISTS rtables_tenant_outlet_idx ON restaurant_tables (tenant_id, outlet_id, status);
`;

const CREATE_TABLE_SESSIONS = `
CREATE TABLE IF NOT EXISTS table_sessions (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  table_id    TEXT NOT NULL,
  server_id   TEXT,
  party_size  INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'open',
  opened_at   BIGINT NOT NULL,
  closed_at   BIGINT,
  notes       TEXT,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS tsessions_tenant_table_idx ON table_sessions (tenant_id, table_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS tsessions_open_idx ON table_sessions (tenant_id, status) WHERE status = 'open';
`;

// ── BE-R2: Bar tabs ───────────────────────────────────────────────────────────

const CREATE_BAR_TABS = `
CREATE TABLE IF NOT EXISTS bar_tabs (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  table_id      TEXT,
  session_id    TEXT,
  customer_name TEXT,
  status        TEXT NOT NULL DEFAULT 'open',
  opened_at     BIGINT NOT NULL,
  closed_at     BIGINT,
  created_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS bartabs_tenant_status_idx ON bar_tabs (tenant_id, status, opened_at DESC);

CREATE TABLE IF NOT EXISTS bar_tab_orders (
  tab_id    TEXT NOT NULL,
  order_id  TEXT NOT NULL,
  added_at  BIGINT NOT NULL,
  PRIMARY KEY (tab_id, order_id)
);
`;

export const restaurantModule: PosModule = {
  name: "restaurant",
  migrations: [CREATE_TABLES, CREATE_TABLE_SESSIONS, CREATE_BAR_TABS],
  register({ db, events, router }: ModuleContext) {
    const svc = new RestaurantService(db, events);
    registerRoutes(router, svc);
  },
};
