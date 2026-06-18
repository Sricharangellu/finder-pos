/** Command type strings dispatched through the command bus. */
export const CommandTypes = {
  // Checkout
  VALIDATE_CART: "checkout.validate_cart",
  RESERVE_INVENTORY: "checkout.reserve_inventory",
  AUTHORIZE_PAYMENT: "checkout.authorize_payment",
  COMMIT_INVENTORY: "checkout.commit_inventory",
  POST_CHECKOUT_ACCOUNTING: "checkout.post_accounting",

  // Fulfillment
  CREATE_PICK_LIST: "fulfillment.create_pick_list",
  ALLOCATE_INVENTORY: "fulfillment.allocate_inventory",
  CREATE_SHIPMENT: "fulfillment.create_shipment",

  // Purchasing
  VALIDATE_PO_RECEIPT: "purchasing.validate_receipt",
  POST_AP_ACCOUNTING: "purchasing.post_ap",
  UPDATE_VENDOR_BALANCE: "purchasing.update_vendor_balance",

  // Inventory
  TRANSFER_INVENTORY: "inventory.transfer",
  APPLY_ADJUSTMENT: "inventory.apply_adjustment",

  // Payments
  PROCESS_REFUND: "payment.process_refund",
  RECONCILE_BATCH: "payment.reconcile_batch",

  // Accounting
  POST_JOURNAL_ENTRY: "accounting.post_journal",
  REVERSE_JOURNAL_ENTRY: "accounting.reverse_journal",

  // Ecommerce
  PULL_EXTERNAL_ORDERS: "ecommerce.pull_orders",
  PUSH_STATUS_UPDATE: "ecommerce.push_status",

  // Store
  OPEN_STORE_SESSION: "store.open_session",
  CLOSE_STORE_SESSION: "store.close_session",
} as const;

export type CommandType = typeof CommandTypes[keyof typeof CommandTypes];

export interface Command<T = Record<string, unknown>> {
  type: CommandType;
  payload: T;
  tenantId: string;
  correlationId: string;
  idempotencyKey: string;
  issuedAt: number;
}
