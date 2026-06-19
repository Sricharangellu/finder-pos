import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { CommandBus } from "../commands/command-bus.js";
import { CommandTypes } from "../commands/command-types.js";
import type { Command } from "../commands/command-types.js";
import { EventTypes } from "../events/event-types.js";

export function registerPurchasingHandlers(bus: CommandBus, db: DB, events: EventBus): void {
  bus.register(CommandTypes.VALIDATE_PO_RECEIPT, async (cmd: Command<{ poId: string }>) => {
    const po = await db.one<{ id: string; status: string }>(
      "SELECT id, status FROM purchase_orders WHERE id = @id AND tenant_id = @tenantId",
      { id: cmd.payload.poId, tenantId: cmd.tenantId },
    );
    if (!po) throw new Error(`PO '${cmd.payload.poId}' not found`);
    return { valid: true, status: po.status };
  });

  bus.register(CommandTypes.POST_AP_ACCOUNTING, async (cmd: Command<{ poId: string; totalCents: number }>) => {
    await events.publish(EventTypes.ACCOUNTING_ENTRY_REQUESTED, {
      tenantId: cmd.tenantId,
      referenceId: cmd.payload.poId,
      referenceType: "purchase_order",
      lines: [
        { accountCode: "1300", debitCents: cmd.payload.totalCents, creditCents: 0, description: `PO receipt ${cmd.payload.poId}` },
        { accountCode: "2000", debitCents: 0, creditCents: cmd.payload.totalCents, description: `AP payable ${cmd.payload.poId}` },
      ],
    });
    return { posted: true };
  });

  bus.register(CommandTypes.UPDATE_VENDOR_BALANCE, async (cmd: Command<{ supplierId: string; amountCents: number }>) => {
    await db.query(
      "UPDATE suppliers SET due_amount_cents = due_amount_cents + @amount, updated_at = @now WHERE id = @id AND tenant_id = @tenantId",
      { amount: cmd.payload.amountCents, now: Date.now(), id: cmd.payload.supplierId, tenantId: cmd.tenantId },
    );
    return { updated: true };
  });
}
