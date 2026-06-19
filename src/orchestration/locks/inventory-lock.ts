import type { DB } from "../../shared/db.js";
import { LockManager } from "./lock-manager.js";

/**
 * Inventory-specific locking helper.
 * Prevents concurrent modifications to the same product's inventory
 * across concurrent checkout or adjustment requests.
 */
export class InventoryLock {
  private readonly manager: LockManager;

  constructor(db: DB) {
    this.manager = new LockManager(db);
  }

  lockKey(tenantId: string, productId: string): string {
    return `inv:${tenantId}:${productId}`;
  }

  async withInventoryLock<T>(
    tenantId: string,
    productId: string,
    holder: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.manager.withLock(this.lockKey(tenantId, productId), holder, fn, 15_000);
  }
}
