import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { JobRow } from "../types.js";

const RESERVATION_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Expire Reservations Job
 *
 * Cleans up stale inventory reservations for orders that were abandoned
 * at checkout (cart timeout, browser close, etc.).
 */
export async function expireReservationsJob(job: JobRow, db: DB, events: EventBus): Promise<void> {
  const cutoff = Date.now() - RESERVATION_TTL_MS;
  const stale = await db.query<{ id: string; tenant_id: string; order_id: string }>(
    `SELECT id, tenant_id, order_id FROM inventory_reservations
      WHERE status = 'reserved' AND reserved_at < @cutoff`,
    { cutoff },
  );

  for (const reservation of stale) {
    await db.query(
      "UPDATE inventory_reservations SET status = 'expired', expired_at = @now WHERE id = @id",
      { id: reservation.id, now: Date.now() },
    );
    // Release the held inventory.
    await events.publish("inventory.reservation_released", {
      tenantId: reservation.tenant_id,
      orderId: reservation.order_id,
      reservationId: reservation.id,
      reason: "timeout",
    });
  }

  if (stale.length > 0) {
    console.info(`[expire-reservations] expired ${stale.length} stale reservation(s)`);
  }
}
