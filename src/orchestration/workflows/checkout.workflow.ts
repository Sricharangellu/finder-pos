import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { WorkflowDefinition, WorkflowContext } from "../types.js";
import { EventTypes } from "../events/event-types.js";
import type { OrderCreatedPayload } from "../events/domain-events.js";
import type { Cents } from "../../shared/money.js";

/**
 * Checkout Workflow
 *
 * Trigger: order.created
 * Modules touched: orders, inventory (FEFO depletion already done), accounting, customers (loyalty)
 *
 * Steps:
 * 1. validate_order      — confirm order exists and is in 'open' status
 * 2. post_accounting     — debit Cash/AR, credit Revenue + Tax Payable
 * 3. earn_loyalty        — award points for the completed purchase (1 pt per $1)
 * 4. emit_confirmation   — publish checkout.completed for downstream (receipts, analytics)
 *
 * The inventory deduction and payment happen in their own modules (inventory listens on
 * order.created; payments are a separate capture call). This workflow adds the cross-cutting
 * concerns: accounting entry + loyalty — without duplicating module logic.
 *
 * Compensations:
 * - post_accounting: reverse the journal entry
 * - earn_loyalty: reverse the points award
 */

export interface CheckoutContext extends WorkflowContext {
  orderId: string;
  orderNumber: string;
  customerId: string | null;
  totalCents: Cents;
  taxCents: Cents;
  stateCode: string;
  journalEntryId: string | null;
  pointsAwarded: number;
}

const CHECKOUT_REVENUE_ACCOUNT = "4000"; // Sales Revenue
const CHECKOUT_TAX_ACCOUNT = "2200";     // Sales Tax Payable
const CHECKOUT_CASH_ACCOUNT = "1010";    // Cash & Cash Equivalents (or AR if unpaid)

export const CheckoutWorkflow: WorkflowDefinition<CheckoutContext> = {
  type: "checkout",
  triggers: [EventTypes.ORDER_CREATED],

  buildContext(payload: Record<string, unknown>, tenantId: string): CheckoutContext {
    const p = payload as unknown as OrderCreatedPayload;
    const taxCents = 0; // extracted from order on step 1
    return {
      workflowId: "",
      tenantId,
      correlationId: p.id,
      orderId: p.id,
      orderNumber: p.orderNumber ?? "",
      customerId: p.customerId ?? null,
      totalCents: p.totalCents ?? 0,
      taxCents,
      stateCode: p.stateCode ?? "TX",
      journalEntryId: null,
      pointsAwarded: 0,
    };
  },

  steps: [
    {
      name: "validate_order",
      async execute(ctx, db) {
        const order = await db.one<{
          id: string; status: string; total_cents: number; tax_cents: number;
        }>(
          "SELECT id, status, total_cents, tax_cents FROM orders WHERE id = @id AND tenant_id = @tenantId",
          { id: ctx.orderId, tenantId: ctx.tenantId },
        );
        if (!order) throw new Error(`order '${ctx.orderId}' not found`);
        return { ...ctx, totalCents: order.total_cents, taxCents: order.tax_cents };
      },
    },
    {
      name: "post_accounting",
      async execute(ctx, db, events) {
        // Debit Cash (full total), credit Revenue (subtotal), credit Tax Payable (tax).
        const subtotalCents = ctx.totalCents - ctx.taxCents;
        await events.publish(EventTypes.ACCOUNTING_ENTRY_REQUESTED, {
          tenantId: ctx.tenantId,
          referenceId: ctx.orderId,
          referenceType: "order",
          lines: [
            { accountCode: CHECKOUT_CASH_ACCOUNT, debitCents: ctx.totalCents, creditCents: 0, description: `Order ${ctx.orderNumber} payment` },
            { accountCode: CHECKOUT_REVENUE_ACCOUNT, debitCents: 0, creditCents: subtotalCents, description: `Order ${ctx.orderNumber} revenue` },
            { accountCode: CHECKOUT_TAX_ACCOUNT, debitCents: 0, creditCents: ctx.taxCents, description: `Order ${ctx.orderNumber} tax` },
          ],
        });
        return { ...ctx, journalEntryId: `je_${ctx.orderId}` };
      },
      async compensate(ctx, _db, events) {
        if (!ctx.journalEntryId) return;
        await events.publish(EventTypes.ACCOUNTING_ENTRY_REQUESTED, {
          tenantId: ctx.tenantId,
          referenceId: `${ctx.orderId}_reversal`,
          referenceType: "order_reversal",
          lines: [
            { accountCode: CHECKOUT_CASH_ACCOUNT, debitCents: 0, creditCents: ctx.totalCents, description: `Reversal: Order ${ctx.orderNumber}` },
            { accountCode: CHECKOUT_REVENUE_ACCOUNT, debitCents: ctx.totalCents - ctx.taxCents, creditCents: 0, description: `Reversal: Order ${ctx.orderNumber} revenue` },
            { accountCode: CHECKOUT_TAX_ACCOUNT, debitCents: ctx.taxCents, creditCents: 0, description: `Reversal: Order ${ctx.orderNumber} tax` },
          ],
        });
      },
    },
    {
      name: "earn_loyalty",
      async execute(ctx, db, events) {
        if (!ctx.customerId) return ctx;
        // 1 point per $1 spent (integer division of cents → points).
        const points = Math.floor(ctx.totalCents / 100);
        if (points <= 0) return ctx;
        await events.publish(EventTypes.LOYALTY_POINTS_EARNED, {
          tenantId: ctx.tenantId,
          customerId: ctx.customerId,
          orderId: ctx.orderId,
          points,
        });
        return { ...ctx, pointsAwarded: points };
      },
      async compensate(ctx, _db, events) {
        if (!ctx.customerId || ctx.pointsAwarded <= 0) return;
        // Reverse the loyalty earn — publish a negative-points event.
        await events.publish(EventTypes.LOYALTY_POINTS_EARNED, {
          tenantId: ctx.tenantId,
          customerId: ctx.customerId,
          orderId: ctx.orderId,
          points: -ctx.pointsAwarded,
          reason: "checkout_compensation",
        });
      },
    },
    {
      name: "emit_confirmation",
      async execute(ctx, _db, events) {
        await events.publish("checkout.completed", {
          tenantId: ctx.tenantId,
          orderId: ctx.orderId,
          orderNumber: ctx.orderNumber,
          totalCents: ctx.totalCents,
          customerId: ctx.customerId,
          pointsAwarded: ctx.pointsAwarded,
        });
        return ctx;
      },
    },
  ],
};
