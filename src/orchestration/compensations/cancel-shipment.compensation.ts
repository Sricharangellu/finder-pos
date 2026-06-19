import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";

export interface CancelShipmentOptions {
  shipmentId: string;
  tenantId: string;
  reason?: string;
}

/**
 * Standalone compensation: cancel a shipment record.
 * Idempotent — safe to call on already-cancelled shipments.
 */
export async function cancelShipmentCompensation(
  opts: CancelShipmentOptions,
  db: DB,
  events: EventBus,
): Promise<void> {
  const shipment = await db.one<{ id: string; status: string }>(
    "SELECT id, status FROM shipments WHERE id = @id AND tenant_id = @tenantId",
    { id: opts.shipmentId, tenantId: opts.tenantId },
  );
  if (!shipment || shipment.status === "cancelled") return;

  await db.query(
    "UPDATE shipments SET status = 'cancelled', updated_at = @now WHERE id = @id AND tenant_id = @tenantId",
    { id: opts.shipmentId, tenantId: opts.tenantId, now: Date.now() },
  );
  await events.publish("shipment.cancelled", {
    tenantId: opts.tenantId,
    shipmentId: opts.shipmentId,
    reason: opts.reason ?? "workflow_compensation",
  });
}
