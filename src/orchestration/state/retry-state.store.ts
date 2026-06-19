import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";

export interface RetryRecord {
  id: string;
  operation_key: string;
  tenant_id: string;
  attempt: number;
  last_error: string | null;
  next_retry_at: number;
  exhausted: boolean;
  created_at: number;
  updated_at: number;
}

/**
 * Tracks retry state for operations outside the main workflow engine.
 * Used by jobs, webhooks, and external API calls that need
 * persistent exponential-backoff tracking.
 */
export class RetryStateStore {
  constructor(private readonly db: DB) {}

  async get(operationKey: string, tenantId: string): Promise<RetryRecord | undefined> {
    return this.db.one<RetryRecord>(
      "SELECT * FROM retry_state WHERE operation_key = @key AND tenant_id = @tenantId",
      { key: operationKey, tenantId },
    );
  }

  async record(
    operationKey: string,
    tenantId: string,
    error: string | null,
    nextRetryDelayMs: number,
    maxAttempts = 5,
  ): Promise<RetryRecord> {
    const now = Date.now();
    const existing = await this.get(operationKey, tenantId);

    if (existing) {
      const attempt = existing.attempt + 1;
      const exhausted = attempt >= maxAttempts;
      const nextRetryAt = exhausted ? 0 : now + nextRetryDelayMs;
      await this.db.query(
        `UPDATE retry_state
           SET attempt = @attempt, last_error = @error, next_retry_at = @nextRetryAt,
               exhausted = @exhausted, updated_at = @now
         WHERE operation_key = @key AND tenant_id = @tenantId`,
        { attempt, error, nextRetryAt, exhausted: exhausted ? 1 : 0, now, key: operationKey, tenantId },
      );
      return { ...existing, attempt, last_error: error, next_retry_at: nextRetryAt, exhausted, updated_at: now };
    }

    const row: RetryRecord = {
      id: `rs_${uuidv7()}`,
      operation_key: operationKey,
      tenant_id: tenantId,
      attempt: 1,
      last_error: error,
      next_retry_at: now + nextRetryDelayMs,
      exhausted: false,
      created_at: now,
      updated_at: now,
    };
    await this.db.query(
      `INSERT INTO retry_state
         (id, operation_key, tenant_id, attempt, last_error, next_retry_at, exhausted, created_at, updated_at)
       VALUES
         (@id, @key, @tenantId, @attempt, @error, @nextRetryAt, 0, @now, @now)`,
      { id: row.id, key: operationKey, tenantId, attempt: 1, error, nextRetryAt: row.next_retry_at, now },
    );
    return row;
  }

  async clear(operationKey: string, tenantId: string): Promise<void> {
    await this.db.query(
      "DELETE FROM retry_state WHERE operation_key = @key AND tenant_id = @tenantId",
      { key: operationKey, tenantId },
    );
  }
}
