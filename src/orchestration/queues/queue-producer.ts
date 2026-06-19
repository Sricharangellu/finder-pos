import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { JobRow, EnqueueJobOptions } from "../types.js";

export const QueueNames = {
  ECOMMERCE_SYNC: "ecommerce_sync",
  PAYMENT_RECONCILIATION: "payment_reconciliation",
  ACCOUNTING_POSTING: "accounting_posting",
  EXPIRE_RESERVATIONS: "expire_reservations",
  CLOSE_REGISTER: "close_register",
  CUSTOMER_NOTIFICATION: "customer_notification",
} as const;

export class QueueProducer {
  constructor(private readonly db: DB) {}

  async enqueue(opts: EnqueueJobOptions): Promise<JobRow> {
    const now = Date.now();
    const row: JobRow = {
      id: `job_${uuidv7()}`,
      type: opts.type,
      payload: JSON.stringify(opts.payload),
      tenant_id: opts.tenantId,
      status: "pending",
      attempts: 0,
      max_attempts: opts.maxAttempts ?? 3,
      run_at: opts.runAt ?? now,
      error: null,
      created_at: now,
      completed_at: null,
    };
    await this.db.query(
      `INSERT INTO job_queue (id, type, payload, tenant_id, status, attempts, max_attempts, run_at, error, created_at, completed_at)
       VALUES (@id, @type, @payload, @tenant_id, @status, @attempts, @max_attempts, @run_at, @error, @created_at, @completed_at)`,
      row as unknown as Record<string, unknown>,
    );
    return row;
  }

  /** Enqueue a job only if no pending/running job of the same type exists for the tenant. */
  async enqueueOnce(opts: EnqueueJobOptions): Promise<JobRow | null> {
    const existing = await this.db.one<{ id: string }>(
      "SELECT id FROM job_queue WHERE tenant_id = @tenantId AND type = @type AND status IN ('pending','running') LIMIT 1",
      { tenantId: opts.tenantId, type: opts.type },
    );
    if (existing) return null;
    return this.enqueue(opts);
  }
}
