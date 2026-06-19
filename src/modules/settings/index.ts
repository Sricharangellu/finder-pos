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

const CREATE_CURRENCIES = `
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS base_currency TEXT NOT NULL DEFAULT 'USD';
CREATE TABLE IF NOT EXISTS supported_currencies (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  currency_code   TEXT NOT NULL,
  currency_name   TEXT NOT NULL,
  symbol          TEXT NOT NULL DEFAULT '$',
  exchange_rate   NUMERIC(10,6) NOT NULL DEFAULT 1.0,
  is_base         BOOLEAN NOT NULL DEFAULT false,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  updated_at      BIGINT NOT NULL,
  CONSTRAINT supported_currencies_unique UNIQUE (tenant_id, currency_code)
);
INSERT INTO supported_currencies (id, tenant_id, currency_code, currency_name, symbol, exchange_rate, is_base, is_active, updated_at)
VALUES
  ('curr_usd_demo', 'tnt_demo', 'USD', 'US Dollar', '$', 1.0, true, true, 0),
  ('curr_eur_demo', 'tnt_demo', 'EUR', 'Euro', '€', 0.92, false, true, 0),
  ('curr_gbp_demo', 'tnt_demo', 'GBP', 'British Pound', '£', 0.79, false, true, 0),
  ('curr_cad_demo', 'tnt_demo', 'CAD', 'Canadian Dollar', 'C$', 1.36, false, true, 0)
ON CONFLICT (tenant_id, currency_code) DO NOTHING;
`;

/** Settings — shipping/terms/modes/tax + business profile & feature flags (#13). */
export const settingsModule: PosModule = {
  name: "settings",
  migrations: [CREATE_KV, CREATE_SHIPPING_METHODS, CREATE_PAYMENT_TERMS, CREATE_PAYMENT_MODES, CREATE_TAX_RATES, INDEXES, CREATE_CURRENCIES],
  register({ db, router }) {
    registerRoutes(router, new SettingsService(db));
  },
};

export { SettingsService } from "./service.js";
