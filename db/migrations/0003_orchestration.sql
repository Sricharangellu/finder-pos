-- =============================================================================
-- Migration: 0003_orchestration
-- Wave:      2 — Enterprise Orchestration Layer
-- Purpose:   Create tables required by the WorkflowRunner, SagaStateStore,
--            CommandBus, LockManager, RetryStateStore, QueueProducer/Consumer,
--            IdempotencyStore, and OutboxRelayJob.
--
-- These tables were always referenced by src/orchestration/ but were never
-- added to a migration, causing every workflow/saga trigger to fail silently
-- with "relation does not exist" at runtime (confirmed in AUDIT_2026-07-03B).
--
-- Convention (same as 0002):
--   • tenant_id TEXT NOT NULL on every tenant-scoped table.
--   • Money columns: BIGINT cents. Timestamps: BIGINT epoch ms.
--   • Primary keys: TEXT uuid-v7 with table prefix.
--   • Idempotent: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
--   • RLS: enabled on all tenant-scoped tables.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Fix idempotency_keys
--    The table exists from 0001_foundation but uses column names that do NOT
--    match what IdempotencyStore.check/record actually query:
--      Code uses: result, expires_at, workflow_id, created_at
--      Migration had: response_json, ts, (no workflow_id or expires_at or created_at)
--    Fix: add the missing columns with safe defaults; make required-but-missing
--    columns nullable so the code's INSERT (without id/request_hash/ts) works.
-- ---------------------------------------------------------------------------
ALTER TABLE idempotency_keys
  ALTER COLUMN id SET DEFAULT 'idk_' || replace(gen_random_uuid()::text, '-', '');

ALTER TABLE idempotency_keys
  ALTER COLUMN request_hash DROP NOT NULL;

ALTER TABLE idempotency_keys
  ALTER COLUMN request_hash SET DEFAULT '';

ALTER TABLE idempotency_keys
  ALTER COLUMN ts SET DEFAULT 0;

-- Columns the code queries/inserts but the original migration didn't define:
ALTER TABLE idempotency_keys
  ADD COLUMN IF NOT EXISTS workflow_id   TEXT;

ALTER TABLE idempotency_keys
  ADD COLUMN IF NOT EXISTS result        TEXT;

ALTER TABLE idempotency_keys
  ADD COLUMN IF NOT EXISTS created_at    BIGINT NOT NULL DEFAULT 0;

ALTER TABLE idempotency_keys
  ADD COLUMN IF NOT EXISTS expires_at    BIGINT NOT NULL DEFAULT 0;

-- The code queries: WHERE tenant_id = ? AND key = ? AND expires_at > ?
-- Existing index is on (tenant_id, key) which covers this; add expires_at.
CREATE INDEX IF NOT EXISTS idempotency_keys_tenant_key_expires_idx
  ON idempotency_keys (tenant_id, key, expires_at);

-- ---------------------------------------------------------------------------
-- 2. workflow_instances
--    Central state table shared by WorkflowStateStore (workflows) and
--    SagaStateStore (sagas — stored with type prefix 'saga:<type>').
--    Prefix: wf_  (sagas use prefix: saga_)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_instances (
    id              TEXT    NOT NULL,
    tenant_id       TEXT    NOT NULL,
    type            TEXT    NOT NULL,
                            -- workflow type ('checkout', 'refund', …)
                            -- or saga type ('saga:checkout', …)
    status          TEXT    NOT NULL DEFAULT 'pending',
                            -- 'pending'|'running'|'completed'|'failed'|'compensated'
    payload         TEXT    NOT NULL DEFAULT '{}',
                            -- JSON snapshot of the context at last step
    current_step    TEXT,   -- name of the step currently executing (null if not started/done)
    correlation_id  TEXT,   -- business entity id (order_id, po_id, etc.)
    created_at      BIGINT  NOT NULL,
    updated_at      BIGINT  NOT NULL,
    completed_at    BIGINT,

    CONSTRAINT workflow_instances_pk PRIMARY KEY (id),
    CONSTRAINT workflow_instances_status_values
        CHECK (status IN ('pending','running','completed','failed','compensating','compensated','started'))
);

CREATE INDEX IF NOT EXISTS wi_tenant_type_status_idx
    ON workflow_instances (tenant_id, type, status);

