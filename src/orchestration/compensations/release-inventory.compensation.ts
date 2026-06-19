import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { EventTypes } from "../events/event-types.js";

export interface ReleaseInventoryOptions {
  orderId: string;
  tenantId: string;
  lines?: Array<{ productId: string; quantity: number }>;
}

/**
 * Standalone compensation: release inventory reservation.
 * Used both inline by workflows and as a standalone compensation when
 * a higher-level orchestrator determines inventory must be freed.
 */
export async function releaseInventoryCompensation(
  opts: ReleaseInventoryOptions,
  _db: DB,
  events: EventBus,
): Promise<void> {
  await events.publish(EventTypes.INVENTORY_ADJUSTED, {
    tenantId: opts.tenantId,
    orderId: opts.orderId,
    reason: "reservation_release",
    lines: opts.lines ?? [],
  });
}
