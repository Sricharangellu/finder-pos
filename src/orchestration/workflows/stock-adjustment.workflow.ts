import type { WorkflowDefinition, WorkflowContext } from "../types.js";
import { EventTypes } from "../events/event-types.js";
import type { StockAdjustmentRequestedPayload } from "../events/domain-events.js";

/**
 * Stock Adjustment Workflow
 *
 * Trigger: stock.adjustment_requested
 * Modules: inventory, accounting
 *
 * Steps:
 * 1. validate_reason   — must be in allowed reason codes
 * 2. check_permissions — only manager-level users may perform write-offs
 * 3. apply_adjustment  — update inventory_items.quantity with delta
 * 4. write_audit_log   — insert into inventory_adjustments for traceability
 * 5. post_valuation    — if negative delta (shrinkage/write-off), post accounting entry
 * 6. emit_completed    — publish stock.adjustment_completed
 *
 * Compensations:
 * - apply_adjustment: reverse the quantity delta
 * - post_valuation: reverse the accounting entry
 */

const ALLOWED_REASONS = [
  "cycle_count",
  "damage",
  "theft",
  "write_off",
  "receiving_correction",
  "return_to_vendor",
  "manual_correction",
] as const;
type AdjustmentReason = typeof ALLOWED_REASONS[number];

const INVENTORY_ASSET_ACCOUNT = "1300";
const SHRINKAGE_EXPENSE_ACCOUNT = "5200"; // COGS / shrinkage

export interface StockAdjustmentContext extends WorkflowContext {
  productId: string;
  delta: number;
  reason: AdjustmentReason;
  referenceId: string;
  userId: string;
  adjustmentId: string | null;
  adjustmentApplied: boolean;
  valuationPosted: boolean;
  unitCostCents: number;
}

