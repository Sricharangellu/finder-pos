import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { CommandBus } from "../commands/command-bus.js";
import { CommandTypes } from "../commands/command-types.js";
import type { Command } from "../commands/command-types.js";
import { EventTypes } from "../events/event-types.js";

export function registerEcommerceHandlers(bus: CommandBus, _db: DB, events: EventBus): void {
  bus.register(CommandTypes.PULL_EXTERNAL_ORDERS, async (cmd: Command<{ platform: string; since?: number }>) => {
    await events.publish(EventTypes.ECOMMERCE_SYNC_REQUESTED, {
      tenantId: cmd.tenantId,
      platform: cmd.payload.platform,
      mode: "pull_orders",
      since: cmd.payload.since,
      correlationId: cmd.correlationId,
    });
    return { queued: true, platform: cmd.payload.platform };
  });

  bus.register(CommandTypes.PUSH_STATUS_UPDATE, async (cmd: Command<{ platform: string; orderId: string; status: string }>) => {
    await events.publish("ecommerce.status_push_requested", {
      tenantId: cmd.tenantId,
      platform: cmd.payload.platform,
      orderId: cmd.payload.orderId,
      status: cmd.payload.status,
      correlationId: cmd.correlationId,
    });
    return { queued: true, orderId: cmd.payload.orderId };
  });
}
