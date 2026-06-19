import type { DB } from "../../shared/db.js";

const DEFAULT_TTL_MS = 30_000; // 30 seconds

/**
 * Distributed lock manager backed by a Postgres table.
 * Uses INSERT … ON CONFLICT DO NOTHING as an optimistic lock acquire,
 * and a TTL so crashed holders release automatically.
 *
 * For per-row locks inside a transaction, prefer `db.tx()` + SELECT … FOR UPDATE.
 * This manager is for cross-request, cross-worker critical sections.
 */
export class LockManager {
  constructor(private readonly db: DB) {}

  /**
   * Try to acquire a named lock for the given holder.
   * Returns true on success, false if the lock is held by someone else.
   * Always call release() after the critical section.
   */
  async tryAcquire(
    lockKey: string,
    holder: string,
    ttlMs = DEFAULT_TTL_MS,
  ): Promise<boolean> {
    const now = Date.now();
    // First evict any expired lock for this key.
    await this.db.query(
      "DELETE FROM workflow_locks WHERE lock_key = @lockKey AND expires_at < @now",
      { lockKey, now },
    );
    try {
      await this.db.query(
        `INSERT INTO workflow_locks (lock_key, holder, acquired_at, expires_at)
         VALUES (@lockKey, @holder, @now, @expiresAt)`,
        { lockKey, holder, now, expiresAt: now + ttlMs },
      );
      return true;
    } catch (err) {
      // Unique constraint violation — someone else holds the lock.
      if ((err as { code?: string }).code === "23505") return false;
      throw err;
    }
  }

  /** Acquire with spin-wait up to timeoutMs. Throws on timeout. */
  async acquire(
    lockKey: string,
    holder: string,
    ttlMs = DEFAULT_TTL_MS,
    timeoutMs = 10_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.tryAcquire(lockKey, holder, ttlMs)) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`lock '${lockKey}' not acquired within ${timeoutMs}ms`);
  }

  async release(lockKey: string, holder: string): Promise<void> {
    await this.db.query(
      "DELETE FROM workflow_locks WHERE lock_key = @lockKey AND holder = @holder",
      { lockKey, holder },
    );
  }

  /** Execute fn while holding the lock. Always releases on exit. */
  async withLock<T>(
    lockKey: string,
    holder: string,
    fn: () => Promise<T>,
    ttlMs?: number,
  ): Promise<T> {
    await this.acquire(lockKey, holder, ttlMs);
    try {
      return await fn();
    } finally {
      await this.release(lockKey, holder);
    }
  }
}
