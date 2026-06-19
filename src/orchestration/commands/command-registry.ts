import type { CommandBus } from "./command-bus.js";
import type { CommandType } from "./command-types.js";

interface CommandEntry {
  type: string;
  description: string;
  module: string;
  registered: boolean;
}

/**
 * Documents every command dispatched through the CommandBus.
 * Used for discovery and health-checks at startup.
 */
export class CommandRegistry {
  private readonly definitions: CommandEntry[] = [
    { type: "checkout.validate_cart", description: "Validate cart items and pricing", module: "orders", registered: false },
    { type: "checkout.reserve_inventory", description: "Reserve inventory for checkout", module: "inventory", registered: false },
    { type: "checkout.authorize_payment", description: "Authorize payment at checkout", module: "payments", registered: false },
    { type: "checkout.commit_inventory", description: "Commit reserved inventory post-payment", module: "inventory", registered: false },
    { type: "checkout.post_accounting", description: "Post checkout journal entry", module: "accounting", registered: false },
    { type: "fulfillment.create_pick_list", description: "Create a pick list for an order", module: "fulfillment", registered: false },
    { type: "fulfillment.allocate_inventory", description: "Allocate stock to fulfillment", module: "inventory", registered: false },
    { type: "fulfillment.create_shipment", description: "Create shipment record", module: "shipping", registered: false },
    { type: "purchasing.validate_receipt", description: "Validate PO receipt", module: "purchasing", registered: false },
    { type: "purchasing.post_ap", description: "Post AP journal entry", module: "accounting", registered: false },
    { type: "purchasing.update_vendor_balance", description: "Update supplier balance", module: "purchasing", registered: false },
    { type: "inventory.transfer", description: "Execute inventory transfer", module: "inventory", registered: false },
    { type: "inventory.apply_adjustment", description: "Apply stock adjustment", module: "inventory", registered: false },
    { type: "payment.process_refund", description: "Process payment refund", module: "payments", registered: false },
    { type: "payment.reconcile_batch", description: "Reconcile payment batch", module: "payments", registered: false },
    { type: "accounting.post_journal", description: "Post journal entry to ledger", module: "accounting", registered: false },
    { type: "accounting.reverse_journal", description: "Reverse an existing journal entry", module: "accounting", registered: false },
    { type: "ecommerce.pull_orders", description: "Pull new orders from ecommerce platform", module: "ecommerce", registered: false },
    { type: "ecommerce.push_status", description: "Push order status to ecommerce platform", module: "ecommerce", registered: false },
    { type: "store.open_session", description: "Open a store register session", module: "outlets", registered: false },
    { type: "store.close_session", description: "Close a store register session", module: "outlets", registered: false },
  ];

  constructor(private readonly bus: CommandBus) {}

  markRegistered(type: CommandType): void {
    const entry = this.definitions.find((d) => d.type === type);
    if (entry) entry.registered = true;
  }

  list(): CommandEntry[] {
    return this.definitions;
  }

  unregistered(): CommandEntry[] {
    return this.definitions.filter((d) => !d.registered);
  }

  audit(): void {
    const missing = this.unregistered();
    if (missing.length > 0) {
      const names = missing.map((m) => m.type).join(", ");
      console.warn(`[command-registry] ${missing.length} commands not yet registered: ${names}`);
    }
  }
}
