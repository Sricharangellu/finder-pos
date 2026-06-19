import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { WorkflowDefinition, WorkflowContext } from "../types.js";
import { EventTypes } from "../events/event-types.js";
import type { PaymentCapturedPayload } from "../events/domain-events.js";

/**
 * Order Fulfillment Workflow
 *
 * Trigger: payment.captured (only for orders with fulfillable lines)
 * Modules: orders, fulfillment (pick list), shipping
 *
 * Steps:
 * 1. check_fulfillable   — skip if POS cash-and-carry (no physical fulfillment needed)
 * 2. create_pick_list    — insert a pick list via the fulfillment module table
 * 3. allocate_inventory  — mark inventory as committed/allocated for this order
 * 4. create_shipment     — create a shipping order record
 * 5. notify_customer     — enqueue notification event
 *
 * Compensations:
 * - create_pick_list: delete the pick list
 * - create_shipment: cancel the shipment
 */

export interface FulfillmentContext extends WorkflowContext {
  orderId: string;
  amountCents: number;
  pickListId: string | null;
  shipmentId: string | null;
  requiresFulfillment: boolean;
}

export const OrderFulfillmentWorkflow: WorkflowDefinition<FulfillmentContext> = {
  type: "order_fulfillment",
  triggers: [EventTypes.PAYMENT_CAPTURED],

  buildContext(payload: Record<string, unknown>, tenantId: string): FulfillmentContext {
    const p = payload as unknown as PaymentCapturedPayload;
    return {
      workflowId: "",
      tenantId,
      correlationId: `fulfillment_${p.orderId}`,
      orderId: p.orderId,
      amountCents: p.amountCents,
      pickListId: null,
      shipmentId: null,
      requiresFulfillment: false,
    };
  },

  steps: [
    {
      name: "check_fulfillable",
      async execute(ctx, db) {
        // Check if a pick list already exists for this order (idempotency).
        const existing = await db.one<{ id: string }>(
          "SELECT id FROM pick_lists WHERE order_id = @orderId AND tenant_id = @tenantId LIMIT 1",
          { orderId: ctx.orderId, tenantId: ctx.tenantId },
        );
        if (existing) return { ...ctx, requiresFulfillment: false, pickListId: existing.id };

        // Check order has lines requiring physical fulfillment (not service/digital).
        const lines = await db.query<{ product_id: string; quantity: number }>(
          `SELECT ol.product_id, ol.quantity
             FROM order_lines ol
             JOIN products p ON p.id = ol.product_id AND p.tenant_id = ol.tenant_id
            WHERE ol.order_id = @orderId AND ol.tenant_id = @tenantId
              AND p.service_product = 0`,
          { orderId: ctx.orderId, tenantId: ctx.tenantId },
        );
        return { ...ctx, requiresFulfillment: lines.length > 0 };
      },
    },
    {
      name: "create_pick_list",
      async execute(ctx, db, events) {
        if (!ctx.requiresFulfillment) return ctx;
        await events.publish("fulfillment.pick_list_requested", {
          tenantId: ctx.tenantId,
          orderId: ctx.orderId,
        });
        // Read back the created pick list.
        const pl = await db.one<{ id: string }>(
          "SELECT id FROM pick_lists WHERE order_id = @orderId AND tenant_id = @tenantId ORDER BY created_at DESC LIMIT 1",
          { orderId: ctx.orderId, tenantId: ctx.tenantId },
        );
        return { ...ctx, pickListId: pl?.id ?? null };
      },
      async compensate(ctx, db) {
        if (!ctx.pickListId) return;
        await db.query(
          "DELETE FROM pick_list_lines WHERE pick_list_id = @id AND tenant_id = @tenantId",
          { id: ctx.pickListId, tenantId: ctx.tenantId },
        );
        await db.query(
          "DELETE FROM pick_lists WHERE id = @id AND tenant_id = @tenantId",
          { id: ctx.pickListId, tenantId: ctx.tenantId },
        );
      },
    },
    {
      name: "allocate_inventory",
      async execute(ctx, _db, events) {
        if (!ctx.requiresFulfillment) return ctx;
        await events.publish(EventTypes.INVENTORY_ADJUSTED, {
          tenantId: ctx.tenantId,
          orderId: ctx.orderId,
          reason: "fulfillment_allocation",
        });
        return ctx;
      },
    },
    {
      name: "create_shipment",
      async execute(ctx, db, events) {
        if (!ctx.requiresFulfillment || !ctx.pickListId) return ctx;
        await events.publish(EventTypes.SHIPMENT_CREATED, {
          tenantId: ctx.tenantId,
          orderId: ctx.orderId,
          shipmentId: `ship_${ctx.orderId}`,
        });
        return { ...ctx, shipmentId: `ship_${ctx.orderId}` };
      },
      async compensate(ctx, _db, events) {
        if (!ctx.shipmentId) return;
        await events.publish("shipment.cancelled", {
          tenantId: ctx.tenantId,
          shipmentId: ctx.shipmentId,
          reason: "workflow_compensation",
        });
      },
    },
    {
      name: "notify_customer",
      async execute(ctx, _db, events) {
        if (!ctx.requiresFulfillment) return ctx;
        await events.publish("customer.notification_requested", {
          tenantId: ctx.tenantId,
          orderId: ctx.orderId,
          template: "order_confirmed",
        });
        return ctx;
      },
    },
    {
      name: "emit_fulfillment_started",
      async execute(ctx, _db, events) {
        if (!ctx.requiresFulfillment) return ctx;
        await events.publish(EventTypes.ORDER_FULFILLMENT_STARTED, {
          tenantId: ctx.tenantId,
          orderId: ctx.orderId,
          pickListId: ctx.pickListId,
          shipmentId: ctx.shipmentId,
        });
        return ctx;
      },
    },
  ],
};
