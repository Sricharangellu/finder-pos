export const ORCHESTRATION_MIGRATIONS = [`
CREATE TABLE IF NOT EXISTS workflow_instances (
  id             TEXT PRIMARY KEY,
  type           TEXT NOT NULL,
  status         TEXT NOT NULL,
  payload        TEXT NOT NULL,
  current_step   TEXT,
  correlation_id TEXT,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL,
  completed_at   BIGINT
);
CREATE INDEX IF NOT EXISTS workflow_instances_tenant_status_idx
  ON workflow_instances (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS workflow_instances_correlation_idx
  ON workflow_instances (tenant_id, type, correlation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workflow_instance_steps (
  id           TEXT PRIMARY KEY,
  workflow_id  TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  step_name    TEXT NOT NULL,
  status       TEXT NOT NULL,
  input        TEXT,
  output       TEXT,
  error        TEXT,
  attempts     INTEGER NOT NULL DEFAULT 1,
  started_at   BIGINT,
  completed_at BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_instance_steps_workflow_step_uq
  ON workflow_instance_steps (workflow_id, step_name);

CREATE TABLE IF NOT EXISTS workflow_events (
  id          TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  data        TEXT NOT NULL,
  occurred_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS workflow_events_workflow_idx
  ON workflow_events (workflow_id, occurred_at ASC);

CREATE TABLE IF NOT EXISTS retry_state (
  id             TEXT PRIMARY KEY,
  operation_key  TEXT NOT NULL,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  attempt        INTEGER NOT NULL DEFAULT 1,
  last_error     TEXT,
  next_retry_at  BIGINT NOT NULL,
  exhausted      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL,
  CONSTRAINT retry_state_operation_tenant_uq UNIQUE (tenant_id, operation_key)
);
CREATE INDEX IF NOT EXISTS retry_state_due_idx
  ON retry_state (tenant_id, exhausted, next_retry_at);

CREATE TABLE IF NOT EXISTS workflow_locks (
  lock_key    TEXT PRIMARY KEY,
  holder      TEXT NOT NULL,
  acquired_at BIGINT NOT NULL,
  expires_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS workflow_locks_expires_idx
  ON workflow_locks (expires_at);

CREATE TABLE IF NOT EXISTS job_queue (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  payload       TEXT NOT NULL,
  tenant_id     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  run_at        BIGINT NOT NULL,
  error         TEXT,
  created_at    BIGINT NOT NULL,
  completed_at  BIGINT
);
CREATE INDEX IF NOT EXISTS job_queue_ready_idx
  ON job_queue (status, run_at ASC, attempts, max_attempts);
CREATE INDEX IF NOT EXISTS job_queue_tenant_type_idx
  ON job_queue (tenant_id, type, status);
`];