CREATE INDEX IF NOT EXISTS wi_tenant_correlation_type_idx
    ON workflow_instances (tenant_id, correlation_id, type)
    WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS wi_tenant_created_idx
    ON workflow_instances (tenant_id, created_at DESC);

ALTER TABLE workflow_instances ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. workflow_instance_steps
--    Per-step execution trace for each workflow instance.
--    Prefix: ws_
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_instance_steps (
    id              TEXT    NOT NULL,
    workflow_id     TEXT    NOT NULL
                        REFERENCES workflow_instances(id) ON DELETE CASCADE,
    step_name       TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'pending',
                            -- 'pending'|'running'|'completed'|'failed'|'compensating'|'compensated'
    input           TEXT,   -- JSON
    output          TEXT,   -- JSON
    error           TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    started_at      BIGINT  NOT NULL,
    completed_at    BIGINT,

    CONSTRAINT workflow_instance_steps_pk PRIMARY KEY (id),
    CONSTRAINT workflow_instance_steps_status_values
        CHECK (status IN ('pending','running','completed','failed','compensating','compensated')),
    CONSTRAINT workflow_instance_steps_attempts_nonneg CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS ws_workflow_step_idx
    ON workflow_instance_steps (workflow_id, step_name);

CREATE INDEX IF NOT EXISTS ws_workflow_status_idx
    ON workflow_instance_steps (workflow_id, status);

-- workflow_instance_steps is tenant-scoped through its workflow_instance; no separate
-- tenant_id column here because the FK cascade covers deletion and RLS can
-- join through workflow_instances. We skip RLS on this table and rely on
-- application-layer joins always scoping through a tenant-filtered parent.

-- ---------------------------------------------------------------------------
-- 4. workflow_events
--    Append-only audit trail for workflow lifecycle events (started, step
--    completed, failed, compensated, etc.).
--    Written by OrchestrationLogger.
--    Prefix: wev_
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_events (
    id              TEXT    NOT NULL,
    workflow_id     TEXT    NOT NULL,
    type            TEXT    NOT NULL,   -- EventTypes.WORKFLOW_STARTED etc.
    data            TEXT    NOT NULL DEFAULT '{}',  -- JSON
    occurred_at     BIGINT  NOT NULL,

    CONSTRAINT workflow_events_pk PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS wev_workflow_occurred_idx
    ON workflow_events (workflow_id, occurred_at DESC);

-- No RLS — events are tied to a workflow_instance; read access is always
-- through the parent instance (which is already tenant-scoped).

-- ---------------------------------------------------------------------------
-- 5. workflow_locks
--    Distributed lock table used by LockManager.
--    Lock acquire: INSERT … ON CONFLICT DO NOTHING.
--    Auto-release: expired rows are deleted on the next acquire attempt.
--    No tenant_id — locks are global (cross-tenant for system-level critical
--    sections); per-tenant locks encode the tenantId in lock_key.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_locks (
    lock_key        TEXT    NOT NULL,
    holder          TEXT    NOT NULL,   -- request ID, worker ID, etc.
    acquired_at     BIGINT  NOT NULL,
    expires_at      BIGINT  NOT NULL,

    CONSTRAINT workflow_locks_pk PRIMARY KEY (lock_key)
);

CREATE INDEX IF NOT EXISTS wl_expires_idx
    ON workflow_locks (expires_at);
    -- Used by the cleanup sweep: DELETE FROM workflow_locks WHERE expires_at < NOW.

-- No RLS — global lock table; only accessible by the service role.

-- ---------------------------------------------------------------------------
-- 6. retry_state
--    Persistent exponential-backoff tracking for jobs, webhooks, and external
--    API calls. Used by RetryStateStore.
--    Prefix: rs_
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retry_state (
    id              TEXT    NOT NULL,
    operation_key   TEXT    NOT NULL,   -- caller-defined unique key for the operation
    tenant_id       TEXT    NOT NULL,
    attempt         INTEGER NOT NULL DEFAULT 1,
    last_error      TEXT,
    next_retry_at   BIGINT  NOT NULL,
    exhausted       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      BIGINT  NOT NULL,
    updated_at      BIGINT  NOT NULL,

    CONSTRAINT retry_state_pk PRIMARY KEY (id),
    CONSTRAINT retry_state_tenant_key_uq UNIQUE (tenant_id, operation_key),
    CONSTRAINT retry_state_attempt_pos CHECK (attempt >= 1)
);

CREATE INDEX IF NOT EXISTS rs_tenant_key_idx
    ON retry_state (tenant_id, operation_key);

CREATE INDEX IF NOT EXISTS rs_tenant_retry_idx
    ON retry_state (tenant_id, next_retry_at)
    WHERE exhausted = FALSE;

ALTER TABLE retry_state ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 7. job_queue
--    Postgres-backed background job queue consumed by QueueConsumer.
--    "At-least-once" delivery via FOR UPDATE SKIP LOCKED claim.
--    In Year 2 replace with BullMQ or pg-boss without changing handler sigs.
--    Prefix: job_
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_queue (
    id              TEXT    NOT NULL,
    tenant_id       TEXT    NOT NULL,
    type            TEXT    NOT NULL,   -- matches QueueNames constant
    payload         TEXT    NOT NULL DEFAULT '{}',   -- JSON
    status          TEXT    NOT NULL DEFAULT 'pending',
                            -- 'pending'|'running'|'completed'|'failed'
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 3,
    run_at          BIGINT  NOT NULL,   -- epoch ms; earliest eligible execution time
    error           TEXT,
    created_at      BIGINT  NOT NULL,
    completed_at    BIGINT,

    CONSTRAINT job_queue_pk PRIMARY KEY (id),
    CONSTRAINT job_queue_status_values
        CHECK (status IN ('pending','running','completed','failed')),
    CONSTRAINT job_queue_attempts_nonneg    CHECK (attempts >= 0),
    CONSTRAINT job_queue_max_attempts_pos   CHECK (max_attempts >= 1)
);

-- The consumer polls this index: pending/failed + run_at ≤ now + limit.
CREATE INDEX IF NOT EXISTS jq_tenant_status_run_at_idx
    ON job_queue (tenant_id, status, run_at ASC)
    WHERE status IN ('pending', 'failed');

-- enqueueOnce deduplication check.
CREATE INDEX IF NOT EXISTS jq_tenant_type_status_idx
    ON job_queue (tenant_id, type, status)
    WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS jq_tenant_created_idx
    ON job_queue (tenant_id, created_at DESC);

ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 8. event_outbox
--    Transactional outbox for guaranteed at-least-once event delivery.
--    Rows are written inside the same DB transaction as the business mutation,
--    then the OutboxRelayJob dispatches them via the EventBus and marks them
--    dispatched=TRUE.
--    Prefix: evob_
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_outbox (
    id              TEXT    NOT NULL,
    tenant_id       TEXT    NOT NULL,
    type            TEXT    NOT NULL,   -- domain event type, e.g. 'order.created'
    aggregate_id    TEXT    NOT NULL,   -- the affected entity id
    payload         TEXT    NOT NULL DEFAULT '{}',   -- JSON
    occurred_at     TEXT    NOT NULL,   -- ISO-8601 string (matches DomainEvent)
    dispatched      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      BIGINT  NOT NULL,

    CONSTRAINT event_outbox_pk PRIMARY KEY (id)
);

-- Relay job poll pattern: WHERE dispatched = FALSE ORDER BY created_at ASC LIMIT N
CREATE INDEX IF NOT EXISTS evob_undispatched_idx
    ON event_outbox (created_at ASC)
    WHERE dispatched = FALSE;

CREATE INDEX IF NOT EXISTS evob_tenant_created_idx
    ON event_outbox (tenant_id, created_at DESC);

ALTER TABLE event_outbox ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 9. RLS policies for orchestration tables
--    Simpler than commerce tables — the orchestration layer runs as a
--    service role that sets app.tenant_id before every query (same as the
--    rest of the app via db.withTenant()).
-- ---------------------------------------------------------------------------
CREATE POLICY IF NOT EXISTS workflow_instances_tenant_isolation
    ON workflow_instances
    USING (tenant_id = current_setting('app.tenant_id'));

CREATE POLICY IF NOT EXISTS retry_state_tenant_isolation
    ON retry_state
    USING (tenant_id = current_setting('app.tenant_id'));

CREATE POLICY IF NOT EXISTS job_queue_tenant_isolation
    ON job_queue
    USING (tenant_id = current_setting('app.tenant_id'));

CREATE POLICY IF NOT EXISTS event_outbox_tenant_isolation
    ON event_outbox
    USING (tenant_id = current_setting('app.tenant_id'));

-- ---------------------------------------------------------------------------
-- End of migration 0003_orchestration
-- ---------------------------------------------------------------------------
