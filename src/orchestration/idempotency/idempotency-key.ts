import { createHash } from "node:crypto";

/**
 * Idempotency key generation helpers.
 * Produces stable, deterministic keys from business-meaningful inputs
 * so the same logical operation always maps to the same idempotency key.
 */
export const IdempotencyKey = {
  /** Hash a string key to a stable hex identifier. */
  hash(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  },

  /** Key for a checkout operation tied to an order. */
  forCheckout(tenantId: string, orderId: string): string {
    return IdempotencyKey.hash(`checkout:${tenantId}:${orderId}`);
  },

  /** Key for a payment capture. */
  forPaymentCapture(tenantId: string, orderId: string, method: string): string {
    return IdempotencyKey.hash(`payment_capture:${tenantId}:${orderId}:${method}`);
  },

  /** Key for a refund. */
  forRefund(tenantId: string, orderId: string, amountCents: number): string {
    return IdempotencyKey.hash(`refund:${tenantId}:${orderId}:${amountCents}`);
  },

  /** Key for an inventory adjustment. */
  forAdjustment(tenantId: string, productId: string, referenceId: string): string {
    return IdempotencyKey.hash(`adj:${tenantId}:${productId}:${referenceId}`);
  },

  /** Key for a journal entry. */
  forJournalEntry(tenantId: string, referenceId: string, referenceType: string): string {
    return IdempotencyKey.hash(`je:${tenantId}:${referenceId}:${referenceType}`);
  },

  /** Key for an ecommerce sync batch. */
  forEcommerceSync(tenantId: string, platform: string, since: number): string {
    return IdempotencyKey.hash(`esync:${tenantId}:${platform}:${since}`);
  },

  /** Key for a webhook event. */
  forWebhook(platform: string, eventId: string): string {
    return IdempotencyKey.hash(`webhook:${platform}:${eventId}`);
  },
};
