import type { WorkflowDefinition, WorkflowContext } from "../types.js";
import { EventTypes } from "../events/event-types.js";
import type { CustomerReturnRequestedPayload } from "../events/domain-events.js";
import type { Cents } from "../../shared/money.js";

/**
 * Returns Workflow
 *
 * Trigger: customer_return.requested
 * Modules: orders, inventory, payments/giftcards, accounting, customers
 *
 * Steps:
 * 1. validate_return_items   — confirm items belong to original order and qty is valid
 * 2. capture_condition       — classify each returned item (resellable vs damaged)
 * 3. make_restock_decision   — restock only resellable items
 * 4. issue_credit_or_refund  — apply store credit or trigger refund workflow
 * 5. post_accounting         — reverse COGS on restocked items; write-off damaged
 * 6. emit_return_report      — publish customer_return.completed
 *
 * Compensations:
 * - make_restock_decision: reverse inventory additions
 * - issue_credit_or_refund: mark credit exception (cannot un-issue store credit)
 * - post_accounting: reverse the reversal
 */

const INVENTORY_ASSET_ACCOUNT = "1300";
const COGS_ACCOUNT = "5000";
const SHRINKAGE_ACCOUNT = "5200";
const RETURNS_LIABILITY_ACCOUNT = "2300"; // Store credit issued

export interface ReturnsContext extends WorkflowContext {
  returnId: string;
  orderId: string;
  customerId: string | null;
  lines: Array<{ productId: string; quantity: number; condition: "resellable" | "damaged" }>;
  restockedItems: Array<{ productId: string; quantity: number }>;
  damagedItems: Array<{ productId: string; quantity: number }>;
  creditIssuedCents: Cents;
  refundTriggered: boolean;
  restockApplied: boolean;
  accountingPosted: boolean;
  returnRecordId: string | null;
}

