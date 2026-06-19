import type { DB } from "../../shared/db.js";
import { LockManager } from "./lock-manager.js";

/**
 * Register/session locking.
 * Prevents concurrent register open/close operations on the same outlet.
 */
export class RegisterLock {
  private readonly manager: LockManager;

  constructor(db: DB) {
    this.manager = new LockManager(db);
  }

  lockKey(tenantId: string, outletId: string): string {
    return `register:${tenantId}:${outletId}`;
  }

  async withRegisterLock<T>(
    tenantId: string,
    outletId: string,
    holder: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.manager.withLock(this.lockKey(tenantId, outletId), holder, fn, 20_000);
  }
}