export const StockAdjustmentWorkflow: WorkflowDefinition<StockAdjustmentContext> = {
  type: "stock_adjustment",
  triggers: [EventTypes.STOCK_ADJUSTMENT_REQUESTED],

  buildContext(payload: Record<string, unknown>, tenantId: string): StockAdjustmentContext {
    const p = payload as unknown as StockAdjustmentRequestedPayload;
    return {
      workflowId: "",
      tenantId,
      correlationId: `adj_${p.productId}_${p.referenceId ?? Date.now()}`,
      productId: p.productId,
      delta: p.delta,
      reason: (p.reason as AdjustmentReason) ?? "manual_correction",
      referenceId: p.referenceId ?? "",
      userId: p.userId ?? "",
      adjustmentId: null,
      adjustmentApplied: false,
      valuationPosted: false,
      unitCostCents: 0,
    };
  },

  steps: [
    {
      name: "validate_reason",
      async execute(ctx) {
        if (!ALLOWED_REASONS.includes(ctx.reason)) {
          throw new Error(`invalid adjustment reason '${ctx.reason}'`);
        }
        if (ctx.delta === 0) throw new Error("adjustment delta cannot be zero");
        return ctx;
      },
    },
    {
      name: "check_permissions",
      async execute(ctx, db) {
        // Write-offs and damage require manager role.
        if (["write_off", "damage", "theft"].includes(ctx.reason) && ctx.userId) {
          const user = await db.one<{ role: string }>(
            "SELECT role FROM team_members WHERE id = @userId AND tenant_id = @tenantId",
            { userId: ctx.userId, tenantId: ctx.tenantId },
          );
          if (user && !["manager", "owner", "admin"].includes(user.role)) {
            throw new Error(`user role '${user.role}' not authorized for reason '${ctx.reason}'`);
          }
        }
        return ctx;
      },
    },
    {
      name: "apply_adjustment",
      async execute(ctx, db) {
        const now = Date.now();
        // Fetch unit cost for valuation.
        const product = await db.one<{ cost_cents: number }>(
          "SELECT cost_cents FROM products WHERE id = @id AND tenant_id = @tenantId",
          { id: ctx.productId, tenantId: ctx.tenantId },
        );
        const unitCostCents = product?.cost_cents ?? 0;

        await db.query(
          `UPDATE inventory_items
             SET quantity = quantity + @delta, updated_at = @now
           WHERE product_id = @productId AND tenant_id = @tenantId`,
          { delta: ctx.delta, productId: ctx.productId, tenantId: ctx.tenantId, now },
        );
        return { ...ctx, adjustmentApplied: true, unitCostCents };
      },
      async compensate(ctx, db) {
        if (!ctx.adjustmentApplied) return;
        await db.query(
          `UPDATE inventory_items
             SET quantity = quantity - @delta, updated_at = @now
           WHERE product_id = @productId AND tenant_id = @tenantId`,
          { delta: ctx.delta, productId: ctx.productId, tenantId: ctx.tenantId, now: Date.now() },
        );
      },
    },
    {
      name: "write_audit_log",
      async execute(ctx, db) {
        const { v7: uuidv7 } = await import("uuid");
        const id = `adj_${uuidv7()}`;
        await db.query(
          `INSERT INTO inventory_adjustments
             (id, tenant_id, product_id, delta, reason, reference_id, user_id, created_at)
           VALUES
             (@id, @tenantId, @productId, @delta, @reason, @referenceId, @userId, @now)`,
          {
            id,
            tenantId: ctx.tenantId,
            productId: ctx.productId,
            delta: ctx.delta,
            reason: ctx.reason,
            referenceId: ctx.referenceId || null,
            userId: ctx.userId || null,
            now: Date.now(),
          },
        );
        return { ...ctx, adjustmentId: id };
      },
    },
    {
      name: "post_valuation",
      async execute(ctx, _db, events) {
        // Only post accounting for shrinkage (negative delta).
        if (ctx.delta >= 0 || ctx.unitCostCents <= 0) return ctx;
        const lostCostCents = Math.abs(ctx.delta) * ctx.unitCostCents;
        await events.publish(EventTypes.ACCOUNTING_ENTRY_REQUESTED, {
          tenantId: ctx.tenantId,
          referenceId: ctx.adjustmentId ?? ctx.referenceId,
          referenceType: "stock_adjustment",
          lines: [
            { accountCode: SHRINKAGE_EXPENSE_ACCOUNT, debitCents: lostCostCents, creditCents: 0, description: `Stock shrinkage: ${ctx.reason} product=${ctx.productId}` },
            { accountCode: INVENTORY_ASSET_ACCOUNT, debitCents: 0, creditCents: lostCostCents, description: `Inventory reduction: ${ctx.reason}` },
          ],
        });
        return { ...ctx, valuationPosted: true };
      },
      async compensate(ctx, _db, events) {
        if (!ctx.valuationPosted || ctx.delta >= 0) return;
        const lostCostCents = Math.abs(ctx.delta) * ctx.unitCostCents;
        // Reverse the shrinkage entry.
        await events.publish(EventTypes.ACCOUNTING_ENTRY_REQUESTED, {
          tenantId: ctx.tenantId,
          referenceId: `${ctx.adjustmentId}_reversal`,
          referenceType: "stock_adjustment_reversal",
          lines: [
            { accountCode: INVENTORY_ASSET_ACCOUNT, debitCents: lostCostCents, creditCents: 0, description: `Reversal stock shrinkage` },
            { accountCode: SHRINKAGE_EXPENSE_ACCOUNT, debitCents: 0, creditCents: lostCostCents, description: `Reversal shrinkage expense` },
          ],
        });
      },
    },
    {
      name: "emit_completed",
      async execute(ctx, _db, events) {
        await events.publish(EventTypes.STOCK_ADJUSTMENT_COMPLETED, {
          tenantId: ctx.tenantId,
          productId: ctx.productId,
          delta: ctx.delta,
          reason: ctx.reason,
          adjustmentId: ctx.adjustmentId,
        });
        return ctx;
      },
    },
  ],
};
