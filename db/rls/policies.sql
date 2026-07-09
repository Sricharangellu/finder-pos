-- =============================================================================
-- Row-Level Security Policies — Ascend
-- Wave:  0 — Platform foundation
--         1 — Core commerce (appended 2026-06-12)
-- Owner: DATABASE agent
--
-- DESIGN INTENT
-- ─────────────
-- Every tenant-scoped table has exactly one isolation policy. The policy
-- expression reads the current session variable app.tenant_id (set by the
-- backend per request/transaction from the verified JWT).
--
-- FAIL-CLOSED GUARANTEE
-- ─────────────────────
-- current_setting('app.tenant_id') with no second argument raises an ERROR
-- when the variable is unset. That means a request that forgets to set the
-- tenant context gets an error, not a data leak. Never use the two-argument
-- form current_setting('app.tenant_id', true) here (that returns NULL on
-- missing, which compares FALSE to any tenant_id → 0 rows, which is safe
-- but silent; the error form is better because it surfaces the bug).
--
-- TENANT-ID TYPE — RECONCILIATION NOTE (ratified 2026-06-12)
-- ────────────────────────────────────────────────────────────
-- Wave 0 tables (roles, users, audit_log, feature_flags, idempotency_keys)
-- were initially written with tenant_id UUID.  The LIVE system uses tenant
-- ids as TEXT with a 'tnt_' prefix (e.g. 'tnt_demo').  Wave 1 and all
-- future tables use tenant_id TEXT.
--
-- RLS DESIGN TARGET vs. WAVE 1 ENABLEMENT
-- ─────────────────────────────────────────
-- RLS is the DESIGN TARGET and provides defense-in-depth isolation.
-- In Wave 1 the backend enforces tenant isolation at the APPLICATION LAYER
-- (every query includes WHERE tenant_id = $tenantId from the verified JWT).
-- RLS is NOT yet activated in the backend's in-app provisioning path because
-- enabling it on the connection used during login would block the pre-auth
-- tenant lookup (the users/tenants query runs before the JWT tenant_id is
-- known).
--
-- Future enablement path:
--   1. Introduce a privileged "auth service" DB role that has BYPASSRLS
--      for the tenants + users tables only (used for login/token-issue).
--   2. All other app queries use the standard app_user role (no BYPASSRLS).
--   3. Apply: SET app.tenant_id = '<tnt_...>' per transaction from JWT.
--   4. With that split in place, enable RLS globally and run the tenancy
--      test suite (see db/README.md) in CI.
--
-- SERVICE ACCOUNT BYPASS
-- ──────────────────────
-- The migration runner and backup roles are granted BYPASSRLS. Application
-- roles must NOT have BYPASSRLS.
-- Example DDL (run once during provisioning, outside this file):
--   CREATE ROLE app_user NOINHERIT LOGIN;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
--       TO app_user;
--   -- app_user does NOT have BYPASSRLS, so all policies apply.
--
-- READ + WRITE POLICIES
-- ─────────────────────
-- Each table gets two policies:
--   tenant_isolation_select  — SELECT (USING clause only)
--   tenant_isolation_write   — INSERT / UPDATE / DELETE
--       INSERT uses WITH CHECK; UPDATE/DELETE use USING + WITH CHECK.
-- This matches the recommended PostgreSQL pattern for separating read/write
-- enforcement.
--
-- COMPARISON SYNTAX
-- ─────────────────
-- Wave 0 policies (UUID tenant_id):  tenant_id = current_setting(...)::uuid
-- Wave 1+ policies (TEXT tenant_id): tenant_id = current_setting(...)
--   NO CAST — TEXT = TEXT comparison.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: human-readable note about the sentinel for feature_flags
-- ---------------------------------------------------------------------------
-- Global flags use tenant_id = '00000000-0000-0000-0000-000000000000'.
-- The policy below lets any tenant see global flags AND their own flags.
-- ---------------------------------------------------------------------------

