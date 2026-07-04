import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { CommandBus } from "../commands/command-bus.js";
import { CommandTypes } from "../commands/command-types.js";
import type { Command } from "../commands/command-types.js";

export function registerStoreHandlers(bus: CommandBus, db: DB, events: EventBus): void {
  bus.register(CommandTypes.OPEN_STORE_SESSION, async (cmd: Command<{ registerId: string; openingFloatCents?: number; openedBy?: string }>) => {
    await db.query(
      "UPDATE registers SET status = 'open', updated_at = @now WHERE id = @registerId AND tenant_id = @tenantId",
      { registerId: cmd.payload.registerId, tenantId: cmd.tenantId, now: Date.now() },
    );
    await events.publish("store.session_open_requested", {
      tenantId: cmd.tenantId,
      registerId: cmd.payload.registerId,
      openingFloatCents: cmd.payload.openingFloatCents ?? 0,
      openedBy: cmd.payload.openedBy,
      correlationId: cmd.correlationId,
    });
    return { opened: true, registerId: cmd.payload.registerId };
  });

  bus.register(CommandTypes.CLOSE_STORE_SESSION, async (cmd: Command<{ registerId: string; countedCashCents?: number; closingFloatCents?: number }>) => {
    await db.query(
      "UPDATE registers SET status = 'closed', updated_at = @now WHERE id = @registerId AND tenant_id = @tenantId",
      { registerId: cmd.payload.registerId, tenantId: cmd.tenantId, now: Date.now() },
    );
    await events.publish("store.session_close_requested", {
      tenantId: cmd.tenantId,
      registerId: cmd.payload.registerId,
      countedCashCents: cmd.payload.countedCashCents,
      closingFloatCents: cmd.payload.closingFloatCents,
      correlationId: cmd.correlationId,
    });
    return { closed: true, registerId: cmd.payload.registerId };
  });
}
