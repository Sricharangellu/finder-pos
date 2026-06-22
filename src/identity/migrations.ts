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
    EXECUTE format(
      'CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      tbl, tbl
    );
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL; -- idempotent
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
];
