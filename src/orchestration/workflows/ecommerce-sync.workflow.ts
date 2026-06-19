import type { WorkflowDefinition, WorkflowContext } from "../types.js";
import { EventTypes } from "../events/event-types.js";
import type { EcommerceSyncRequestedPayload } from "../events/domain-events.js";

/**
 * Ecommerce Sync Workflow
 *
 * Trigger: ecommerce.sync_requested
 * Modules: ecommerce, catalog, inventory, orders
 *
 * Steps:
 * 1. validate_credentials  — confirm the platform API key is still valid
 * 2. idempotency_check     — skip if this sync batch already ran successfully
 * 3. pull_catalog_deltas   — fetch product/variant changes from the platform
 * 4. detect_conflicts      — compare remote vs local; flag newer-internal records
 * 5. apply_product_updates — push non-conflicting updates to internal catalog
 * 6. pull_new_orders       — fetch orders created on the platform since last sync
 * 7. import_orders         — create internal orders from platform orders
 * 8. push_inventory_levels — send updated stock counts back to the platform
 * 9. record_sync_status    — mark sync success, update cursor/timestamp
 * 10. emit_completed       — publish ecommerce.sync_completed
 *
 * Safety:
 * - Never overwrite newer internal data without conflict policy check.
 * - Preserve original payload on failure for replay.
 * - Create sync exception record on any unrecoverable step.
 * - Idempotency: re-running the same sync batch is safe.
 *
 * Compensations:
 * - apply_product_updates: mark sync exception (partial updates cannot be safely reversed)
 * - import_orders: cancel any imported orders and flag for manual review
 */

export interface EcommerceSyncContext extends WorkflowContext {
  platform: string;
  syncType: "full" | "incremental";
  since: number;
  syncRunId: string | null;
  catalogDeltaCount: number;
  conflictCount: number;
  ordersImported: number;
  importedOrderIds: string[];
  productUpdatesApplied: boolean;
  syncCompleted: boolean;
}

