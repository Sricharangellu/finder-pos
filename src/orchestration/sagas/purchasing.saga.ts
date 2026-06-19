import type { EventBus } from "../../shared/events.js";
import { EventTypes } from "../events/event-types.js";

/**
 * Purchasing Saga
 *
 * Tracks purchase orders from creation through receipt, AP posting,
 * and vendor payment.
 */
export function registerPurchasingSaga(events: EventBus): void {
  // When a PO is partially received, it may be received again later.
  events.on(EventTypes.PURCHASE_ORDER_RECEIVED, async (event) => {
    const p = event.payload as Record<string, unknown>;
    await events.publish("purchasing.receiving_report_requested", {
      tenantId: p["tenantId"],
      poId: p["poId"],
      supplierId: p["supplierId"],
    });
  });

  // When AP is posted for a PO, notify accounts payable team.
  events.on("purchasing.goods_received", async (event) => {
    const p = event.payload as Record<string, unknown>;
    await events.publish("notifications.ap_posting_required", {
      tenantId: p["tenantId"],
      poId: p["poId"],
      totalCostCents: p["totalCostCents"],
    });
  });

  events.on(EventTypes.PURCHASE_ORDER_CANCELLED, async (event) => {
    const p = event.payload as Record<string, unknown>;
    await events.publish("purchasing.cancellation_report", {
      tenantId: p["tenantId"],
      poId: p["poId"],
    });
  });
}
