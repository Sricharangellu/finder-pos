import type { PosModule } from "../types.js";
import { OutletsService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_OUTLETS_TABLE = `
CREATE TABLE IF NOT EXISTS outlets (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  timezone    TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
`;

const CREATE_REGISTERS_TABLE = `
CREATE TABLE IF NOT EXISTS registers (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  outlet_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'closed',
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
`;

const CREATE_OUTLET_INDEXES = `
CREATE INDEX IF NOT EXISTS outlets_tenant_idx ON outlets (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS registers_tenant_outlet_idx ON registers (tenant_id, outlet_id);
`;

// BE-17: register trading sessions — open with a float, close with counted cash.
// variance_cents = expected_cash_in_drawer - counted_cash_cents.
const CREATE_REGISTER_SESSIONS = `
CREATE TABLE IF NOT EXISTS register_sessions (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL,
  register_id           TEXT NOT NULL,
  opened_by             TEXT NOT NULL,
  opening_float_cents   BIGINT NOT NULL DEFAULT 0,
  closing_float_cents   BIGINT,
  counted_cash_cents    BIGINT,
  variance_cents        BIGINT,
  status                TEXT NOT NULL DEFAULT 'open',
  opened_at             BIGINT NOT NULL,
  closed_at             BIGINT
);
CREATE INDEX IF NOT EXISTS register_sessions_tenant_reg_idx ON register_sessions (tenant_id, register_id, opened_at DESC);
`;

// Formal shift management per register (extends register_sessions).
const CREATE_SHIFTS = `
CREATE TABLE IF NOT EXISTS shifts (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  outlet_id       TEXT NOT NULL,
  register_id     TEXT NOT NULL,
  shift_number    TEXT NOT NULL,
  opened_by       TEXT NOT NULL,
  closed_by       TEXT,
  opening_cash    BIGINT NOT NULL DEFAULT 0,
  closing_cash    BIGINT,
  expected_cash   BIGINT,
  cash_difference BIGINT,
  status          TEXT NOT NULL DEFAULT 'open',
  opened_at       BIGINT NOT NULL,
  closed_at       BIGINT,
  notes           TEXT,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS shifts_register_idx ON shifts (tenant_id, register_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS shifts_open_idx ON shifts (tenant_id, status) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS cash_drawer_movements (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  shift_id        TEXT NOT NULL,
  register_id     TEXT NOT NULL,
  movement_type   TEXT NOT NULL,
  amount          BIGINT NOT NULL,
  reason          TEXT,
  created_by      TEXT,
  created_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS cash_movements_shift_idx ON cash_drawer_movements (tenant_id, shift_id, created_at DESC);
`;

/** Outlets + registers — Lightspeed-style multi-location core. Seeds a default
 *  "Main Store / Register 1" for the demo tenant so the store selector has data. */
export const outletsModule: PosModule = {
  name: "outlets",
  migrations: [CREATE_OUTLETS_TABLE, CREATE_REGISTERS_TABLE, CREATE_OUTLET_INDEXES, CREATE_REGISTER_SESSIONS, CREATE_SHIFTS],
  async register({ db, router }) {
    const service = new OutletsService(db);
    await service.seedDefault("tnt_demo");
    registerRoutes(router, service);
  },
};

export { OutletsService } from "./service.js";
export type { Outlet, Register, OutletWithRegisters, RegisterSession } from "./service.js";