export const ReturnsWorkflow: WorkflowDefinition<ReturnsContext> = {
  type: "returns",
  triggers: [EventTypes.CUSTOMER_RETURN_REQUESTED],

  buildContext(payload: Record<string, unknown>, tenantId: string): ReturnsContext {
    const p = payload as unknown as CustomerReturnRequestedPayload;
    return {
      workflowId: "",
      tenantId,
      correlationId: `return_${p.returnId}`,
      returnId: p.returnId,
      orderId: p.orderId,
      customerId: p.customerId ?? null,
      lines: p.lines ?? [],
      restockedItems: [],
      damagedItems: [],
      creditIssuedCents: 0,
      refundTriggered: false,
      restockApplied: false,
      accountingPosted: false,
      returnRecordId: null,
    };
  },

  steps: [
    {
      name: "validate_return_items",
      async execute(ctx, db) {
        for (const line of ctx.lines) {
          const orderLine = await db.one<{ quantity: number }>(
            "SELECT quantity FROM order_lines WHERE order_id = @orderId AND product_id = @productId AND tenant_id = @tenantId",
            { orderId: ctx.orderId, productId: line.productId, tenantId: ctx.tenantId },
          );
          if (!orderLine) {
            throw new Error(`product '${line.productId}' not found in order '${ctx.orderId}'`);
          }
          if (line.quantity > orderLine.quantity) {
            throw new Error(
              `return qty ${line.quantity} exceeds ordered qty ${orderLine.quantity} for product '${line.productId}'`,
            );
          }
        }
        return ctx;
      },
    },
    {
      name: "capture_condition",
      async execute(ctx, db) {
        const { v7: uuidv7 } = await import("uuid");
        const returnRecordId = `ret_${uuidv7()}`;
        const now = Date.now();
        // Insert return record.
        await db.query(
          `INSERT INTO customer_returns
             (id, tenant_id, order_id, customer_id, status, created_at)
           VALUES (@id, @tenantId, @orderId, @customerId, 'processing', @now)
           ON CONFLICT (id) DO NOTHING`,
          {
            id: returnRecordId,
            tenantId: ctx.tenantId,
            orderId: ctx.orderId,
            customerId: ctx.customerId,
            now,
          },
        );
        const restockedItems = ctx.lines.filter((l) => l.condition === "resellable");
        const damagedItems = ctx.lines.filter((l) => l.condition === "damaged");
        return { ...ctx, returnRecordId, restockedItems, damagedItems };
      },
    },
    {
      name: "make_restock_decision",
      async execute(ctx, _db, events) {
        if (ctx.restockedItems.length === 0) return ctx;
        for (const item of ctx.restockedItems) {
          await events.publish(EventTypes.INVENTORY_ADJUSTED, {
            tenantId: ctx.tenantId,
            productId: item.productId,
            delta: item.quantity,
            reason: "customer_return_restock",
            referenceId: ctx.returnId,
          });
        }
        return { ...ctx, restockApplied: true };
      },
      async compensate(ctx, _db, events) {
        if (!ctx.restockApplied) return;
        for (const item of ctx.restockedItems) {
          await events.publish(EventTypes.INVENTORY_ADJUSTED, {
            tenantId: ctx.tenantId,
            productId: item.productId,
            delta: -item.quantity,
            reason: "return_compensation",
            referenceId: ctx.returnId,
          });
        }
      },
    },
    {
      name: "issue_credit_or_refund",
      async execute(ctx, db, events) {
        // Calculate credit value from restocked items (damaged items get no credit by default).
        let creditCents = 0;
        for (const item of ctx.restockedItems) {
          const product = await db.one<{ price_cents: number }>(
            "SELECT price_cents FROM products WHERE id = @id AND tenant_id = @tenantId",
            { id: item.productId, tenantId: ctx.tenantId },
          );
          creditCents += (product?.price_cents ?? 0) * item.quantity;
        }

        if (creditCents > 0) {
          // Issue store credit (giftcard module handles the balance).
          await events.publish(EventTypes.GIFTCARD_ACTIVATED, {
            tenantId: ctx.tenantId,
            customerId: ctx.customerId,
            amountCents: creditCents,
            reason: "customer_return",
            referenceId: ctx.returnId,
          });
        }
        return { ...ctx, creditIssuedCents: creditCents, refundTriggered: creditCents > 0 };
      },
      async compensate(ctx, _db, events) {
        if (ctx.creditIssuedCents <= 0) return;
        // Mark credit exception — cannot revoke store credit automatically.
        await events.publish("returns.credit_exception", {
          tenantId: ctx.tenantId,
          returnId: ctx.returnId,
          creditCents: ctx.creditIssuedCents,
          reason: "workflow_compensation",
        });
      },
    },
    {
      name: "post_accounting",
      async execute(ctx, _db, events) {
        const accountingLines: Array<{
          accountCode: string; debitCents: number; creditCents: number; description: string;
        }> = [];

        // Credit store credit liability.
        if (ctx.creditIssuedCents > 0) {
          accountingLines.push(
            { accountCode: COGS_ACCOUNT, debitCents: 0, creditCents: ctx.creditIssuedCents, description: `Return COGS reversal ret=${ctx.returnId}` },
            { accountCode: INVENTORY_ASSET_ACCOUNT, debitCents: ctx.creditIssuedCents, creditCents: 0, description: `Return inventory restore` },
          );
          accountingLines.push(
            { accountCode: RETURNS_LIABILITY_ACCOUNT, debitCents: ctx.creditIssuedCents, creditCents: 0, description: `Store credit issued ret=${ctx.returnId}` },
            { accountCode: COGS_ACCOUNT, debitCents: 0, creditCents: ctx.creditIssuedCents, description: `Return credit offset` },
          );
        }

        // Write off damaged items.
        // Simplified: post a nominal $0 entry as placeholder (real impl would look up cost basis).
        if (ctx.damagedItems.length > 0) {
          accountingLines.push(
            { accountCode: SHRINKAGE_ACCOUNT, debitCents: 0, creditCents: 0, description: `Damaged return write-off ret=${ctx.returnId} (manual valuation required)` },
          );
        }

        if (accountingLines.some((l) => l.debitCents > 0 || l.creditCents > 0)) {
          await events.publish(EventTypes.ACCOUNTING_ENTRY_REQUESTED, {
            tenantId: ctx.tenantId,
            referenceId: ctx.returnId,
            referenceType: "customer_return",
            lines: accountingLines,
          });
        }
        return { ...ctx, accountingPosted: true };
      },
      async compensate(ctx, _db, events) {
        if (!ctx.accountingPosted || ctx.creditIssuedCents <= 0) return;
        // Reverse the accounting entry.
        await events.publish(EventTypes.ACCOUNTING_ENTRY_REQUESTED, {
          tenantId: ctx.tenantId,
          referenceId: `${ctx.returnId}_compensation`,
          referenceType: "customer_return_compensation",
          lines: [
            { accountCode: COGS_ACCOUNT, debitCents: ctx.creditIssuedCents, creditCents: 0, description: `Compensation COGS restore` },
            { accountCode: INVENTORY_ASSET_ACCOUNT, debitCents: 0, creditCents: ctx.creditIssuedCents, description: `Compensation inventory reverse` },
          ],
        });
      },
    },
    {
      name: "emit_return_report",
      async execute(ctx, db, events) {
        // Mark return as completed.
        await db.query(
          "UPDATE customer_returns SET status = 'completed', updated_at = @now WHERE id = @id AND tenant_id = @tenantId",
          { id: ctx.returnRecordId, tenantId: ctx.tenantId, now: Date.now() },
        );
        await events.publish(EventTypes.CUSTOMER_RETURN_COMPLETED, {
          tenantId: ctx.tenantId,
          returnId: ctx.returnId,
          orderId: ctx.orderId,
          customerId: ctx.customerId,
          restockedCount: ctx.restockedItems.length,
          damagedCount: ctx.damagedItems.length,
          creditIssuedCents: ctx.creditIssuedCents,
        });
        return ctx;
      },
    },
  ],
};
