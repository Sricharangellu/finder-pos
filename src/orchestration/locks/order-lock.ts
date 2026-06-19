import type { DB } from "../../shared/db.js";
import { LockManager } from "./lock-manager.js";

/**
 * Order-specific locking helper.
 * Prevents concurrent state mutations on the same order
 * (e.g. simultaneous refund + fulfillment update).
 */
export class OrderLock {
  private readonly manager: LockManager;

  constructor(db: DB) {
    this.manager = new LockManager(db);
  }

  lockKey(tenantId: string, orderId: string): string {
    return `order:${tenantId}:${orderId}`;
  }

  async withOrderLock<T>(
    tenantId: string,
    orderId: string,
    holder: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.manager.withLock(this.lockKey(tenantId, orderId), holder, fn, 10_000);
  }
}
