import type { PosModule, ModuleContext } from "../types.js";
import { rentalService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_RENTAL_ASSETS = `
CREATE TABLE IF NOT EXISTS rental_assets (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  name             TEXT NOT NULL,
  sku              TEXT NOT NULL DEFAULT '',
  category         TEXT,
  daily_rate_cents BIGINT NOT NULL DEFAULT 0,
  deposit_cents    BIGINT NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','rented','maintenance','retired')),
  serial           TEXT,
  notes            TEXT,
  created_at       BIGINT NOT NULL,
  updated_at       BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS rental_assets_tenant_status_idx ON rental_assets (tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS rental_assets_tenant_sku_idx ON rental_assets (tenant_id, sku) WHERE sku != '';
`;

const CREATE_RENTAL_CONTRACTS = `
CREATE TABLE IF NOT EXISTS rental_contracts (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  customer_id      TEXT,
  asset_id         TEXT NOT NULL,
  starts_at        BIGINT NOT NULL,
  ends_at          BIGINT NOT NULL,
  actual_return_at BIGINT,
  deposit_cents    BIGINT NOT NULL DEFAULT 0,
  deposit_returned INTEGER NOT NULL DEFAULT 0,
  daily_rate_cents BIGINT NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','returned','cancelled')),
  notes            TEXT,
  created_at       BIGINT NOT NULL,
  updated_at       BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS rental_contracts_tenant_asset_idx ON rental_contracts (tenant_id, asset_id, status);
CREATE INDEX IF NOT EXISTS rental_contracts_tenant_customer_idx ON rental_contracts (tenant_id, customer_id);
`;

export const rentalModule: PosModule = {
  name: "rental",
  migrations: [CREATE_RENTAL_ASSETS, CREATE_RENTAL_CONTRACTS],
  register({ db, events, router }: ModuleContext) {
    const svc = rentalService(db, events);
    registerRoutes(router, svc);
  },
};
