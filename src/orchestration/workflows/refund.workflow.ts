import type { WorkflowDefinition, WorkflowContext } from "../types.js";
import { EventTypes } from "../events/event-types.js";
import type { OrderRefundedPayload } from "../events/domain-events.js";
import type { Cents } from "../../shared/money.js";

/**
 * Refund Workflow
 *
 * Trigger: order.refunded
 * Modules: orders, payments, inventory, accounting, customers
 *
 * Steps:
 * 1. validate_refund_eligibility — order must exist and be refundable; amount must not exceed original
 * 2. check_double_refund_guard   — idempotency: reject if refund already processed for this order
 * 3. process_payment_refund      — reverse the captured payment (debit payment provider)
 * 4. restore_inventory           — re-stock items only if payment refund succeeded
 * 5. post_accounting_reversal    — reverse revenue and tax posting
 * 6. reverse_loyalty_points      — deduct loyalty points awarded for this order
 * 7. notify_customer             — emit customer notification event
 * 8. emit_refund_report          — publish final refund reporting event
 *
 * Safety invariants:
 * - Do NOT restore inventory unless payment refund succeeded (or policy explicitly allows it).
 * - Do NOT double-refund: check existing refund record before processing.
 * - All financial mutations are auditable via accounting entries.
 *
 * Compensations:
 * - process_payment_refund: mark exception — cannot un-refund money, alert ops team
 * - restore_inventory: re-decrement inventory (undo the restock)
 * - post_accounting_reversal: reverse the reversal (net zero)
 */

const CASH_ACCOUNT = "1010";
const REVENUE_ACCOUNT = "4000";
const TAX_PAYABLE_ACCOUNT = "2200";

export interface RefundContext extends WorkflowContext {
  orderId: string;
  refundCents: Cents;
  originalTotalCents: Cents;
  customerId: string | null;
  lines: Array<{ productId: string; quantity: number }>;
  refundId: string | null;
  paymentRefundSucceeded: boolean;
  inventoryRestored: boolean;
  accountingReversed: boolean;
  loyaltyReversed: boolean;
  taxCents: Cents;
  subtotalCents: Cents;
  pointsToReverse: number;
}

