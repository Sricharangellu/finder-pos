# Webhooks & integrations

## What are webhooks?

Webhooks let external systems receive real-time notifications when events happen in Ascend. Instead of polling the API, your system receives a POST request the moment an event fires.

## Setting up a webhook

**Settings → Webhooks → New webhook** (owner only):
1. Enter your endpoint URL (must be HTTPS)
2. Select the event types to subscribe to
3. Optionally enter a secret for signature verification
4. Save — Ascend starts delivering events immediately

## Event types

| Event | Fires when |
|---|---|
| `order.completed` | A sale is completed |
| `order.refunded` | A refund is processed |
| `order.voided` | An order is voided |
| `inventory.low_stock` | A product hits its reorder point |
| `inventory.received` | Stock is received from a PO |
| `customer.created` | A new customer is added |
| `customer.updated` | A customer profile is updated |
| `loyalty.tier_upgraded` | A customer moves to a higher loyalty tier |
| `payment.captured` | A payment is captured |
| `payment.failed` | A payment fails |
| `invoice.created` | A B2B invoice is created |
| `invoice.paid` | An invoice is marked paid |
| `invoice.overdue` | An invoice passes its due date unpaid |
| `appointment.created` | A new appointment is booked |
| `appointment.completed` | An appointment is marked complete |

## Payload format

All events follow the same envelope:

```json
{
  "id": "evt_01jz...",
  "type": "order.completed",
  "tenantId": "tnt_demo",
  "timestamp": 1717123456789,
  "data": {
    // event-specific payload
  }
}
```

## Signature verification

If you set a secret when creating the webhook, Ascend signs each delivery:

```
X-Finder-Signature: sha256=<hmac-sha256 of raw body using your secret>
```

Verify in your endpoint:
```javascript
const sig = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(receivedSig.replace("sha256=","")))) {
  return res.status(401).send("Invalid signature");
}
```

Signatures use AES-256-GCM encryption for the secret at rest.

## Retry policy

Failed deliveries (non-2xx response or timeout) are retried with exponential backoff:
- Attempt 1: immediately
- Attempt 2: 1 minute later
- Attempt 3: 5 minutes later
- Attempt 4: 30 minutes later
- Attempt 5: 2 hours later

After 5 failed attempts, the delivery is marked `failed`. The webhook remains active for future events.

## Delivery log

**Settings → Webhooks → [webhook] → Deliveries**: view every delivery attempt with status, response code, and response body. Useful for debugging failed integrations.

## Disabling a webhook

Toggle the webhook off in **Settings → Webhooks → [webhook] → Disable**. Disabled webhooks receive no deliveries. Re-enable at any time.

## SSE (server-sent events)

In addition to webhooks, Ascend exposes a real-time SSE stream at `/api/v1/stream` for in-app UI subscriptions. This is used internally by the Ascend frontend (notifications bell, loyalty tier upgrade toasts, low-stock alerts). External clients can also subscribe with a valid JWT.
