import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { WorkflowDefinition, WorkflowContext } from "../types.js";
import { EventTypes } from "../events/event-types.js";
import type { PurchaseOrderReceivedPayload } from "../events/domain-events.js";
import type { Cents } from "../../shared/money.js";

/**
 * Purchasing & Receiving Workflow
 *
 * Trigger: purchase_order.received
 * Modules: purchasing (suppliers, POs), inventory (already updated via event), accounting
 *
 * Steps:
 * 1. validate_po          — confirm PO exists and is received/partially_received
 * 2. post_ap_accounting   — debit Inventory, credit Accounts Payable
 * 3. update_vendor_balance — increment due_amount_cents on the supplier
 * 4. emit_goods_received  — publish downstream event for report dashboards
 *
 * Compensations:
 * - post_ap_accounting: reverse the AP journal entry
 * - update_vendor_balance: decrement vendor balance back
 */

const INVENTORY_ASSET_ACCOUNT = "1300";   // Inventory Asset
const ACCOUNTS_PAYABLE_ACCOUNT = "2000";  // Accounts Payable

export interface PurchaseReceivingContext extends WorkflowContext {
  poId: string;
  supplierId: string;
  totalCostCents: Cents;
  landedCostCents: Cents;
  lines: Array<{ productId: string; quantity: number; unitCostCents: number; landedCostCents: number }>;
  apPosted: boolean;
  vendorBalanceUpdated: boolean;
}

export const PurchaseReceivingWorkflow: WorkflowDefinition<PurchaseReceivingContext> = {
  type: "purchase_receiving",
  triggers: [EventTypes.PURCHASE_ORDER_RECEIVED],

  buildContext(payload: Record<string, unknown>, tenantId: string): PurchaseReceivingContext {
    const p = payload as unknown as PurchaseOrderReceivedPayload;
    const totalCostCents = p.totalCostCents ?? 0;
    const landedCostCents = p.lines?.reduce((s, l) => s + (l.landedCostCents ?? 0), 0) ?? 0;
    return {
      workflowId: "",
      tenantId,
      correlationId: p.poId,
      poId: p.poId,
      supplierId: p.supplierId ?? "",
      totalCostCents,
      landedCostCents,
      lines: (p.lines ?? []).map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitCostCents: l.unitCostCents,
        landedCostCents: l.landedCostCents ?? 0,
      })),
      apPosted: false,
      vendorBalanceUpdated: false,
    };
  },

  steps: [
    {
      name: "validate_po",
      async execute(ctx, db) {
        const po = await db.one<{ id: string; status: string; supplier_id: string; total_cost_cents: number }>(
          "SELECT id, status, supplier_id, total_cost_cents FROM purchase_orders WHERE id = @id AND tenant_id = @tenantId",
          { id: ctx.poId, tenantId: ctx.tenantId },
        );
        if (!po) throw new Error(`purchase order '${ctx.poId}' not found`);
        if (!["received", "partially_received"].includes(po.status)) {
          throw new Error(`purchase order '${ctx.poId}' has unexpected status '${po.status}'`);
        }
        return {
          ...ctx,
          supplierId: po.supplier_id,
          totalCostCents: po.total_cost_cents,
        };
      },
    },
    {
      name: "post_ap_accounting",
      async execute(ctx, _db, events) {
        const totalWithLanding = ctx.totalCostCents + ctx.landedCostCents;
        await events.publish(EventTypes.ACCOUNTING_ENTRY_REQUESTED, {
          tenantId: ctx.tenantId,
          referenceId: ctx.poId,
          referenceType: "purchase_order",
          lines: [
            {
              accountCode: INVENTORY_ASSET_ACCOUNT,
              debitCents: totalWithLanding,
              creditCents: 0,
              description: `PO ${ctx.poId} goods receipt`,
            },
            {
              accountCode: ACCOUNTS_PAYABLE_ACCOUNT,
              debitCents: 0,
              creditCents: totalWithLanding,
              description: `PO ${ctx.poId} AP payable`,
            },
          ],
        });
        return { ...ctx, apPosted: true };
      },
      async compensate(ctx, _db, events) {
        if (!ctx.apPosted) return;
        const totalWithLanding = ctx.totalCostCents + ctx.landedCostCents;
        await events.publish(EventTypes.ACCOUNTING_ENTRY_REQUESTED, {
          tenantId: ctx.tenantId,
          referenceId: `${ctx.poId}_reversal`,
          referenceType: "purchase_order_reversal",
          lines: [
            { accountCode: INVENTORY_ASSET_ACCOUNT, debitCents: 0, creditCents: totalWithLanding, description: `Reversal PO ${ctx.poId}` },
            { accountCode: ACCOUNTS_PAYABLE_ACCOUNT, debitCents: totalWithLanding, creditCents: 0, description: `Reversal PO ${ctx.poId} AP` },
          ],
        });
      },
    },
    {
      name: "update_vendor_balance",
      async execute(ctx, db) {
        if (!ctx.supplierId) return ctx;
        const totalWithLanding = ctx.totalCostCents + ctx.landedCostCents;
        await db.query(
          `UPDATE suppliers
             SET due_amount_cents = due_amount_cents + @amount, updated_at = @now
           WHERE id = @id AND tenant_id = @tenantId`,
          { amount: totalWithLanding, now: Date.now(), id: ctx.supplierId, tenantId: ctx.tenantId },
        );
        return { ...ctx, vendorBalanceUpdated: true };
      },
      async compensate(ctx, db) {
        if (!ctx.vendorBalanceUpdated || !ctx.supplierId) return;
        const totalWithLanding = ctx.totalCostCents + ctx.landedCostCents;
        await db.query(
          `UPDATE suppliers
             SET due_amount_cents = GREATEST(0, due_amount_cents - @amount), updated_at = @now
           WHERE id = @id AND tenant_id = @tenantId`,
          { amount: totalWithLanding, now: Date.now(), id: ctx.supplierId, tenantId: ctx.tenantId },
        );
      },
    },
    {
      name: "emit_goods_received",
      async execute(ctx, _db, events) {
        await events.publish("purchasing.goods_received", {
          tenantId: ctx.tenantId,
          poId: ctx.poId,
          supplierId: ctx.supplierId,
          totalCostCents: ctx.totalCostCents,
          landedCostCents: ctx.landedCostCents,
        });
        return ctx;
      },
    },
  ],
};
