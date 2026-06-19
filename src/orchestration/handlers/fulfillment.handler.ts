import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { CommandBus } from "../commands/command-bus.js";
import { CommandTypes } from "../commands/command-types.js";
import type { Command } from "../commands/command-types.js";
import { EventTypes } from "../events/event-types.js";

export function registerFulfillmentHandlers(bus: CommandBus, db: DB, events: EventBus): void {
  bus.register(CommandTypes.CREATE_PICK_LIST, async (cmd: Command<{ orderId: string }>) => {
    const existing = await db.one<{ id: string }>(
      "SELECT id FROM pick_lists WHERE order_id = @orderId AND tenant_id = @tenantId LIMIT 1",
      { orderId: cmd.payload.orderId, tenantId: cmd.tenantId },
    );
    if (existing) return { pickListId: existing.id, created: false };

    await events.publish("fulfillment.pick_list_requested", {
      tenantId: cmd.tenantId,
      orderId: cmd.payload.orderId,
      correlationId: cmd.correlationId,
    });
    return { created: true };
  });

  bus.register(CommandTypes.ALLOCATE_INVENTORY, async (cmd: Command<{ orderId: string }>) => {
    await events.publish(EventTypes.INVENTORY_ADJUSTED, {
      tenantId: cmd.tenantId,
      orderId: cmd.payload.orderId,
      reason: "fulfillment_allocation",
    });
    return { allocated: true };
  });

  bus.register(CommandTypes.CREATE_SHIPMENT, async (cmd: Command<{ orderId: string; carrier?: string }>) => {
    await events.publish(EventTypes.SHIPMENT_CREATED, {
      tenantId: cmd.tenantId,
      orderId: cmd.payload.orderId,
      shipmentId: `ship_${cmd.payload.orderId}`,
      carrier: cmd.payload.carrier,
    });
    return { shipmentId: `ship_${cmd.payload.orderId}` };
  });
}