export const RefundWorkflow: WorkflowDefinition<RefundContext> = {
  type: "refund",
  triggers: [EventTypes.ORDER_REFUNDED],

  buildContext(payload: Record<string, unknown>, tenantId: string): RefundContext {
    const p = payload as unknown as OrderRefundedPayload;
    return {
      workflowId: "",
      tenantId,
      correlationId: `refund_${p.id}`,
      orderId: p.id,
      refundCents: p.refundCents ?? 0,
      originalTotalCents: p.originalTotalCents ?? 0,
      customerId: p.customerId ?? null,
      lines: p.lines ?? [],
      refundId: null,
      paymentRefundSucceeded: false,
      inventoryRestored: false,
      accountingReversed: false,
      loyaltyReversed: false,
      taxCents: 0,
      subtotalCents: 0,
      pointsToReverse: 0,
    };
  },

  steps: [
    {
      name: "validate_refund_eligibility",
      async execute(ctx, db) {
        const order = await db.one<{
          id: string;
          status: string;
          total_cents: number;
          tax_cents: number;
          refunded_cents: number;
        }>(
          "SELECT id, status, total_cents, tax_cents, refunded_cents FROM orders WHERE id = @id AND tenant_id = @tenantId",
          { id: ctx.orderId, tenantId: ctx.tenantId },
        );
        if (!order) throw new Error(`order '${ctx.orderId}' not found`);
        if (["void", "cancelled"].includes(order.status)) {
          throw new Error(`order '${ctx.orderId}' in status '${order.status}' cannot be refunded`);
        }
        const alreadyRefunded = order.refunded_cents ?? 0;
        const maxRefundable = order.total_cents - alreadyRefunded;
        if (ctx.refundCents > maxRefundable) {
          throw new Error(
            `refund amount ${ctx.refundCents}¢ exceeds refundable balance ${maxRefundable}¢`,
          );
        }
        const taxCents = order.tax_cents ?? 0;
        const subtotalCents = ctx.refundCents - taxCents;
        return { ...ctx, taxCents, subtotalCents };
      },
    },
    {
      name: "check_double_refund_guard",
      async execute(ctx, db) {
        const existing = await db.one<{ id: string; status: string }>(
          `SELECT id, status FROM refunds
            WHERE order_id = @orderId AND tenant_id = @tenantId
              AND amount_cents = @refundCents AND status NOT IN ('failed', 'exception')
            LIMIT 1`,
          { orderId: ctx.orderId, tenantId: ctx.tenantId, refundCents: ctx.refundCents },
        );
        if (existing) {
          throw new Error(
            `duplicate refund detected for order '${ctx.orderId}' (existing=${existing.id} status=${existing.status})`,
          );
        }
        // Create refund record in pending state.
        const { v7: uuidv7 } = await import("uuid");
        const refundId = `ref_${uuidv7()}`;
        const now = Date.now();
        await db.query(
          `INSERT INTO refunds (id, tenant_id, order_id, amount_cents, status, created_at)
           VALUES (@id, @tenantId, @orderId, @amountCents, 'pending', @now)`,
          { id: refundId, tenantId: ctx.tenantId, orderId: ctx.orderId, amountCents: ctx.refundCents, now },
        );
        return { ...ctx, refundId };
      },
    },
    {
      name: "process_payment_refund",
      async execute(ctx, db, events) {
        // Emit payment refund event — the payments module handles the actual reversal.
        await events.publish(EventTypes.PAYMENT_REFUNDED, {
          tenantId: ctx.tenantId,
          orderId: ctx.orderId,
          refundId: ctx.refundId,
          amountCents: ctx.refundCents,
        });
        // Mark refund as processed.
        await db.query(
          "UPDATE refunds SET status = 'processed', updated_at = @now WHERE id = @id AND tenant_id = @tenantId",
          { id: ctx.refundId, tenantId: ctx.tenantId, now: Date.now() },
        );
        return { ...ctx, paymentRefundSucceeded: true };
      },
      async compensate(ctx, db, events) {
        // Cannot un-refund money. Mark exception and alert.
        if (!ctx.refundId) return;
        await db.query(
          "UPDATE refunds SET status = 'exception', updated_at = @now WHERE id = @id AND tenant_id = @tenantId",
          { id: ctx.refundId, tenantId: ctx.tenantId, now: Date.now() },
        );
        await events.publish("refund.exception", {
          tenantId: ctx.tenantId,
          refundId: ctx.refundId,
          orderId: ctx.orderId,
          reason: "payment_refund_compensation_required",
        });
      },
    },
    {
      name: "restore_inventory",
      async execute(ctx, _db, events) {
        // Only restore inventory if payment refund succeeded.
        if (!ctx.paymentRefundSucceeded) return ctx;
        for (const line of ctx.lines) {
          await events.publish(EventTypes.INVENTORY_ADJUSTED, {
            tenantId: ctx.tenantId,
            productId: line.productId,
            delta: line.quantity,
            reason: "refund_return",
            referenceId: ctx.orderId,
          });
        }
        return { ...ctx, inventoryRestored: true };
      },
      async compensate(ctx, _db, events) {
        if (!ctx.inventoryRestored) return;
        // Undo the restock — re-decrement.
        for (const line of ctx.lines) {
          await events.publish(EventTypes.INVENTORY_ADJUSTED, {
            tenantId: ctx.tenantId,
            productId: line.productId,
            delta: -line.quantity,
            reason: "refund_compensation",
            referenceId: ctx.orderId,
          });
        }
      },
    },
    {
      name: "post_accounting_reversal",
      async execute(ctx, _db, events) {
        if (!ctx.paymentRefundSucceeded) return ctx;
        await events.publish(EventTypes.ACCOUNTING_ENTRY_REQUESTED, {
          tenantId: ctx.tenantId,
          referenceId: `refund_${ctx.orderId}`,
          referenceType: "refund",
          lines: [
            { accountCode: REVENUE_ACCOUNT, debitCents: ctx.subtotalCents, creditCents: 0, description: `Refund revenue reversal order=${ctx.orderId}` },
            { accountCode: TAX_PAYABLE_ACCOUNT, debitCents: ctx.taxCents, creditCents: 0, description: `Refund tax reversal order=${ctx.orderId}` },
            { accountCode: CASH_ACCOUNT, debitCents: 0, creditCents: ctx.refundCents, description: `Refund payment order=${ctx.orderId}` },
          ],
        });
        return { ...ctx, accountingReversed: true };
      },
      async compensate(ctx, _db, events) {
        if (!ctx.accountingReversed) return;
        // Reverse the reversal — back to original state.
        await events.publish(EventTypes.ACCOUNTING_ENTRY_REQUESTED, {
          tenantId: ctx.tenantId,
          referenceId: `refund_${ctx.orderId}_compensation`,
          referenceType: "refund_compensation",
          lines: [
            { accountCode: CASH_ACCOUNT, debitCents: ctx.refundCents, creditCents: 0, description: `Compensation re-post` },
            { accountCode: REVENUE_ACCOUNT, debitCents: 0, creditCents: ctx.subtotalCents, description: `Compensation revenue restore` },
            { accountCode: TAX_PAYABLE_ACCOUNT, debitCents: 0, creditCents: ctx.taxCents, description: `Compensation tax restore` },
          ],
        });
      },
    },
    {
      name: "reverse_loyalty_points",
      async execute(ctx, db, events) {
        if (!ctx.customerId) return ctx;
        const pointsToReverse = Math.floor(ctx.refundCents / 100);
        if (pointsToReverse <= 0) return ctx;
        await events.publish(EventTypes.LOYALTY_POINTS_EARNED, {
          tenantId: ctx.tenantId,
          customerId: ctx.customerId,
          orderId: ctx.orderId,
          points: -pointsToReverse,
          reason: "refund_reversal",
        });
        return { ...ctx, loyaltyReversed: true, pointsToReverse };
      },
    },
    {
      name: "notify_customer",
      async execute(ctx, _db, events) {
        await events.publish("customer.notification_requested", {
          tenantId: ctx.tenantId,
          customerId: ctx.customerId,
          orderId: ctx.orderId,
          template: "refund_confirmed",
          data: { refundCents: ctx.refundCents, refundId: ctx.refundId },
        });
        return ctx;
      },
    },
    {
      name: "emit_refund_report",
      async execute(ctx, _db, events) {
        await events.publish("refund.completed", {
          tenantId: ctx.tenantId,
          orderId: ctx.orderId,
          refundId: ctx.refundId,
          refundCents: ctx.refundCents,
          customerId: ctx.customerId,
          inventoryRestored: ctx.inventoryRestored,
          accountingReversed: ctx.accountingReversed,
        });
        return ctx;
      },
    },
  ],
};
