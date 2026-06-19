import type { EventBus } from "../../shared/events.js";
import { EventTypes } from "./event-types.js";

export type EventHandler<T = unknown> = (payload: T, eventType: string) => Promise<void> | void;

interface RegistryEntry {
  eventType: string;
  description: string;
  handlers: string[];
}

/**
 * Central registry of all domain events known to the orchestration layer.
 * Used for discovery, documentation, and subscription bootstrapping.
 */
export class EventRegistry {
  private readonly registry = new Map<string, RegistryEntry>();

  constructor(private readonly bus: EventBus) {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    const definitions: Array<{ type: string; description: string }> = [
      { type: EventTypes.ORDER_CREATED, description: "Fires when a new order is opened in the POS" },
      { type: EventTypes.ORDER_COMPLETED, description: "Order marked as paid and complete" },
      { type: EventTypes.ORDER_REFUNDED, description: "Refund issued against a completed order" },
      { type: EventTypes.ORDER_VOIDED, description: "Order cancelled before payment" },
      { type: EventTypes.PAYMENT_CAPTURED, description: "Payment successfully captured" },
      { type: EventTypes.PAYMENT_REFUNDED, description: "Payment reversed" },
      { type: EventTypes.PAYMENT_RECONCILIATION_STARTED, description: "Daily reconciliation batch started" },
      { type: EventTypes.PAYMENT_RECONCILIATION_COMPLETED, description: "Reconciliation batch completed" },
      { type: EventTypes.INVENTORY_ADJUSTED, description: "Inventory quantity changed" },
      { type: EventTypes.INVENTORY_TRANSFER_REQUESTED, description: "Inter-outlet transfer initiated" },
      { type: EventTypes.INVENTORY_TRANSFER_COMPLETED, description: "Transfer confirmed at destination" },
      { type: EventTypes.STOCK_ADJUSTMENT_REQUESTED, description: "Manual stock count adjustment" },
      { type: EventTypes.STOCK_ADJUSTMENT_COMPLETED, description: "Adjustment applied and audited" },
      { type: EventTypes.PURCHASE_ORDER_CREATED, description: "Purchase order raised with vendor" },
      { type: EventTypes.PURCHASE_ORDER_RECEIVED, description: "Goods received against PO" },
      { type: EventTypes.PURCHASE_ORDER_CANCELLED, description: "PO cancelled" },
      { type: EventTypes.CUSTOMER_RETURN_REQUESTED, description: "Customer initiated a return" },
      { type: EventTypes.CUSTOMER_RETURN_COMPLETED, description: "Return processed" },
      { type: EventTypes.ACCOUNTING_ENTRY_REQUESTED, description: "Journal entry to be posted" },
      { type: EventTypes.ACCOUNTING_ENTRY_POSTED, description: "Journal entry successfully posted" },
      { type: EventTypes.ACCOUNTING_ENTRY_FAILED, description: "Accounting post failed" },
      { type: EventTypes.ECOMMERCE_SYNC_REQUESTED, description: "Platform sync initiated" },
      { type: EventTypes.ECOMMERCE_SYNC_COMPLETED, description: "Platform sync completed" },
      { type: EventTypes.ECOMMERCE_SYNC_FAILED, description: "Platform sync failed" },
      { type: EventTypes.ECOMMERCE_ORDER_RECEIVED, description: "Order received from ecommerce platform" },
      { type: EventTypes.WORKFLOW_STARTED, description: "Orchestration workflow started" },
      { type: EventTypes.WORKFLOW_COMPLETED, description: "Orchestration workflow completed" },
      { type: EventTypes.WORKFLOW_FAILED, description: "Orchestration workflow failed" },
      { type: EventTypes.WORKFLOW_COMPENSATED, description: "Orchestration workflow compensated" },
    ];

    for (const def of definitions) {
      this.registry.set(def.type, { eventType: def.type, description: def.description, handlers: [] });
    }
  }

  /** Subscribe a named handler to an event type and track it in the registry. */
  subscribe<T = unknown>(
    eventType: string,
    handlerName: string,
    handler: EventHandler<T>,
  ): void {
    const entry = this.registry.get(eventType);
    if (entry) {
      entry.handlers.push(handlerName);
    } else {
      this.registry.set(eventType, { eventType, description: "unregistered", handlers: [handlerName] });
    }
    this.bus.on(eventType, async (event) => {
      await handler(event.payload as T, eventType);
    });
  }

  /** List all registered event types and their subscribers. */
  list(): RegistryEntry[] {
    return Array.from(this.registry.values());
  }

  /** Check if an event type is known. */
  has(eventType: string): boolean {
    return this.registry.has(eventType);
  }
}
