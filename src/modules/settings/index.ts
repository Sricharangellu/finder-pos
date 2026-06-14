import type { PosModule } from "../types.js";
import { SettingsService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_KV = `
CREATE TABLE IF NOT EXISTS settings_kv (
  tenant_id  TEXT NOT NULL,
  key        TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, key)
);`;

const CREATE_SHIPPING_METHODS = `
CREATE TABLE IF NOT EXISTS shipping_methods (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  name              TEXT NOT NULL,
  amount_cents      BIGINT NOT NULL DEFAULT 0,
  free_limit_cents  BIGINT,
  ecommerce         INTEGER NOT NULL DEFAULT 0,
  sequence          INTEGER NOT NULL DEFAULT 0,
  credit_account_id TEXT,
  debit_account_id  TEXT,
  active            INTEGER NOT NULL DEFAULT 1
);`;

const CREATE_PAYMENT_TERMS = `
CREATE TABLE IF NOT EXISTS payment_terms (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  days_due    INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  active      INTEGER NOT NULL DEFAULT 1
);`;

const CREATE_PAYMENT_MODES = `
CREATE TABLE IF NOT EXISTS payment_modes (
  id        TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name      TEXT NOT NULL,
  active    INTEGER NOT NULL DEFAULT 1
);`;

const CREATE_TAX_RATES = `
CREATE TABLE IF NOT EXISTS tax_rates (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  name              TEXT NOT NULL,
  rate_bps          INTEGER NOT NULL DEFAULT 0,
  apply_to_category TEXT,
  state             TEXT,
  active            INTEGER NOT NULL DEFAULT 1
);`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS shipping_methods_tenant_idx ON shipping_methods (tenant_id, sequence);
CREATE INDEX IF NOT EXISTS payment_terms_tenant_idx ON payment_terms (tenant_id);
CREATE INDEX IF NOT EXISTS payment_modes_tenant_idx ON payment_modes (tenant_id);
CREATE INDEX IF NOT EXISTS tax_rates_tenant_idx ON tax_rates (tenant_id);`;

/** Settings — shipping/terms/modes/tax + business profile & feature flags (#13). */
export const settingsModule: PosModule = {
  name: "settings",
  migrations: [CREATE_KV, CREATE_SHIPPING_METHODS, CREATE_PAYMENT_TERMS, CREATE_PAYMENT_MODES, CREATE_TAX_RATES, INDEXES],
  register({ db, router }) {
    registerRoutes(router, new SettingsService(db));
  },
};

export { SettingsService } from "./service.js";
