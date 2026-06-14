import { v7 as uuidv7 } from "uuid";
import { createHmac, randomBytes } from "node:crypto";
import type { DB } from "../../shared/db.js";
import type { DomainEvent } from "../../shared/types.js";
import { HttpError } from "../../shared/http.js";

/** Outbound webhooks (public API). Tenant-scoped subscriptions receive signed
 *  POSTs when subscribed domain events fire. Signature = HMAC-SHA256(secret, body)
 *  in the `X-Finder-Signature: sha256=<hex>` header. Delivery is best-effort. */

export interface WebhookSubscription {
  id: string;
  tenant_id: string;
  url: string;
  event_types: string; // CSV of event types, or '*' for all
  secret: string;
  active: boolean;
  created_at: number;
  updated_at: number;
}

export interface CreateSubscriptionInput {
  url: string;
  eventTypes?: string[]; // omit/empty => all events
  secret?: string;
}

export function signPayload(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

export class WebhooksService {
  constructor(private readonly db: DB) {}

  async subscribe(input: CreateSubscriptionInput, tenantId: string): Promise<WebhookSubscription> {
    if (!/^https?:\/\//.test(input.url)) {
      throw new HttpError(400, "bad_request", "url must be an http(s) URL");
    }
    const now = Date.now();
    const sub: WebhookSubscription = {
      id: `whk_${uuidv7()}`,
      tenant_id: tenantId,
      url: input.url,
      event_types: input.eventTypes && input.eventTypes.length > 0 ? input.eventTypes.join(",") : "*",
      secret: input.secret ?? randomBytes(24).toString("hex"),
      active: true,
      created_at: now,
      updated_at: now,
    };
    await this.db.query(
      `INSERT INTO webhook_subscriptions (id, tenant_id, url, event_types, secret, active, created_at, updated_at)
       VALUES (@id, @tenant_id, @url, @event_types, @secret, @active, @created_at, @updated_at)`,
      sub as unknown as Record<string, unknown>,
    );
    return sub;
  }

  async list(tenantId: string): Promise<WebhookSubscription[]> {
    return this.db.query<WebhookSubscription>(
      "SELECT * FROM webhook_subscriptions WHERE tenant_id = @tenantId ORDER BY created_at DESC",
      { tenantId },
    );
  }

  async remove(id: string, tenantId: string): Promise<boolean> {
    const rows = await this.db.query(
      "DELETE FROM webhook_subscriptions WHERE id = @id AND tenant_id = @tenantId RETURNING id",
      { id, tenantId },
    );
    return rows.length > 0;
  }

  async deliveries(tenantId: string, limit = 50): Promise<unknown[]> {
    return this.db.query(
      "SELECT * FROM webhook_deliveries WHERE tenant_id = @tenantId ORDER BY created_at DESC LIMIT @limit",
      { tenantId, limit },
    );
  }

  /** Whether a subscription is interested in an event type. */
  private matches(sub: WebhookSubscription, type: string): boolean {
    if (sub.event_types === "*") return true;
    return sub.event_types.split(",").includes(type);
  }

  /** Deliver an event to all matching active subscriptions for its tenant.
   *  Awaitable (tests call it directly); the onAny handler fires it best-effort. */
  async deliverForEvent(event: DomainEvent<unknown>): Promise<void> {
    const tenantId = (event.payload as { tenantId?: string })?.tenantId;
    if (!tenantId) return;
    const subs = await this.db.query<WebhookSubscription>(
      "SELECT * FROM webhook_subscriptions WHERE tenant_id = @tenantId AND active = TRUE",
      { tenantId },
    );
    await Promise.all(
      subs.filter((s) => this.matches(s, event.type)).map((s) => this.deliver(s, event)),
    );
  }

  /** POST a signed payload to one subscription; record the attempt. */
  async deliver(sub: WebhookSubscription, event: DomainEvent<unknown>): Promise<number> {
    const body = JSON.stringify({ id: event.aggregateId, type: event.type, ts: event.occurredAt, payload: event.payload });
    const signature = signPayload(sub.secret, body);
    let status = "failed";
    let statusCode = 0;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(sub.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-finder-event": event.type,
          "x-finder-signature": signature,
        },
        body,
        signal: ctrl.signal,
      });
      clearTimeout(t);
      statusCode = res.status;
      status = res.ok ? "delivered" : "failed";
    } catch {
      status = "failed";
    }
    await this.db.query(
      `INSERT INTO webhook_deliveries (id, tenant_id, subscription_id, event_type, status, status_code, created_at)
       VALUES (@id, @tenant_id, @subscription_id, @event_type, @status, @status_code, @created_at)`,
      {
        id: `whd_${uuidv7()}`,
        tenant_id: sub.tenant_id,
        subscription_id: sub.id,
        event_type: event.type,
        status,
        status_code: statusCode,
        created_at: Date.now(),
      },
    );
    return statusCode;
  }
}
