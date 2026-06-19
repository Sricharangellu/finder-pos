import type { EventBus } from "../../shared/events.js";
import type { WorkflowRunner } from "../workflow-runner.js";
import { EventTypes } from "../events/event-types.js";

/**
 * Checkout Saga
 *
 * Bridges raw POS events to the CheckoutWorkflow.
 * A saga differs from a workflow in that it reacts to *multiple* events
 * across time (e.g. order.created → payment.captured → checkout.completed),
 * maintains its own correlation, and may coordinate compensations across
 * those lifecycle stages.
 *
 * In Year 1 the saga is thin: it subscribes to the required events and
 * delegates execution to the WorkflowRunner. Saga state is tracked in
 * the workflow_instances table (same as workflows).
 */
export function registerCheckoutSaga(runner: WorkflowRunner, events: EventBus): void {
  // The WorkflowRunner already subscribes checkout.workflow to order.created.
  // The saga adds *additional* cross-cutting listeners.

  // On payment captured: if the order workflow didn't already complete checkout,
  // we may need to trigger reconciliation for partial-capture scenarios.
  events.on(EventTypes.PAYMENT_CAPTURED, async (event) => {
    const payload = event.payload as Record<string, unknown>;
    const tenantId = payload["tenantId"] as string;
    const orderId = payload["orderId"] as string;
    if (!tenantId || !orderId) return;

    // Signal that checkout is fully paid — the order_fulfillment workflow
    // picks this up via its own trigger on payment.captured.
    // Here we only emit checkout-specific analytics event.
    await events.publish("checkout.payment_confirmed", {
      tenantId,
      orderId,
      amountCents: payload["amountCents"],
    });
  });

  // On order.voided: ensure any in-flight checkout workflow is compensated.
  events.on(EventTypes.ORDER_VOIDED, async (event) => {
    const payload = event.payload as Record<string, unknown>;
    const tenantId = payload["tenantId"] as string;
    const orderId = payload["orderId"] as string;
    if (!tenantId || !orderId) return;

    // Start a reversal pass if checkout had already posted accounting.
    await runner.start("checkout", { ...payload, orderId, _action: "compensate" }, tenantId).catch(
      (err) => console.error(`[checkout-saga] void compensation failed: ${err instanceof Error ? err.message : err}`),
    );
  });
}
