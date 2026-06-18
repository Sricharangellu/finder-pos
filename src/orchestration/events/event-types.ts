/** All domain event type strings used across the orchestration layer. */
export const EventTypes = {
  // Orders
  ORDER_CREATED: "order.created",
  ORDER_REFUNDED: "order.refunded",
  ORDER_VOIDED: "order.voided",
  ORDER_COMPLETED: "order.completed",
  ORDER_FULFILLMENT_STARTED: "order.fulfillment_started",
  ORDER_FULFILLMENT_COMPLETED: "order.fulfillment_completed",

  // Payments
  PAYMENT_CAPTURED: "payment.captured",
  PAYMENT_REFUNDED: "payment.refunded",
  PAYMENT_RECONCILIATION_STARTED: "payment.reconciliation_started",
  PAYMENT_RECONCILIATION_COMPLETED: "payment.reconciliation_completed",
  PAYMENT_RECONCILIATION_EXCEPTION: "payment.reconciliation_exception",

  // Inventory
  INVENTORY_ADJUSTED: "inventory.adjusted",
  INVENTORY_TRANSFER_REQUESTED: "inventory.transfer_requested",
  INVENTORY_TRANSFER_COMPLETED: "inventory.transfer_completed",
  INVENTORY_TRANSFER_FAILED: "inventory.transfer_failed",
  STOCK_ADJUSTMENT_REQUESTED: "stock.adjustment_requested",
  STOCK_ADJUSTMENT_COMPLETED: "stock.adjustment_completed",
  STOCK_WRITTEN_OFF: "stock.written_off",

  // Purchasing
  PURCHASE_ORDER_CREATED: "purchase_order.created",
  PURCHASE_ORDER_RECEIVED: "purchase_order.received",
  PURCHASE_ORDER_CANCELLED: "purchase_order.cancelled",

  // Returns
  VENDOR_RETURN_CREATED: "vendor_return.created",
  CUSTOMER_RETURN_REQUESTED: "customer_return.requested",
  CUSTOMER_RETURN_COMPLETED: "customer_return.completed",

  // Accounting
  ACCOUNTING_ENTRY_REQUESTED: "accounting.entry_requested",
  ACCOUNTING_ENTRY_POSTED: "accounting.entry_posted",
  ACCOUNTING_ENTRY_FAILED: "accounting.entry_failed",

  // Customers & Loyalty
  CUSTOMER_CREATED: "customer.created",
  LOYALTY_POINTS_EARNED: "loyalty.points_earned",
  LOYALTY_POINTS_REDEEMED: "loyalty.points_redeemed",
  LOYALTY_TIER_UPGRADED: "loyalty.tier_upgraded",

  // Gift cards
  GIFTCARD_ACTIVATED: "giftcard.activated",
  GIFTCARD_REDEEMED: "giftcard.redeemed",

  // Ecommerce
  ECOMMERCE_SYNC_REQUESTED: "ecommerce.sync_requested",
  ECOMMERCE_SYNC_COMPLETED: "ecommerce.sync_completed",
  ECOMMERCE_SYNC_FAILED: "ecommerce.sync_failed",
  ECOMMERCE_ORDER_RECEIVED: "ecommerce.order_received",

  // Store sessions
  STORE_OPENING_REQUESTED: "store.opening_requested",
  STORE_OPENED: "store.opened",
  STORE_CLOSING_REQUESTED: "store.closing_requested",
  STORE_CLOSED: "store.closed",

  // Shipping
  SHIPMENT_CREATED: "shipment.created",
  SHIPMENT_DISPATCHED: "shipment.dispatched",
  SHIPMENT_DELIVERED: "shipment.delivered",

  // Workflow lifecycle
  WORKFLOW_STARTED: "workflow.started",
  WORKFLOW_STEP_COMPLETED: "workflow.step_completed",
  WORKFLOW_COMPLETED: "workflow.completed",
  WORKFLOW_FAILED: "workflow.failed",
  WORKFLOW_COMPENSATED: "workflow.compensated",
} as const;

export type EventType = typeof EventTypes[keyof typeof EventTypes];
