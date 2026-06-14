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

/** Outlets + registers — Lightspeed-style multi-location core. Seeds a default
 *  "Main Store / Register 1" for the demo tenant so the store selector has data. */
export const outletsModule: PosModule = {
  name: "outlets",
  migrations: [CREATE_OUTLETS_TABLE, CREATE_REGISTERS_TABLE, CREATE_OUTLET_INDEXES],
  async register({ db, router }) {
    const service = new OutletsService(db);
    await service.seedDefault("tnt_demo");
    registerRoutes(router, service);
  },
};

export { OutletsService } from "./service.js";
export type { Outlet, Register, OutletWithRegisters } from "./service.js";
