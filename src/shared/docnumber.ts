import type { DB } from "./db.js";

/**
 * Race-free per-(tenant, kind) document numbering.
 *
 * The legacy pattern derived a number from `SELECT COUNT(*)`, which lets two
 * concurrent creates pick the same value and collide on a UNIQUE constraint.
 * This allocates the next value with a single atomic upsert-increment — the row
 * lock on `document_counters(tenant_id, kind)` serialises concurrent callers, so
 * each gets a distinct, monotonic number (gaps on rollback are fine; numbers are
 * never reused).
 *
 * Counters are seeded per adopting table from its current MAX suffix (see each
 * module's migration), so existing numbering continues without collision.
 */
export async function nextDocNumber(
  db: DB,
  tenantId: string,
  kind: string,
  prefix: string,
  pad = 5,
): Promise<string> {
  const row = await db.one<{ val: string | number }>(
    `INSERT INTO document_counters (tenant_id, kind, val) VALUES (@t, @k, 1)
       ON CONFLICT (tenant_id, kind) DO UPDATE SET val = document_counters.val + 1
     RETURNING val`,
    { t: tenantId, k: kind },
  );
  return `${prefix}-${String(Number(row?.val ?? 1)).padStart(pad, "0")}`;
}
