-- =============================================================================
-- Rollback: 0003_orchestration
-- Wave:     2 — Orchestration (workflow instances/steps/events/locks, retry
--               state, job queue, event outbox)
-- Owner:    DATABASE agent
--
-- Reverses 0003_orchestration.sql:
--   1. Drops the orchestration tables in reverse-dependency order. Each table's
--      indexes are dropped automatically with the table.
--   2. Reverts the additive changes 0003 made to the pre-existing
--      idempotency_keys table (added columns, the composite index, and the
--      default/nullability tweaks).
--
-- NOTE: idempotency_keys is created by 0001_foundation and is NOT dropped here —
-- only the columns/index/defaults 0003 introduced are reverted. The column-
-- default reversions are best-effort: 0003 added these defaults to fix
-- previously-missing ones, so dropping them restores the pre-0003 (no-default)
-- state described in that migration's header.
-- =============================================================================

-- ── 1. Orchestration tables (reverse creation order) ─────────────────────────
DROP TABLE IF EXISTS event_outbox;
DROP TABLE IF EXISTS job_queue;
DROP TABLE IF EXISTS retry_state;
DROP TABLE IF EXISTS workflow_locks;
DROP TABLE IF EXISTS workflow_events;
DROP TABLE IF EXISTS workflow_instance_steps;
DROP TABLE IF EXISTS workflow_instances;

-- ── 2. Revert idempotency_keys additions ─────────────────────────────────────
-- Composite index added by 0003.
DROP INDEX IF EXISTS idempotency_keys_tenant_key_expires_idx;

-- Columns added by 0003.
ALTER TABLE idempotency_keys DROP COLUMN IF EXISTS expires_at;
ALTER TABLE idempotency_keys DROP COLUMN IF EXISTS created_at;
ALTER TABLE idempotency_keys DROP COLUMN IF EXISTS result;
ALTER TABLE idempotency_keys DROP COLUMN IF EXISTS workflow_id;

-- Default / nullability changes 0003 made (reverse of its ALTER COLUMNs).
-- request_hash was NOT NULL before 0003 dropped it; backfill any NULLs written
-- since so restoring the constraint cannot fail on existing data.
UPDATE idempotency_keys SET request_hash = '' WHERE request_hash IS NULL;
ALTER TABLE idempotency_keys ALTER COLUMN request_hash SET NOT NULL;
ALTER TABLE idempotency_keys ALTER COLUMN request_hash DROP DEFAULT;
ALTER TABLE idempotency_keys ALTER COLUMN ts DROP DEFAULT;
ALTER TABLE idempotency_keys ALTER COLUMN id DROP DEFAULT;

-- ---------------------------------------------------------------------------
-- End of rollback 0003_orchestration
-- ---------------------------------------------------------------------------
