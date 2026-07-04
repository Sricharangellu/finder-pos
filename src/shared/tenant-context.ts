import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped tenant context.
 *
 * The gateway's tenantResolver enters this store with the authenticated
 * tenant id after JWT verification; the DB layer (shared/db.ts) reads it and
 * sets `app.tenant_id` (transaction-local) on every query issued anywhere in
 * that request's async context. Postgres RLS policies then enforce tenant
 * isolation even when a query forgets its `WHERE tenant_id = ...` clause —
 * the defense-in-depth backstop described in db/rls/policies.sql.
 *
 * Code running outside a request (bootstrap, migrations, background jobs,
 * the queue consumer) has no context, so its queries stay unscoped and the
 * permissive-when-unset policy preserves existing behavior.
 */
const store = new AsyncLocalStorage<string>();

/** Run fn with every DB query inside it scoped to tenantId. */
export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  return store.run(tenantId, fn);
}

/** The tenant id of the current async context, if any. */
export function currentTenantId(): string | undefined {
  return store.getStore();
}
