import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { JobRow } from "../types.js";
import { EventTypes } from "../events/event-types.js";

/**
 * Sync Ecommerce Job
 *
 * Periodic job that triggers an incremental sync with all active
 * ecommerce integrations for a given tenant.
 */
export async function syncEcommerceJob(job: JobRow, db: DB, events: EventBus): Promise<void> {
  const payload = JSON.parse(job.payload) as { tenantId?: string; platform?: string; since?: number };
  const tenantId = payload.tenantId ?? job.tenant_id;

  // Find all active integrations for this tenant.
  const integrations = await db.query<{ platform: string }>(
    "SELECT platform FROM ecommerce_integrations WHERE tenant_id = @tenantId AND status = 'active'",
    { tenantId },
  );

  const since = payload.since ?? (Date.now() - 60 * 60 * 1000); // last hour

  for (const integration of integrations) {
    if (payload.platform && integration.platform !== payload.platform) continue;
    await events.publish(EventTypes.ECOMMERCE_SYNC_REQUESTED, {
      tenantId,
      platform: integration.platform,
      syncType: "incremental",
      since,
    });
    console.info(`[sync-ecommerce] triggered sync for ${integration.platform} tenant=${tenantId}`);
  }
}
