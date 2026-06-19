import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { CommandBus } from "../commands/command-bus.js";
import { CommandTypes } from "../commands/command-types.js";
import type { Command } from "../commands/command-types.js";
import { EventTypes } from "../events/event-types.js";
import { IdempotencyStore } from "../idempotency/idempotency-store.js";

export function registerInventoryHandlers(bus: CommandBus, db: DB, events: EventBus): void {
  const idempotency = new IdempotencyStore(db);

  bus.register(CommandTypes.TRANSFER_INVENTORY, async (cmd: Command<{
    transferId: string; fromOutletId: string; toOutletId: string; productId: string; quantity: number;
  }>) => {
    const cached = await idempotency.check(cmd.tenantId, cmd.idempotencyKey);
    if (cached) return JSON.parse(cached);

    await events.publish(EventTypes.INVENTORY_TRANSFER_REQUESTED, {
      tenantId: cmd.tenantId,
      ...cmd.payload,
    });

    const result = { transferId: cmd.payload.transferId, queued: true };
    await idempotency.record(cmd.tenantId, cmd.idempotencyKey, null, result);
    return result;
  });

  bus.register(CommandTypes.APPLY_ADJUSTMENT, async (cmd: Command<{
    productId: string; delta: number; reason: string; referenceId?: string; userId?: string;
  }>) => {
    const cached = await idempotency.check(cmd.tenantId, cmd.idempotencyKey);
    if (cached) return JSON.parse(cached);

    await events.publish(EventTypes.STOCK_ADJUSTMENT_REQUESTED, {
      tenantId: cmd.tenantId,
      ...cmd.payload,
    });

    const result = { adjusted: true, productId: cmd.payload.productId };
    await idempotency.record(cmd.tenantId, cmd.idempotencyKey, null, result);
    return result;
  });
}
