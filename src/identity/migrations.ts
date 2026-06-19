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
];
