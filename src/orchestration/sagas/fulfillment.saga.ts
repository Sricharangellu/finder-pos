import type { EventBus } from "../../shared/events.js";
import { EventTypes } from "../events/event-types.js";

/**
 * Fulfillment Saga
 *
 * Tracks the lifecycle of an order through pick → pack → ship → deliver.
 * Listens to fulfillment and shipping events to drive status updates.
 */
export function registerFulfillmentSaga(events: EventBus): void {
  events.on("fulfillment.pick_list_completed", async (event) => {
    const p = event.payload as Record<string, unknown>;
    await events.publish("fulfillment.pack_requested", {
      tenantId: p["tenantId"],
      orderId: p["orderId"],
      pickListId: p["pickListId"],
    });
  });

  events.on("fulfillment.pack_confirmed", async (event) => {
    const p = event.payload as Record<string, unknown>;
    await events.publish("fulfillment.shipment_requested", {
      tenantId: p["tenantId"],
      orderId: p["orderId"],
    });
  });

  events.on(EventTypes.SHIPMENT_DISPATCHED, async (event) => {
    const p = event.payload as Record<string, unknown>;
    await events.publish(EventTypes.ORDER_FULFILLMENT_COMPLETED, {
      tenantId: p["tenantId"],
      orderId: p["orderId"],
      shipmentId: p["shipmentId"],
    });
  });

  events.on(EventTypes.SHIPMENT_DELIVERED, async (event) => {
    const p = event.payload as Record<string, unknown>;
    await events.publish("customer.notification_requested", {
      tenantId: p["tenantId"],
      orderId: p["orderId"],
      template: "order_delivered",
    });
  });
}
