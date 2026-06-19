import type { EventBus } from "../../shared/events.js";
import { EventTypes } from "../events/event-types.js";

/**
 * Ecommerce Sync Saga
 *
 * Coordinates the full lifecycle of ecommerce sync:
 * webhook received → idempotency check → sync workflow → status update → retry on failure
 */
export function registerEcommerceSyncSaga(events: EventBus): void {
  // On sync failed: preserve payload and schedule retry.
  events.on(EventTypes.ECOMMERCE_SYNC_FAILED, async (event) => {
    const p = event.payload as Record<string, unknown>;
    await events.publish("ecommerce.sync_retry_scheduled", {
      tenantId: p["tenantId"],
      platform: p["platform"],
      syncRunId: p["syncRunId"],
      reason: p["reason"],
      retryAt: Date.now() + 5 * 60 * 1000, // retry in 5 minutes
    });
  });

  // On new ecommerce order received: enrich and route internally.
  events.on(EventTypes.ECOMMERCE_ORDER_RECEIVED, async (event) => {
    const p = event.payload as Record<string, unknown>;
    await events.publish("orders.ecommerce_import_requested", {
      tenantId: p["tenantId"],
      platform: p["platform"],
      externalOrder: p["payload"],
    });
  });

  // On sync completed: schedule next incremental sync.
  events.on(EventTypes.ECOMMERCE_SYNC_COMPLETED, async (event) => {
    const p = event.payload as Record<string, unknown>;
    await events.publish("ecommerce.sync_cursor_updated", {
      tenantId: p["tenantId"],
      platform: p["platform"],
      syncRunId: p["syncRunId"],
      completedAt: Date.now(),
    });
  });
}
