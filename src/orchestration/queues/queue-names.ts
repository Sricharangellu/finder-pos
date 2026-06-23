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
  /** INF-6: AR dunning sweep — runs per-tenant on a 24 h schedule. */
  AR_DUNNING: "ar_dunning",
  /** INF-6: Durable webhook delivery retry — survives process restart. */
  WEBHOOK_DELIVERY: "webhook_delivery",
  /** DB-10: Idempotency key expiry sweep — deletes expired keys every 6 hours. */
  IDEMPOTENCY_EXPIRY: "idempotency_expiry",
} as const;

export type QueueName = typeof QueueNames[keyof typeof QueueNames];
