import type { WorkflowDefinition, WorkflowContext } from "../types.js";
import { EventTypes } from "../events/event-types.js";
import type { InventoryTransferRequestedPayload } from "../events/domain-events.js";

/**
 * Inventory Transfer Workflow
 *
 * Trigger: inventory.transfer_requested
 * Modules: inventory, outlets
 *
 * Steps:
 * 1. validate_transfer    — confirm source has enough stock, both outlets exist
 * 2. reserve_source       — mark qty as in-transit at source (decrement available)
 * 3. create_transfer_order — insert a transfer_orders record
 * 4. confirm_movement     — move stock to destination, clear in-transit
 * 5. emit_completed       — publish inventory.transfer_completed
 *
 * Compensations:
 * - reserve_source: restore available qty at source
 * - create_transfer_order: cancel the transfer order
 * - confirm_movement: reverse destination receipt and restore source
 */

export interface InventoryTransferContext extends WorkflowContext {
  transferId: string;
  fromOutletId: string;
  toOutletId: string;
  productId: string;
  quantity: number;
  notes: string;
  transferOrderId: string | null;
  sourceReserved: boolean;
  movementConfirmed: boolean;
}

export const InventoryTransferWorkflow: WorkflowDefinition<InventoryTransferContext> = {
  type: "inventory_transfer",
  triggers: [EventTypes.INVENTORY_TRANSFER_REQUESTED],

  buildContext(payload: Record<string, unknown>, tenantId: string): InventoryTransferContext {
    const p = payload as unknown as InventoryTransferRequestedPayload;
    return {
      workflowId: "",
      tenantId,
      correlationId: p.transferId,
      transferId: p.transferId,
      fromOutletId: p.fromOutletId,
      toOutletId: p.toOutletId,
      productId: p.productId,
      quantity: p.quantity,
      notes: p.notes ?? "",
      transferOrderId: null,
      sourceReserved: false,
      movementConfirmed: false,
    };
  },

  steps: [
    {
      name: "validate_transfer",
      async execute(ctx, db) {
        // Verify source outlet exists.
        const srcOutlet = await db.one<{ id: string }>(
          "SELECT id FROM outlets WHERE id = @id AND tenant_id = @tenantId",
          { id: ctx.fromOutletId, tenantId: ctx.tenantId },
        );
        if (!srcOutlet) throw new Error(`source outlet '${ctx.fromOutletId}' not found`);

        // Verify destination outlet exists.
        const dstOutlet = await db.one<{ id: string }>(
          "SELECT id FROM outlets WHERE id = @id AND tenant_id = @tenantId",
          { id: ctx.toOutletId, tenantId: ctx.tenantId },
        );
        if (!dstOutlet) throw new Error(`destination outlet '${ctx.toOutletId}' not found`);

        // Check available stock at source.
        const stock = await db.one<{ quantity: number }>(
          `SELECT quantity FROM inventory_items
            WHERE product_id = @productId AND outlet_id = @outletId AND tenant_id = @tenantId`,
          { productId: ctx.productId, outletId: ctx.fromOutletId, tenantId: ctx.tenantId },
        );
        const available = stock?.quantity ?? 0;
        if (available < ctx.quantity) {
          throw new Error(
            `insufficient stock at source: available=${available} requested=${ctx.quantity}`,
          );
        }
        return ctx;
      },
    },
    {
      name: "reserve_source",
      async execute(ctx, db) {
        // Atomically decrement source available quantity.
        await db.query(
          `UPDATE inventory_items
             SET quantity = quantity - @qty, updated_at = @now
           WHERE product_id = @productId AND outlet_id = @outletId AND tenant_id = @tenantId
             AND quantity >= @qty`,
          {
            qty: ctx.quantity,
            productId: ctx.productId,
            outletId: ctx.fromOutletId,
            tenantId: ctx.tenantId,
            now: Date.now(),
          },
        );
        return { ...ctx, sourceReserved: true };
      },
      async compensate(ctx, db) {
        if (!ctx.sourceReserved) return;
        await db.query(
          `UPDATE inventory_items
             SET quantity = quantity + @qty, updated_at = @now
           WHERE product_id = @productId AND outlet_id = @outletId AND tenant_id = @tenantId`,
          {
            qty: ctx.quantity,
            productId: ctx.productId,
            outletId: ctx.fromOutletId,
            tenantId: ctx.tenantId,
            now: Date.now(),
          },
        );
      },
    },
    {
      name: "create_transfer_order",
      async execute(ctx, db) {
        const { v7: uuidv7 } = await import("uuid");
        const id = `to_${uuidv7()}`;
        const now = Date.now();
        await db.query(
          `INSERT INTO transfer_orders
             (id, tenant_id, from_outlet_id, to_outlet_id, product_id, quantity, status, notes, created_at)
           VALUES
             (@id, @tenantId, @fromOutletId, @toOutletId, @productId, @quantity, 'in_transit', @notes, @now)
           ON CONFLICT (id) DO NOTHING`,
          {
            id,
            tenantId: ctx.tenantId,
            fromOutletId: ctx.fromOutletId,
            toOutletId: ctx.toOutletId,
            productId: ctx.productId,
            quantity: ctx.quantity,
            notes: ctx.notes,
            now,
          },
        );
        return { ...ctx, transferOrderId: id };
      },
      async compensate(ctx, db) {
        if (!ctx.transferOrderId) return;
        await db.query(
          "UPDATE transfer_orders SET status = 'cancelled', updated_at = @now WHERE id = @id AND tenant_id = @tenantId",
          { id: ctx.transferOrderId, tenantId: ctx.tenantId, now: Date.now() },
        );
      },
    },
    {
      name: "confirm_movement",
      async execute(ctx, db) {
        const now = Date.now();
        // Add quantity to destination.
        await db.query(
          `INSERT INTO inventory_items (id, tenant_id, product_id, outlet_id, quantity, updated_at)
           VALUES (@id, @tenantId, @productId, @outletId, @qty, @now)
           ON CONFLICT (tenant_id, product_id, outlet_id)
           DO UPDATE SET quantity = inventory_items.quantity + EXCLUDED.quantity, updated_at = EXCLUDED.updated_at`,
          {
            id: `inv_${ctx.productId}_${ctx.toOutletId}`,
            tenantId: ctx.tenantId,
            productId: ctx.productId,
            outletId: ctx.toOutletId,
            qty: ctx.quantity,
            now,
          },
        );
        // Mark transfer order complete.
        await db.query(
          "UPDATE transfer_orders SET status = 'completed', updated_at = @now WHERE id = @id AND tenant_id = @tenantId",
          { id: ctx.transferOrderId, tenantId: ctx.tenantId, now },
        );
        return { ...ctx, movementConfirmed: true };
      },
      async compensate(ctx, db) {
        if (!ctx.movementConfirmed) return;
        const now = Date.now();
        // Remove from destination.
        await db.query(
          `UPDATE inventory_items
             SET quantity = GREATEST(0, quantity - @qty), updated_at = @now
           WHERE product_id = @productId AND outlet_id = @outletId AND tenant_id = @tenantId`,
          {
            qty: ctx.quantity,
            productId: ctx.productId,
            outletId: ctx.toOutletId,
            tenantId: ctx.tenantId,
            now,
          },
        );
        // Restore source.
        await db.query(
          `UPDATE inventory_items
             SET quantity = quantity + @qty, updated_at = @now
           WHERE product_id = @productId AND outlet_id = @outletId AND tenant_id = @tenantId`,
          {
            qty: ctx.quantity,
            productId: ctx.productId,
            outletId: ctx.fromOutletId,
            tenantId: ctx.tenantId,
            now,
          },
        );
      },
    },
    {
      name: "emit_completed",
      async execute(ctx, _db, events) {
        await events.publish(EventTypes.INVENTORY_TRANSFER_COMPLETED, {
          tenantId: ctx.tenantId,
          transferId: ctx.transferId,
          transferOrderId: ctx.transferOrderId,
          fromOutletId: ctx.fromOutletId,
          toOutletId: ctx.toOutletId,
          productId: ctx.productId,
          quantity: ctx.quantity,
        });
        return ctx;
      },
    },
  ],
};
