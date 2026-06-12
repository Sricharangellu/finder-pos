/**
 * Idempotent upgrade guard for the Wave 0 → Wave 1 multi-tenant migration.
 *
 * Wave 1 added `tenant_id` to every commerce table. `CREATE TABLE IF NOT EXISTS`
 * cannot add a column to a table that already exists, so a database provisioned
 * by the pre-tenant code would keep the old (tenant-less) shape. This guard drops
 * such a legacy table so the tenant-aware `CREATE TABLE` that follows recreates it.
 *
 * Safe by construction:
 *  - No-op when the table does not exist (fresh DB / per-test schemas).
 *  - No-op once migrated (the table has a `tenant_id` column).
 *  - Scoped to the connection's current schema (search_path), so test schemas
 *    and production `public` are handled identically.
 *
 * Commerce data in this project is disposable demo/seed data; catalog re-seeds on
 * boot. Only legacy pre-tenant tables are ever dropped.
 */
export function dropLegacyNoTenant(table: string): string {
  return `DO $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = '${table}'
      )
     AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = '${table}' AND column_name = 'tenant_id'
      )
  THEN
    EXECUTE 'DROP TABLE ${table} CASCADE';
  END IF;
END $$;`;
}
