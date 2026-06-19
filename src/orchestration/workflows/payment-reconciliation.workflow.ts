import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { WorkflowDefinition, WorkflowContext } from "../types.js";
import { EventTypes } from "../events/event-types.js";
import type { ReconciliationStartedPayload } from "../events/domain-events.js";
import type { Cents } from "../../shared/money.js";

/**
 * Payment Reconciliation Workflow
 *
 * Trigger: payment.reconciliation_started (fired by the daily reconciliation job)
 * Modules: payments, accounting, orders
 *
 * Steps:
 * 1. fetch_payment_batch     — load all captured payments in the period
 * 2. match_payments_to_orders — verify each payment maps to a completed order
 * 3. calculate_fees           — compute estimated card processing fees
 * 4. detect_discrepancies     — flag payments without matching orders or with wrong amounts
 * 5. post_net_to_accounting   — post net settlement entry (Revenue - Fees) to ledger
 * 6. emit_reconciliation_report — publish summary
 *
 * Safety: never silently mutate financial records on error.
 * On failure the workflow emits payment.reconciliation_exception and halts.
 * No compensation needed — this is a read-mostly reporting workflow.
 * The only mutation (accounting post) is guarded by a separate AccountingPostingWorkflow.
 */

const CASH_ACCOUNT = "1010";
const CARD_FEES_ACCOUNT = "6100"; // Payment processing fees expense
const REVENUE_ACCOUNT = "4000";

interface DiscrepancyRecord {
  paymentId: string;
  orderId: string;
  issue: string;
  amountCents: Cents;
}

export interface ReconciliationContext extends WorkflowContext {
  batchId: string;
  fromAt: number;
  toAt: number;
  paymentCount: number;
  totalCapturedCents: Cents;
  totalFeeCents: Cents;
  discrepancies: DiscrepancyRecord[];
  netSettlementCents: Cents;
  posted: boolean;
}

const CARD_FEE_RATE = 0.029; // 2.9% simulated processing fee

export const PaymentReconciliationWorkflow: WorkflowDefinition<ReconciliationContext> = {
  type: "payment_reconciliation",
  triggers: [EventTypes.PAYMENT_RECONCILIATION_STARTED],

  buildContext(payload: Record<string, unknown>, tenantId: string): ReconciliationContext {
    const p = payload as unknown as ReconciliationStartedPayload;
    return {
      workflowId: "",
      tenantId,
      correlationId: p.batchId,
      batchId: p.batchId,
      fromAt: p.fromAt,
      toAt: p.toAt,
      paymentCount: 0,
      totalCapturedCents: 0,
      totalFeeCents: 0,
      discrepancies: [],
      netSettlementCents: 0,
      posted: false,
    };
  },

  steps: [
    {
      name: "fetch_payment_batch",
      async execute(ctx, db) {
        const payments = await db.query<{ id: string; order_id: string; amount_cents: number; method: string }>(
          `SELECT id, order_id, amount_cents, method
             FROM payments
            WHERE tenant_id = @tenantId
              AND status = 'captured'
              AND created_at >= @fromAt
              AND created_at < @toAt
            ORDER BY created_at ASC`,
          { tenantId: ctx.tenantId, fromAt: ctx.fromAt, toAt: ctx.toAt },
        );
        const totalCapturedCents = payments.reduce((s, p) => s + p.amount_cents, 0);
        return { ...ctx, paymentCount: payments.length, totalCapturedCents };
      },
    },
    {
      name: "match_payments_to_orders",
      async execute(ctx, db) {
        const payments = await db.query<{ id: string; order_id: string; amount_cents: number }>(
          `SELECT id, order_id, amount_cents FROM payments
            WHERE tenant_id = @tenantId AND status = 'captured'
              AND created_at >= @fromAt AND created_at < @toAt`,
          { tenantId: ctx.tenantId, fromAt: ctx.fromAt, toAt: ctx.toAt },
        );
        const discrepancies: DiscrepancyRecord[] = [];
        for (const p of payments) {
          const order = await db.one<{ total_cents: number; status: string }>(
            "SELECT total_cents, status FROM orders WHERE id = @id AND tenant_id = @tenantId",
            { id: p.order_id, tenantId: ctx.tenantId },
          );
          if (!order) {
            discrepancies.push({ paymentId: p.id, orderId: p.order_id, issue: "no_matching_order", amountCents: p.amount_cents });
            continue;
          }
          if (Math.abs(order.total_cents - p.amount_cents) > 1) {
            discrepancies.push({ paymentId: p.id, orderId: p.order_id, issue: "amount_mismatch", amountCents: p.amount_cents });
          }
        }
        return { ...ctx, discrepancies };
      },
    },
    {
      name: "calculate_fees",
      async execute(ctx) {
        // Compute estimated card fees (in production this comes from the processor settlement file).
        const totalFeeCents = Math.round(ctx.totalCapturedCents * CARD_FEE_RATE);
        const netSettlementCents = ctx.totalCapturedCents - totalFeeCents;
        return { ...ctx, totalFeeCents, netSettlementCents };
      },
    },
    {
      name: "detect_discrepancies",
      async execute(ctx, _db, events) {
        if (ctx.discrepancies.length > 0) {
          await events.publish(EventTypes.PAYMENT_RECONCILIATION_EXCEPTION, {
            tenantId: ctx.tenantId,
            batchId: ctx.batchId,
            discrepancies: ctx.discrepancies,
          });
        }
        return ctx;
      },
    },
    {
      name: "post_net_to_accounting",
      async execute(ctx, _db, events) {
        // Only post if there's something to post.
        if (ctx.netSettlementCents <= 0) return ctx;
        await events.publish(EventTypes.ACCOUNTING_ENTRY_REQUESTED, {
          tenantId: ctx.tenantId,
          referenceId: ctx.batchId,
          referenceType: "payment_reconciliation",
          lines: [
            { accountCode: CASH_ACCOUNT, debitCents: ctx.netSettlementCents, creditCents: 0, description: `Reconciliation batch ${ctx.batchId} net settlement` },
            { accountCode: CARD_FEES_ACCOUNT, debitCents: ctx.totalFeeCents, creditCents: 0, description: `Card processing fees batch ${ctx.batchId}` },
            { accountCode: REVENUE_ACCOUNT, debitCents: 0, creditCents: ctx.totalCapturedCents, description: `Revenue settled batch ${ctx.batchId}` },
          ],
        });
        return { ...ctx, posted: true };
      },
    },
    {
      name: "emit_reconciliation_report",
      async execute(ctx, _db, events) {
        await events.publish(EventTypes.PAYMENT_RECONCILIATION_COMPLETED, {
          tenantId: ctx.tenantId,
          batchId: ctx.batchId,
          paymentCount: ctx.paymentCount,
          totalCapturedCents: ctx.totalCapturedCents,
          totalFeeCents: ctx.totalFeeCents,
          netSettlementCents: ctx.netSettlementCents,
          discrepancyCount: ctx.discrepancies.length,
        });
        return ctx;
      },
    },
  ],
};
