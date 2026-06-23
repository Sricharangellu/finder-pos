/**
 * Identity module migrations — platform tables used by all modules.
 * These must be idempotent (CREATE TABLE IF NOT EXISTS) and run before
 * any module that depends on tenants/users.
 *
 * The Database agent owns contracts/schema.sql with the authoritative DDL;
 * these migrations mirror that DDL so the backend can bootstrap against
 * a fresh Postgres instance without the database agent's migration runner.
 */

export const CREATE_TENANTS_TABLE = `
CREATE TABLE IF NOT EXISTS tenants (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
`;

export const CREATE_USERS_TABLE = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'cashier',
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  UNIQUE (tenant_id, email)
);
`;

export const CREATE_AUDIT_LOG_TABLE = `
CREATE TABLE IF NOT EXISTS audit_log (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  actor_id     TEXT NOT NULL,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  before_state TEXT,
  after_state  TEXT,
  occurred_at  BIGINT NOT NULL,
  request_id   TEXT
);
`;

export const CREATE_FEATURE_FLAGS_TABLE = `
CREATE TABLE IF NOT EXISTS feature_flags (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT,
  flag_key   TEXT NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  metadata   TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
`;

/**
 * Functional unique index: one (global or per-tenant) row per flag_key.
 * Must be a separate CREATE INDEX statement — Postgres does not support
 * UNIQUE (expression) inline in CREATE TABLE.
 */
export const CREATE_FEATURE_FLAGS_UNIQUE_IDX = `
CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_tenant_key_uidx
  ON feature_flags (COALESCE(tenant_id, ''), flag_key);
`;

export const CREATE_IDEMPOTENCY_KEYS_TABLE = `
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  key          TEXT NOT NULL,
  response     TEXT NOT NULL,
  created_at   BIGINT NOT NULL,
  expires_at   BIGINT NOT NULL,
  UNIQUE (tenant_id, key)
);
`;

export const CREATE_REFRESH_TOKENS_TABLE = `
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens (tenant_id, user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS refresh_tokens_hash_idx ON refresh_tokens (token_hash) WHERE revoked_at IS NULL;
`;

export const CREATE_CUSTOM_ROLES_TABLE = `
CREATE TABLE IF NOT EXISTS custom_roles (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  permissions TEXT NOT NULL DEFAULT '[]',
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS custom_roles_tenant_idx ON custom_roles (tenant_id);
`;

export const ADD_CUSTOM_ROLE_TO_USERS = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_id TEXT REFERENCES custom_roles(id) ON DELETE SET NULL;
`;

export const CREATE_LOGIN_EVENTS_TABLE = `
CREATE TABLE IF NOT EXISTS login_events (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT,
  user_id        TEXT,
  email          TEXT NOT NULL,
  success        BOOLEAN NOT NULL,
  failure_reason TEXT,
  ip_address     TEXT,
  user_agent     TEXT,
  created_at     BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS login_events_tenant_idx ON login_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS login_events_user_idx ON login_events (user_id, created_at DESC) WHERE user_id IS NOT NULL;
`;

export const CREATE_DEVICES_TABLE = `
CREATE TABLE IF NOT EXISTS devices (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  outlet_id         TEXT,
  register_id       TEXT,
  device_name       TEXT NOT NULL,
  device_type       TEXT NOT NULL DEFAULT 'pos_terminal',
  device_identifier TEXT,
  app_version       TEXT,
  trusted           BOOLEAN NOT NULL DEFAULT false,
  last_seen_at      BIGINT,
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS devices_tenant_idx ON devices (tenant_id, status);
`;

export const ADD_MFA_TO_USERS = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false;
`;

export const CREATE_MFA_TABLE = `
CREATE TABLE IF NOT EXISTS user_mfa (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL UNIQUE,
  totp_secret   TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT false,
  backup_codes  TEXT NOT NULL DEFAULT '[]',
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS user_mfa_user_idx ON user_mfa (user_id);
`;

export const CREATE_API_KEYS_TABLE = `
CREATE TABLE IF NOT EXISTS api_keys (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  key_prefix    TEXT NOT NULL,
  key_hash      TEXT NOT NULL,
  scopes        TEXT NOT NULL DEFAULT '["read"]',
  last_used_at  BIGINT,
  expires_at    BIGINT,
  revoked_at    BIGINT,
  created_by    TEXT,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_prefix_idx ON api_keys (key_prefix);
CREATE INDEX IF NOT EXISTS api_keys_tenant_idx ON api_keys (tenant_id, revoked_at) WHERE revoked_at IS NULL;
`;

export const CREATE_PASSWORD_RESET_TABLE = `
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  used_at    BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_hash_idx ON password_reset_tokens (token_hash);
`;

export const CREATE_AUDIT_ENHANCEMENT_TABLES = `
CREATE TABLE IF NOT EXISTS entity_change_logs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  change_type TEXT NOT NULL,
  old_values  TEXT,
  new_values  TEXT,
  changed_by  TEXT,
  changed_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS entity_change_logs_entity_idx ON entity_change_logs (tenant_id, entity_type, entity_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS price_change_logs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  product_id  TEXT NOT NULL,
  old_price   BIGINT,
  new_price   BIGINT,
  price_type  TEXT NOT NULL DEFAULT 'retail',
  changed_by  TEXT,
  changed_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS price_change_logs_product_idx ON price_change_logs (tenant_id, product_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS security_events (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT,
  user_id     TEXT,
  event_type  TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'info',
  ip_address  TEXT,
  user_agent  TEXT,
  details     TEXT,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS security_events_tenant_idx ON security_events (tenant_id, created_at DESC) WHERE tenant_id IS NOT NULL;
`;

/**
 * Add lockout columns to users table.
 * failed_login_attempts: consecutive failures since last success / reset.
 * locked_until_ms: epoch-ms timestamp after which the account unlocks (NULL = not locked).
 */
export const ADD_LOGIN_LOCKOUT_TO_USERS = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until_ms BIGINT;
`;

/**
 * Shared trigger function: automatically stamps updated_at (epoch-ms) on any
 * table that calls it. Applied as a BEFORE UPDATE trigger.
 * Uses CREATE OR REPLACE so re-running is idempotent.
 */
export const CREATE_UPDATED_AT_TRIGGER_FN = `
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  RETURN NEW;
END;
$$;
`;

/** Apply the updated_at trigger to all core identity tables. */
export const APPLY_UPDATED_AT_TRIGGERS = `
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['users','tenants','custom_roles','devices','user_mfa','api_keys']
  LOOP
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = tbl AND column_name = 'updated_at'
      ) THEN
        EXECUTE format(
          'CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I
           FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
          tbl, tbl
        );
      END IF;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END;
$$;
`;

// DB-6: Subscription tiers — SaaS plan enforcement.
// Stores which plan a tenant is on, when it renews, and max resource limits.
export const CREATE_SUBSCRIPTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS subscriptions (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan           TEXT NOT NULL DEFAULT 'starter',
  status         TEXT NOT NULL DEFAULT 'active',
  max_users      INTEGER NOT NULL DEFAULT 3,
  max_registers  INTEGER NOT NULL DEFAULT 1,
  max_outlets    INTEGER NOT NULL DEFAULT 1,
  trial_ends_at  BIGINT,
  renews_at      BIGINT,
  cancelled_at   BIGINT,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL,
  UNIQUE (tenant_id),
  CONSTRAINT chk_subscriptions_plan CHECK (plan IN ('starter','growth','professional','enterprise','platform')),
  CONSTRAINT chk_subscriptions_status CHECK (status IN ('trialing','active','past_due','cancelled','paused'))
);
`;

// DB-5: Fiscal periods — prevents backdating entries after period close.
// DB-5: Accounting periods — prevents backdating entries after period close.
// NOTE: named accounting_periods (not fiscal_periods) as the latter conflicts
// with an embedded-postgres internal name in the test environment.
export const CREATE_ACCOUNTING_PERIODS_TABLE = `
CREATE TABLE IF NOT EXISTS accounting_periods (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  starts_at  BIGINT NOT NULL,
  ends_at    BIGINT NOT NULL,
  closed_at  BIGINT,
  closed_by  TEXT,
  created_at BIGINT NOT NULL,
  UNIQUE (tenant_id, starts_at, ends_at)
);
CREATE INDEX IF NOT EXISTS accounting_periods_tenant_idx ON accounting_periods (tenant_id, starts_at DESC);
`;

// DB-7: Currencies + exchange rates for multi-currency tenants.
export const CREATE_CURRENCIES_TABLE = `
CREATE TABLE IF NOT EXISTS currencies (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  symbol     TEXT NOT NULL,
  decimals   INTEGER NOT NULL DEFAULT 2
);
INSERT INTO currencies (code, name, symbol, decimals) VALUES
  ('USD', 'US Dollar', '$', 2),
  ('EUR', 'Euro', '€', 2),
  ('GBP', 'British Pound', '£', 2),
  ('CAD', 'Canadian Dollar', 'CA$', 2),
  ('AUD', 'Australian Dollar', 'A$', 2),
  ('JPY', 'Japanese Yen', '¥', 0)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS exchange_rates (
  id          TEXT PRIMARY KEY,
  from_code   TEXT NOT NULL REFERENCES currencies(code),
  to_code     TEXT NOT NULL REFERENCES currencies(code),
  rate        NUMERIC(18,8) NOT NULL,
  effective_at BIGINT NOT NULL,
  source      TEXT,
  UNIQUE (from_code, to_code, effective_at)
);
CREATE INDEX IF NOT EXISTS exchange_rates_lookup_idx ON exchange_rates (from_code, to_code, effective_at DESC);
`;

// DB-10: Idempotency key expiry — prevents unbounded table growth.
// At 10K tenants × 1K keys/day the table grows 10M rows/day without cleanup.
export const ADD_IDEMPOTENCY_EXPIRY_INDEX = `
CREATE INDEX IF NOT EXISTS idempotency_keys_expires_idx ON idempotency_keys (expires_at)
  WHERE expires_at IS NOT NULL;
`;

// DB-11: Soft-delete columns on core tables.
// NOTE: Indexes using WHERE deleted_at IS NULL are split into a separate migration
// to avoid ComputeIndexAttrs errors when running inside a transaction on Postgres 16.
// The ALTER TABLE and CREATE INDEX must be in separate migration entries.
export const ADD_SOFT_DELETE_COLUMNS = `
ALTER TABLE tenants     ADD COLUMN IF NOT EXISTS deleted_at BIGINT;
ALTER TABLE users       ADD COLUMN IF NOT EXISTS deleted_at BIGINT;
ALTER TABLE custom_roles ADD COLUMN IF NOT EXISTS deleted_at BIGINT;
`;

export const ADD_SOFT_DELETE_INDEXES = `
DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS tenants_active_idx ON tenants (id) WHERE deleted_at IS NULL;
EXCEPTION WHEN undefined_column THEN NULL;
END;
$$;
DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS users_active_idx ON users (tenant_id, email) WHERE deleted_at IS NULL;
EXCEPTION WHEN undefined_column THEN NULL;
END;
$$;
`;

export const IDENTITY_MIGRATIONS = [
  CREATE_TENANTS_TABLE,
  CREATE_USERS_TABLE,
  CREATE_AUDIT_LOG_TABLE,
  CREATE_FEATURE_FLAGS_TABLE,
  CREATE_FEATURE_FLAGS_UNIQUE_IDX,
  CREATE_IDEMPOTENCY_KEYS_TABLE,
  CREATE_REFRESH_TOKENS_TABLE,
  CREATE_CUSTOM_ROLES_TABLE,
  ADD_CUSTOM_ROLE_TO_USERS,
  CREATE_LOGIN_EVENTS_TABLE,
  CREATE_DEVICES_TABLE,
  CREATE_AUDIT_ENHANCEMENT_TABLES,
  ADD_MFA_TO_USERS,
  CREATE_MFA_TABLE,
  CREATE_API_KEYS_TABLE,
  CREATE_PASSWORD_RESET_TABLE,
  ADD_LOGIN_LOCKOUT_TO_USERS,
  CREATE_UPDATED_AT_TRIGGER_FN,
  APPLY_UPDATED_AT_TRIGGERS,
  CREATE_SUBSCRIPTIONS_TABLE,
  CREATE_ACCOUNTING_PERIODS_TABLE,
  CREATE_CURRENCIES_TABLE,
  ADD_SOFT_DELETE_COLUMNS,
  ADD_SOFT_DELETE_INDEXES,
];
