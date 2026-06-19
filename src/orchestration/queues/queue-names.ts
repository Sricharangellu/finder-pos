/**
 * Canonical queue names used across the orchestration layer.
 * Import from here — not from queue-producer — to avoid circular deps.
 */
export const QueueNames = {
  ECOMMERCE_SYNC: "ecommerce_sync",
  PAYMENT_RECONCILIATION: "payment_reconciliation",
  ACCOUNTING_POSTING: "accounting_posting",
  EXPIRE_RESERVATIONS: "expire_reservations",
  CLOSE_REGISTER: "close_register",
  CUSTOMER_NOTIFICATION: "customer_notification",
  INVENTORY_TRANSFER: "inventory_transfer",
  STOCK_ADJUSTMENT: "stock_adjustment",
  RETURNS_PROCESSING: "returns_processing",
} as const;

export type QueueName = typeof QueueNames[keyof typeof QueueNames];
