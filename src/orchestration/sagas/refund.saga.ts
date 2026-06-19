import type { EventBus } from "../../shared/events.js";

/**
 * Refund Saga
 *
 * Orchestrates the multi-step lifecycle of a refund:
 * requested → validated → payment_reversed → inventory_restored → accounting_reversed → completed
 *
 * The heavy lifting is in RefundWorkflow. This saga adds cross-cutting
 * listeners for exception handling and downstream notifications.
 */
export function registerRefundSaga(events: EventBus): void {
  events.on("refund.exception", async (event) => {
    const p = event.payload as Record<string, unknown>;
    // Alert finance team of failed compensation scenario.
    await events.publish("notifications.refund_exception", {
      tenantId: p["tenantId"],
      refundId: p["refundId"],
      orderId: p["orderId"],
      reason: p["reason"],
    });
  });

  events.on("refund.completed", async (event) => {
    const p = event.payload as Record<string, unknown>;
    // Trigger any downstream analytics or loyalty recalculation.
    await events.publish("reports.refund_recorded", {
      tenantId: p["tenantId"],
      refundId: p["refundId"],
      orderId: p["orderId"],
      refundCents: p["refundCents"],
    });
  });
}
