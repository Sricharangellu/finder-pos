import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { CommandBus } from "../commands/command-bus.js";
import { CommandTypes } from "../commands/command-types.js";
import type { Command } from "../commands/command-types.js";
import { EventTypes } from "../events/event-types.js";
import { IdempotencyStore } from "../idempotency/idempotency-store.js";

export function registerPaymentHandlers(bus: CommandBus, db: DB, events: EventBus): void {
  const idempotency = new IdempotencyStore(db);

  bus.register(CommandTypes.PROCESS_REFUND, async (cmd: Command<{ orderId: string; amountCents: number; refundId: string }>) => {
    // Hard idempotency guard: never double-refund.
    const cached = await idempotency.check(cmd.tenantId, cmd.idempotencyKey);
    if (cached) return JSON.parse(cached);

    const existing = await db.one<{ id: string; status: string }>(
      "SELECT id, status FROM refunds WHERE id = @id AND tenant_id = @tenantId",
      { id: cmd.payload.refundId, tenantId: cmd.tenantId },
    );
    if (existing?.status === "processed") {
      const r = { refunded: true, refundId: cmd.payload.refundId, idempotent: true };
      await idempotency.record(cmd.tenantId, cmd.idempotencyKey, null, r);
      return r;
    }

    await events.publish(EventTypes.PAYMENT_REFUNDED, {
      tenantId: cmd.tenantId,
      orderId: cmd.payload.orderId,
      refundId: cmd.payload.refundId,
      amountCents: cmd.payload.amountCents,
    });

    const result = { refunded: true, refundId: cmd.payload.refundId };
    await idempotency.record(cmd.tenantId, cmd.idempotencyKey, null, result);
    return result;
  });

  bus.register(CommandTypes.RECONCILE_BATCH, async (cmd: Command<{ batchId: string; fromAt: number; toAt: number }>) => {
    await events.publish(EventTypes.PAYMENT_RECONCILIATION_STARTED, {
      tenantId: cmd.tenantId,
      batchId: cmd.payload.batchId,
      fromAt: cmd.payload.fromAt,
      toAt: cmd.payload.toAt,
    });
    return { started: true, batchId: cmd.payload.batchId };
  });
}
