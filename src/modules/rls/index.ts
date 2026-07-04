import type { PosModule } from "../types.js";

/**
 * Enable Postgres row-level security on every tenant-scoped table as
 * defense-in-depth. The policy is intentionally permissive when
 * `app.tenant_id` is unset (empty / null) so existing code that relies on
 * SQL-level `WHERE tenant_id = @tenantId` filtering continues to work.
 * When `app.tenant_id` IS set (via `db.withTenant(tenantId)`), the policy
 * blocks access to rows belonging to a different tenant — catching any bug
 * that forgets the WHERE clause.
 *
 * Policy logic:
 *   tenant_id IS NULL                    → platform-global rows (e.g. global
 *                                          feature flags) visible to everyone
 *   tenant_id = 'system'                 → system job/outbox rows visible to
 *                                          everyone (the /jobs endpoint reads them)
 *   COALESCE(current_setting('app.tenant_id', true), '') IN ('', tenant_id::text)
 *
 *   unset / '' → allow all rows  (backwards-compatible with code not yet using withTenant)
 *   set to X  → allow only rows where tenant_id = X
 *
 * The context is now set automatically for every authenticated request: the
 * gateway's tenantResolver enters an AsyncLocalStorage scope (shared/
 * tenant-context.ts) and shared/db.ts sets app.tenant_id on every query in
 * that scope — a forgotten WHERE tenant_id clause can no longer leak rows.
 *
 * FORCE ROW LEVEL SECURITY applies the policy even to the table owner so the
 * app user (who owns the tables) is subject to the same rules.
 *
 * Idempotent: the DO block checks pg_policies before creating, and
 * ALTER TABLE … ENABLE ROW LEVEL SECURITY is a no-op when already enabled.
 */
const MIGRATION = `
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT DISTINCT table_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND column_name = 'tenant_id'
    ORDER BY table_name
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    -- Recreate so policy edits here roll out to existing databases (the
    -- migration string's content hash changes, which re-runs this block).
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (
         tenant_id IS NULL
         OR tenant_id::text = ''system''
         OR COALESCE(current_setting(''app.tenant_id'', true), '''') IN ('''', tenant_id::text)
       )',
      tbl
    );
  END LOOP;
END $$;
`;

export const rlsModule: PosModule = {
  name: "rls",
  migrations: [MIGRATION],
  register() {
    // No routes — DB-layer security only.
  },
};
