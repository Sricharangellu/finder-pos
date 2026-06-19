import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";

export interface VoidPaymentOptions {
  orderId: string;
  tenantId: string;
  amountCents: number;
  paymentId?: string;
}

/**
 * Standalone compensation: void a captured payment authorization.
 * Safe to call even if payment was never fully captured — the payments
 * module handles the idempotency.
 */
export async function voidPaymentCompensation(
  opts: VoidPaymentOptions,
  db: DB,
  events: EventBus,
): Promise<void> {
  // Mark any pending/authorized payments for this order as void.
  await db.query(
    `UPDATE payments
       SET status = 'voided', updated_at = @now
     WHERE order_id = @orderId AND tenant_id = @tenantId
       AND status IN ('authorized', 'pending')`,
    { orderId: opts.orderId, tenantId: opts.tenantId, now: Date.now() },
  );
  await events.publish("payment.voided", {
    tenantId: opts.tenantId,
    orderId: opts.orderId,
    paymentId: opts.paymentId,
    amountCents: opts.amountCents,
    reason: "checkout_compensation",
  });
}
