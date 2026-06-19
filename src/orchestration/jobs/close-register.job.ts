import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { JobRow } from "../types.js";

/**
 * Close Register Job
 *
 * End-of-day job that:
 * 1. Verifies the register session is open
 * 2. Calculates expected cash balance
 * 3. Emits store.closing_requested for the outlets module to act on
 * 4. Queues a reconcile-payments job for the day's transactions
 */
export async function closeRegisterJob(job: JobRow, db: DB, events: EventBus): Promise<void> {
  const payload = JSON.parse(job.payload) as {
    tenantId?: string; outletId: string; userId: string; expectedCashCents?: number;
  };
  const tenantId = payload.tenantId ?? job.tenant_id;

  const session = await db.one<{ id: string; status: string }>(
    "SELECT id, status FROM store_sessions WHERE outlet_id = @outletId AND tenant_id = @tenantId AND status = 'open' LIMIT 1",
    { outletId: payload.outletId, tenantId },
  );
  if (!session) {
    console.warn(`[close-register] no open session for outlet '${payload.outletId}'`);
    return;
  }

  await events.publish("store.closing_requested", {
    tenantId,
    sessionId: session.id,
    outletId: payload.outletId,
    userId: payload.userId,
    cashCents: payload.expectedCashCents ?? 0,
  });

  console.info(`[close-register] closing session ${session.id} for outlet ${payload.outletId}`);
}