-- ============================================================
-- TABLE: roles
-- ============================================================
DROP POLICY IF EXISTS tenant_isolation_select ON roles;
CREATE POLICY tenant_isolation_select ON roles
    FOR SELECT
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_write ON roles;
CREATE POLICY tenant_isolation_write ON roles
    FOR ALL
    USING  (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- ============================================================
-- TABLE: users
-- ============================================================
DROP POLICY IF EXISTS tenant_isolation_select ON users;
CREATE POLICY tenant_isolation_select ON users
    FOR SELECT
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_write ON users;
CREATE POLICY tenant_isolation_write ON users
    FOR ALL
    USING  (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- ============================================================
-- TABLE: audit_log  (append-only — no UPDATE/DELETE for app role)
-- ============================================================
DROP POLICY IF EXISTS tenant_isolation_select ON audit_log;
CREATE POLICY tenant_isolation_select ON audit_log
    FOR SELECT
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_insert ON audit_log;
CREATE POLICY tenant_isolation_insert ON audit_log
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Deliberately NO UPDATE or DELETE policy for audit_log — app role cannot
-- modify or delete audit entries. The migration/service role (BYPASSRLS) can
-- for retention/archival purposes only.

-- ============================================================
-- TABLE: feature_flags
-- A flag is visible if it belongs to this tenant OR is a global flag
-- (sentinel tenant_id '00000000-0000-0000-0000-000000000000').
-- Writes are only allowed to the tenant's own flags (not globals).
-- ============================================================
DROP POLICY IF EXISTS tenant_isolation_select ON feature_flags;
CREATE POLICY tenant_isolation_select ON feature_flags
    FOR SELECT
    USING (
        tenant_id = current_setting('app.tenant_id')::uuid
        OR tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
    );

DROP POLICY IF EXISTS tenant_isolation_write ON feature_flags;
CREATE POLICY tenant_isolation_write ON feature_flags
    FOR ALL
    USING  (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- ============================================================
-- TABLE: idempotency_keys
-- ============================================================
DROP POLICY IF EXISTS tenant_isolation_select ON idempotency_keys;
CREATE POLICY tenant_isolation_select ON idempotency_keys
    FOR SELECT
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_write ON idempotency_keys;
CREATE POLICY tenant_isolation_write ON idempotency_keys
    FOR ALL
    USING  (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- =============================================================================
-- WAVE 1 — Core commerce policies
-- Tables: products, inventory, inventory_movements, orders, order_lines,
--         payments, sync_queue
-- tenant_id type: TEXT  (tnt_<slug> — NO ::uuid cast in predicates)
-- Migration: db/migrations/0002_commerce.sql
-- Added: 2026-06-12
-- =============================================================================

-- ============================================================
-- TABLE: products
-- ============================================================
DROP POLICY IF EXISTS tenant_isolation_select ON products;
CREATE POLICY tenant_isolation_select ON products
    FOR SELECT
    USING (tenant_id = current_setting('app.tenant_id'));

DROP POLICY IF EXISTS tenant_isolation_write ON products;
CREATE POLICY tenant_isolation_write ON products
    FOR ALL
    USING  (tenant_id = current_setting('app.tenant_id'))
    WITH CHECK (tenant_id = current_setting('app.tenant_id'));

-- ============================================================
-- TABLE: inventory
-- ============================================================
DROP POLICY IF EXISTS tenant_isolation_select ON inventory;
CREATE POLICY tenant_isolation_select ON inventory
    FOR SELECT
    USING (tenant_id = current_setting('app.tenant_id'));

DROP POLICY IF EXISTS tenant_isolation_write ON inventory;
CREATE POLICY tenant_isolation_write ON inventory
    FOR ALL
    USING  (tenant_id = current_setting('app.tenant_id'))
    WITH CHECK (tenant_id = current_setting('app.tenant_id'));

-- ============================================================
-- TABLE: inventory_movements  (append-only — no UPDATE/DELETE for app role)
-- ============================================================
DROP POLICY IF EXISTS tenant_isolation_select ON inventory_movements;
CREATE POLICY tenant_isolation_select ON inventory_movements
    FOR SELECT
    USING (tenant_id = current_setting('app.tenant_id'));

DROP POLICY IF EXISTS tenant_isolation_insert ON inventory_movements;
CREATE POLICY tenant_isolation_insert ON inventory_movements
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.tenant_id'));

-- Deliberately NO UPDATE or DELETE policy on inventory_movements.
-- The ledger is immutable; corrections are made via new adjustment rows.

-- ============================================================
-- TABLE: orders
-- ============================================================
DROP POLICY IF EXISTS tenant_isolation_select ON orders;
CREATE POLICY tenant_isolation_select ON orders
    FOR SELECT
    USING (tenant_id = current_setting('app.tenant_id'));

DROP POLICY IF EXISTS tenant_isolation_write ON orders;
CREATE POLICY tenant_isolation_write ON orders
    FOR ALL
    USING  (tenant_id = current_setting('app.tenant_id'))
    WITH CHECK (tenant_id = current_setting('app.tenant_id'));

-- ============================================================
-- TABLE: order_lines
-- ============================================================
DROP POLICY IF EXISTS tenant_isolation_select ON order_lines;
CREATE POLICY tenant_isolation_select ON order_lines
    FOR SELECT
    USING (tenant_id = current_setting('app.tenant_id'));

DROP POLICY IF EXISTS tenant_isolation_write ON order_lines;
CREATE POLICY tenant_isolation_write ON order_lines
    FOR ALL
    USING  (tenant_id = current_setting('app.tenant_id'))
    WITH CHECK (tenant_id = current_setting('app.tenant_id'));

-- ============================================================
-- TABLE: payments
-- ============================================================
DROP POLICY IF EXISTS tenant_isolation_select ON payments;
CREATE POLICY tenant_isolation_select ON payments
    FOR SELECT
    USING (tenant_id = current_setting('app.tenant_id'));

DROP POLICY IF EXISTS tenant_isolation_write ON payments;
CREATE POLICY tenant_isolation_write ON payments
    FOR ALL
    USING  (tenant_id = current_setting('app.tenant_id'))
    WITH CHECK (tenant_id = current_setting('app.tenant_id'));

-- ============================================================
-- TABLE: sync_queue
-- ============================================================
DROP POLICY IF EXISTS tenant_isolation_select ON sync_queue;
CREATE POLICY tenant_isolation_select ON sync_queue
    FOR SELECT
    USING (tenant_id = current_setting('app.tenant_id'));

DROP POLICY IF EXISTS tenant_isolation_write ON sync_queue;
CREATE POLICY tenant_isolation_write ON sync_queue
    FOR ALL
    USING  (tenant_id = current_setting('app.tenant_id'))
    WITH CHECK (tenant_id = current_setting('app.tenant_id'));

-- =============================================================================
-- END OF WAVE 1 POLICIES
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Verification query (run to confirm no tenant-scoped table lacks a policy)
-- ---------------------------------------------------------------------------
-- SELECT tablename, rowsecurity, forceroWsecurity
-- FROM   pg_tables
-- WHERE  schemaname = 'public'
-- ORDER BY tablename;
--
-- Every table except tenants itself should show rowsecurity = true.
-- ---------------------------------------------------------------------------
