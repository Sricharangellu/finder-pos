import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { CommandBus } from "../commands/command-bus.js";
import { CommandTypes } from "../commands/command-types.js";
import type { Command } from "../commands/command-types.js";
import { IdempotencyStore } from "../idempotency/idempotency-store.js";

/**
 * Checkout Command Handlers
 * Wired into the CommandBus by the orchestration bootstrapper.
 */
export function registerCheckoutHandlers(bus: CommandBus, db: DB, events: EventBus): void {
  const idempotency = new IdempotencyStore(db);

  bus.register(CommandTypes.VALIDATE_CART, async (cmd: Command<{ orderId: string }>) => {
    const { orderId } = cmd.payload;
    const order = await db.one<{ id: string; status: string }>(
      "SELECT id, status FROM orders WHERE id = @id AND tenant_id = @tenantId",
      { id: orderId, tenantId: cmd.tenantId },
    );
    if (!order) throw new Error(`order '${orderId}' not found`);
    return { valid: true, orderId, status: order.status };
  });

  bus.register(CommandTypes.RESERVE_INVENTORY, async (cmd: Command<{ orderId: string }>) => {
    const cached = await idempotency.check(cmd.tenantId, cmd.idempotencyKey);
    if (cached) return JSON.parse(cached);

    await events.publish("inventory.reservation_requested", {
      tenantId: cmd.tenantId,
      orderId: cmd.payload.orderId,
      correlationId: cmd.correlationId,
    });

    const result = { reserved: true, orderId: cmd.payload.orderId };
    await idempotency.record(cmd.tenantId, cmd.idempotencyKey, null, result);
    return result;
  });

  bus.register(CommandTypes.AUTHORIZE_PAYMENT, async (cmd: Command<{ orderId: string; amountCents: number; method?: string }>) => {
    await events.publish("payment.authorization_requested", {
      tenantId: cmd.tenantId,
      orderId: cmd.payload.orderId,
      amountCents: cmd.payload.amountCents,
      method: cmd.payload.method,
      correlationId: cmd.correlationId,
    });
    return { authorized: true, orderId: cmd.payload.orderId };
  });

  bus.register(CommandTypes.COMMIT_INVENTORY, async (cmd: Command<{ orderId: string }>) => {
    await events.publish("inventory.committed", {
      tenantId: cmd.tenantId,
      orderId: cmd.payload.orderId,
    });
    return { committed: true };
  });

  bus.register(CommandTypes.POST_CHECKOUT_ACCOUNTING, async (cmd: Command<{ orderId: string; totalCents: number; taxCents: number }>) => {
    const cached = await idempotency.check(cmd.tenantId, cmd.idempotencyKey);
    if (cached) return JSON.parse(cached);

    await events.publish("accounting.entry_requested", {
      tenantId: cmd.tenantId,
      referenceId: cmd.payload.orderId,
      referenceType: "checkout",
      lines: [
        { accountCode: "1010", debitCents: cmd.payload.totalCents, creditCents: 0, description: `Checkout order=${cmd.payload.orderId}` },
        { accountCode: "4000", debitCents: 0, creditCents: cmd.payload.totalCents - cmd.payload.taxCents, description: "Revenue" },
        { accountCode: "2200", debitCents: 0, creditCents: cmd.payload.taxCents, description: "Tax payable" },
      ],
    });

    const result = { posted: true };
    await idempotency.record(cmd.tenantId, cmd.idempotencyKey, null, result);
    return result;
  });
}
