import { createHash } from "node:crypto";
import type { DB } from "../../shared/db.js";
import type { IdempotencyKeyRow } from "../types.js";

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class IdempotencyStore {
  constructor(private readonly db: DB) {}

  /**
   * Hash an arbitrary key to a stable 64-char hex string.
   * Prevents injection via user-supplied strings used as DB keys.
   */
  static hash(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }

  /**
   * Check if a key has already been processed.
   * Returns the cached result JSON if so, or null if this is a new key.
   */
  async check(tenantId: string, key: string): Promise<string | null> {
    const hashed = IdempotencyStore.hash(key);
    const row = await this.db.one<IdempotencyKeyRow>(
      "SELECT result FROM idempotency_keys WHERE tenant_id = @tenantId AND key = @key AND expires_at > @now",
      { tenantId, key: hashed, now: Date.now() },
    );
    return row?.result ?? null;
  }

  /**
   * Record that a key has been processed with the given result JSON.
   * Upserts — safe to call even if the row already exists (network retry).
   */
  async record(
    tenantId: string,
    key: string,
    workflowId: string | null,
    result: unknown,
  ): Promise<void> {
    const hashed = IdempotencyStore.hash(key);
    const now = Date.now();
    await this.db.query(
      `INSERT INTO idempotency_keys (key, tenant_id, workflow_id, result, created_at, expires_at)
       VALUES (@key, @tenantId, @workflowId, @result, @now, @expiresAt)
       ON CONFLICT (tenant_id, key) DO UPDATE
         SET result = EXCLUDED.result, expires_at = EXCLUDED.expires_at`,
      {
        key: hashed,
        tenantId,
        workflowId,
        result: JSON.stringify(result),
        now,
        expiresAt: now + TTL_MS,
      },
    );
  }

  /** Remove expired keys (run as part of periodic cleanup job). */
  async purgeExpired(): Promise<number> {
    const rows = await this.db.query<{ count: number }>(
      "DELETE FROM idempotency_keys WHERE expires_at < @now RETURNING 1",
      { now: Date.now() },
    );
    return rows.length;
  }
}
