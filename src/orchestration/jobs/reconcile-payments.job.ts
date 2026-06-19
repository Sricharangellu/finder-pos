import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { JobRow } from "../types.js";
import { EventTypes } from "../events/event-types.js";
import { v7 as uuidv7 } from "uuid";

/**
 * Reconcile Payments Job
 *
 * Nightly job that starts a PaymentReconciliationWorkflow for the previous
 * calendar day. Enqueued by the close-register job or by a cron trigger.
 */
export async function reconcilePaymentsJob(job: JobRow, _db: DB, events: EventBus): Promise<void> {
  const payload = JSON.parse(job.payload) as { tenantId?: string; fromAt?: number; toAt?: number };
  const tenantId = payload.tenantId ?? job.tenant_id;

  // Default: yesterday's window.
  const now = Date.now();
  const toAt = payload.toAt ?? now;
  const fromAt = payload.fromAt ?? (toAt - 24 * 60 * 60 * 1000);

  const batchId = `recon_${tenantId}_${fromAt}`;

  await events.publish(EventTypes.PAYMENT_RECONCILIATION_STARTED, {
    tenantId,
    batchId,
    fromAt,
    toAt,
  });

  console.info(`[reconcile-payments] started batch ${batchId} for tenant ${tenantId}`);
}