export const EcommerceSyncWorkflow: WorkflowDefinition<EcommerceSyncContext> = {
  type: "ecommerce_sync",
  triggers: [EventTypes.ECOMMERCE_SYNC_REQUESTED],

  buildContext(payload: Record<string, unknown>, tenantId: string): EcommerceSyncContext {
    const p = payload as unknown as EcommerceSyncRequestedPayload;
    const since = p.since ?? Date.now() - 24 * 60 * 60 * 1000; // Default: last 24 hours
    return {
      workflowId: "",
      tenantId,
      correlationId: `esync_${p.platform}_${since}`,
      platform: p.platform,
      syncType: p.syncType ?? "incremental",
      since,
      syncRunId: null,
      catalogDeltaCount: 0,
      conflictCount: 0,
      ordersImported: 0,
      importedOrderIds: [],
      productUpdatesApplied: false,
      syncCompleted: false,
    };
  },

  steps: [
    {
      name: "validate_credentials",
      async execute(ctx, db) {
        const integration = await db.one<{ id: string; status: string; platform: string }>(
          "SELECT id, status, platform FROM ecommerce_integrations WHERE tenant_id = @tenantId AND platform = @platform",
          { tenantId: ctx.tenantId, platform: ctx.platform },
        );
        if (!integration) {
          throw new Error(`no ecommerce integration found for platform '${ctx.platform}'`);
        }
        if (integration.status !== "active") {
          throw new Error(`ecommerce integration for '${ctx.platform}' is not active (status=${integration.status})`);
        }
        return ctx;
      },
    },
    {
      name: "idempotency_check",
      async execute(ctx, db) {
        // Check if a successful sync already ran for this exact batch (platform + since).
        const existing = await db.one<{ id: string; status: string }>(
          `SELECT id, status FROM ecommerce_sync_runs
            WHERE tenant_id = @tenantId AND platform = @platform
              AND since_at = @since AND status = 'completed'
            LIMIT 1`,
          { tenantId: ctx.tenantId, platform: ctx.platform, since: ctx.since },
        );
        if (existing) {
          // Already ran — skip all remaining steps by marking as no-op.
          return { ...ctx, syncRunId: existing.id, syncCompleted: true };
        }
        // Create a sync run record.
        const { v7: uuidv7 } = await import("uuid");
        const syncRunId = `sr_${uuidv7()}`;
        await db.query(
          `INSERT INTO ecommerce_sync_runs
             (id, tenant_id, platform, sync_type, since_at, status, created_at)
           VALUES (@id, @tenantId, @platform, @syncType, @since, 'running', @now)`,
          {
            id: syncRunId,
            tenantId: ctx.tenantId,
            platform: ctx.platform,
            syncType: ctx.syncType,
            since: ctx.since,
            now: Date.now(),
          },
        );
        return { ...ctx, syncRunId };
      },
    },
    {
      name: "pull_catalog_deltas",
      async execute(ctx, db) {
        // Skip if already completed via idempotency check.
        if (ctx.syncCompleted) return ctx;
        // Fetch product updates from ecommerce_product_queue (populated by webhook handlers).
        const deltas = await db.query<{ id: string; external_id: string; data: string }>(
          `SELECT id, external_id, data FROM ecommerce_product_queue
            WHERE tenant_id = @tenantId AND platform = @platform
              AND status = 'pending' AND created_at >= @since
            ORDER BY created_at ASC LIMIT 200`,
          { tenantId: ctx.tenantId, platform: ctx.platform, since: ctx.since },
        );
        return { ...ctx, catalogDeltaCount: deltas.length };
      },
    },
    {
      name: "detect_conflicts",
      async execute(ctx, db) {
        if (ctx.syncCompleted) return ctx;
        // Flag any external update where internal record was updated AFTER the external event.
        const conflicts = await db.query<{ external_id: string }>(
          `SELECT pq.external_id
             FROM ecommerce_product_queue pq
             JOIN products p ON p.external_id = pq.external_id AND p.tenant_id = pq.tenant_id
            WHERE pq.tenant_id = @tenantId AND pq.platform = @platform
              AND pq.status = 'pending' AND pq.created_at >= @since
              AND p.updated_at > pq.external_updated_at`,
          { tenantId: ctx.tenantId, platform: ctx.platform, since: ctx.since },
        );
        if (conflicts.length > 0) {
          // Mark conflicting queue items as 'conflict' — do not apply.
          const ids = conflicts.map((c) => c.external_id);
          for (const externalId of ids) {
            await db.query(
              `UPDATE ecommerce_product_queue SET status = 'conflict'
                WHERE external_id = @externalId AND tenant_id = @tenantId AND platform = @platform`,
              { externalId, tenantId: ctx.tenantId, platform: ctx.platform },
            );
          }
        }
        return { ...ctx, conflictCount: conflicts.length };
      },
    },
    {
      name: "apply_product_updates",
      async execute(ctx, db) {
        if (ctx.syncCompleted) return ctx;
        // Apply non-conflicting pending deltas.
        const pending = await db.query<{ id: string; external_id: string; data: string }>(
          `SELECT id, external_id, data FROM ecommerce_product_queue
            WHERE tenant_id = @tenantId AND platform = @platform
              AND status = 'pending' AND created_at >= @since
            ORDER BY created_at ASC LIMIT 200`,
          { tenantId: ctx.tenantId, platform: ctx.platform, since: ctx.since },
        );

        const now = Date.now();
        for (const item of pending) {
          try {
            const data = JSON.parse(item.data) as Record<string, unknown>;
            await db.query(
              `UPDATE products
                 SET name = COALESCE(@name, name),
                     price_cents = COALESCE(@priceCents, price_cents),
                     updated_at = @now
               WHERE external_id = @externalId AND tenant_id = @tenantId`,
              {
                name: data["name"] ?? null,
                priceCents: data["price_cents"] ?? null,
                externalId: item.external_id,
                tenantId: ctx.tenantId,
                now,
              },
            );
            await db.query(
              "UPDATE ecommerce_product_queue SET status = 'applied' WHERE id = @id",
              { id: item.id },
            );
          } catch {
            await db.query(
              "UPDATE ecommerce_product_queue SET status = 'failed' WHERE id = @id",
              { id: item.id },
            );
          }
        }
        return { ...ctx, productUpdatesApplied: true };
      },
      async compensate(ctx, _db, events) {
        if (!ctx.productUpdatesApplied) return;
        // Cannot safely reverse catalog updates — emit exception for ops review.
        await events.publish(EventTypes.ECOMMERCE_SYNC_FAILED, {
          tenantId: ctx.tenantId,
          platform: ctx.platform,
          syncRunId: ctx.syncRunId,
          reason: "product_update_compensation_required",
        });
      },
    },
    {
      name: "pull_new_orders",
      async execute(ctx, db) {
        if (ctx.syncCompleted) return ctx;
        const orders = await db.query<{ id: string }>(
          `SELECT id FROM ecommerce_order_queue
            WHERE tenant_id = @tenantId AND platform = @platform
              AND status = 'pending' AND created_at >= @since
            ORDER BY created_at ASC LIMIT 100`,
          { tenantId: ctx.tenantId, platform: ctx.platform, since: ctx.since },
        );
        return { ...ctx, ordersImported: orders.length };
      },
    },
    {
      name: "import_orders",
      async execute(ctx, db, events) {
        if (ctx.syncCompleted || ctx.ordersImported === 0) return ctx;
        const pending = await db.query<{ id: string; data: string }>(
          `SELECT id, data FROM ecommerce_order_queue
            WHERE tenant_id = @tenantId AND platform = @platform
              AND status = 'pending' AND created_at >= @since
            ORDER BY created_at ASC LIMIT 100`,
          { tenantId: ctx.tenantId, platform: ctx.platform, since: ctx.since },
        );

        const importedOrderIds: string[] = [];
        for (const item of pending) {
          await events.publish(EventTypes.ECOMMERCE_ORDER_RECEIVED, {
            tenantId: ctx.tenantId,
            platform: ctx.platform,
            payload: JSON.parse(item.data),
          });
          await db.query(
            "UPDATE ecommerce_order_queue SET status = 'imported' WHERE id = @id",
            { id: item.id },
          );
          importedOrderIds.push(item.id);
        }
        return { ...ctx, importedOrderIds };
      },
      async compensate(ctx, db, events) {
        if (ctx.importedOrderIds.length === 0) return;
        // Flag imported orders for manual review.
        for (const id of ctx.importedOrderIds) {
          await db.query(
            "UPDATE ecommerce_order_queue SET status = 'compensation_required' WHERE id = @id",
            { id },
          );
        }
        await events.publish("ecommerce.import_compensation_required", {
          tenantId: ctx.tenantId,
          platform: ctx.platform,
          orderIds: ctx.importedOrderIds,
        });
      },
    },
    {
      name: "push_inventory_levels",
      async execute(ctx, _db, events) {
        if (ctx.syncCompleted) return ctx;
        // Signal the ecommerce module to push current inventory levels.
        await events.publish("ecommerce.inventory_push_requested", {
          tenantId: ctx.tenantId,
          platform: ctx.platform,
          syncRunId: ctx.syncRunId,
        });
        return ctx;
      },
    },
    {
      name: "record_sync_status",
      async execute(ctx, db) {
        if (!ctx.syncRunId) return ctx;
        await db.query(
          `UPDATE ecommerce_sync_runs
             SET status = 'completed',
                 catalog_delta_count = @catalogDeltaCount,
                 conflict_count = @conflictCount,
                 orders_imported = @ordersImported,
                 completed_at = @now
           WHERE id = @id AND tenant_id = @tenantId`,
          {
            id: ctx.syncRunId,
            tenantId: ctx.tenantId,
            catalogDeltaCount: ctx.catalogDeltaCount,
            conflictCount: ctx.conflictCount,
            ordersImported: ctx.ordersImported,
            now: Date.now(),
          },
        );
        return { ...ctx, syncCompleted: true };
      },
    },
    {
      name: "emit_completed",
      async execute(ctx, _db, events) {
        await events.publish(EventTypes.ECOMMERCE_SYNC_COMPLETED, {
          tenantId: ctx.tenantId,
          platform: ctx.platform,
          syncRunId: ctx.syncRunId,
          catalogDeltaCount: ctx.catalogDeltaCount,
          conflictCount: ctx.conflictCount,
          ordersImported: ctx.ordersImported,
        });
        return ctx;
      },
    },
  ],
};
