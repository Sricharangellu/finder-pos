import { v7 as uuidv7 } from "uuid";
import { createHmac, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import type { DB } from "../../shared/db.js";
import type { DomainEvent } from "../../shared/types.js";
import { HttpError } from "../../shared/http.js";

/** Outbound webhooks (public API). Tenant-scoped subscriptions receive signed
 *  POSTs when subscribed domain events fire. Signature = HMAC-SHA256(secret, body)
 *  in the `X-Finder-Signature: sha256=<hex>` header. */

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

export interface WebhookDelivery {
  id: string;
  tenant_id: string;
  subscription_id: string;
  event_type: string;
  status: string;
  status_code: number;
  attempt_count: number;
  last_response_body: string | null;
  created_at: number;
}

export interface CreateSubscriptionInput {
  url: string;
  eventTypes?: string[]; // omit/empty => all events
  secret?: string;
}

export function signPayload(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * DB-16: Application-level AES-256-GCM encryption for webhook secrets.
 *
 * Stored format: "v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 * Key: WEBHOOK_SECRET_KEY env var (32 random bytes, hex-encoded = 64 chars).
 * If the env var is not set, secrets are stored plaintext (backwards-compat).
 */
const ALGO = "aes-256-gcm" as const;

function getEncryptionKey(): Buffer | null {
  const key = process.env["WEBHOOK_SECRET_KEY"];
  if (!key || key.length < 64) return null;
  return Buffer.from(key.slice(0, 64), "hex");
}

export function encryptSecret(plain: string): string {
  const key = getEncryptionKey();
  if (!key) return plain; // no key configured — store plaintext (dev only)
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith("v1:")) return stored; // plaintext fallback
  const key = getEncryptionKey();
  if (!key) return stored; // can't decrypt without key — return as-is
  const [, ivHex, tagHex, ctHex] = stored.split(":");
  if (!ivHex || !tagHex || !ctHex) return stored;
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(ctHex, "hex")).toString("utf8") + decipher.final("utf8");
}

// Exponential backoff delays (ms) for retries 1-5.
// Capped at 60s so background promises don't linger in serverless environments.
// BE-34 (BullMQ job queue) will replace this with durable persistent retries.
const RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1; // 6 total: 1 initial + 5 retries

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    // DB-16: Encrypt secret at rest before storing.
    const storedSecret = encryptSecret(sub.secret);
    await this.db.query(
      `INSERT INTO webhook_subscriptions (id, tenant_id, url, event_types, secret, active, created_at, updated_at)
       VALUES (@id, @tenant_id, @url, @event_types, @secret, @active, @created_at, @updated_at)`,
      { ...sub, secret: storedSecret } as unknown as Record<string, unknown>,
    );
    return sub; // return plaintext secret to caller on create (they need it to verify)
  }

  async list(tenantId: string): Promise<WebhookSubscription[]> {
    return this.db.query<WebhookSubscription>(
      "SELECT * FROM webhook_subscriptions WHERE tenant_id = @tenantId ORDER BY created_at DESC",
      { tenantId },
    );
  }

  async toggle(id: string, tenantId: string, active: boolean): Promise<WebhookSubscription> {
    const row = await this.db.one<WebhookSubscription>(
      "SELECT * FROM webhook_subscriptions WHERE id = @id AND tenant_id = @tenantId",
      { id, tenantId },
    );
    if (!row) throw new HttpError(404, "not_found", `webhook '${id}' not found`);
    const now = Date.now();
    await this.db.query(
      "UPDATE webhook_subscriptions SET active = @active, updated_at = @now WHERE id = @id AND tenant_id = @tenantId",
      { active, now, id, tenantId },
    );
    return { ...row, active, updated_at: now };
  }

  async remove(id: string, tenantId: string): Promise<boolean> {
    const rows = await this.db.query(
      "DELETE FROM webhook_subscriptions WHERE id = @id AND tenant_id = @tenantId RETURNING id",
      { id, tenantId },
    );
    return rows.length > 0;
  }

  async deliveries(tenantId: string, limit = 50, offset = 0): Promise<WebhookDelivery[]> {
    const cappedLimit = Math.min(limit > 0 ? limit : 50, 200);
    const safeOffset = offset > 0 ? offset : 0;
    return this.db.query<WebhookDelivery>(
      "SELECT * FROM webhook_deliveries WHERE tenant_id = @tenantId ORDER BY created_at DESC LIMIT @limit OFFSET @offset",
      { tenantId, limit: cappedLimit, offset: safeOffset },
    );
  }

  private matches(sub: WebhookSubscription, type: string): boolean {
    if (sub.event_types === "*") return true;
    return sub.event_types.split(",").includes(type);
  }

  /** Deliver an event to all matching active subscriptions with exponential backoff retries. */
  async deliverForEvent(event: DomainEvent<unknown>): Promise<void> {
    const tenantId = (event.payload as { tenantId?: string })?.tenantId;
    if (!tenantId) return;
    const subs = await this.db.query<WebhookSubscription>(
      "SELECT * FROM webhook_subscriptions WHERE tenant_id = @tenantId AND active = TRUE",
      { tenantId },
    );
    await Promise.all(
      subs.filter((s) => this.matches(s, event.type)).map((s) => this.deliverWithRetry(s, event)),
    );
  }

  /** POST signed payload with up to MAX_ATTEMPTS total attempts (1 initial + 5 retries).
   *  One delivery row is created upfront and updated on each attempt. */
  async deliverWithRetry(sub: WebhookSubscription, event: DomainEvent<unknown>): Promise<void> {
    const body = JSON.stringify({
      id: event.aggregateId,
      type: event.type,
      ts: event.occurredAt,
      payload: event.payload,
    });
    const signature = signPayload(decryptSecret(sub.secret), body);
    const deliveryId = `whd_${uuidv7()}`;

    await this.db.query(
      `INSERT INTO webhook_deliveries (id, tenant_id, subscription_id, event_type, status, status_code, attempt_count, last_response_body, created_at)
       VALUES (@id, @tenant_id, @subscription_id, @event_type, 'pending', 0, 0, NULL, @created_at)`,
      {
        id: deliveryId,
        tenant_id: sub.tenant_id,
        subscription_id: sub.id,
        event_type: event.type,
        created_at: Date.now(),
      },
    );

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { statusCode, responseBody, success } = await this.attemptPost(sub.url, body, signature);
      const status = success ? "delivered" : attempt >= MAX_ATTEMPTS ? "failed" : "retrying";

      await this.db.query(
        `UPDATE webhook_deliveries
         SET status = @status, status_code = @statusCode, attempt_count = @attempt, last_response_body = @responseBody
         WHERE id = @id`,
        { status, statusCode, attempt, responseBody, id: deliveryId },
      );

      if (success) return;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 60_000);
      }
    }
  }

  /** Single HTTP attempt. Returns success=true if the server responds with 2xx. */
  private async attemptPost(
    url: string,
    body: string,
    signature: string,
  ): Promise<{ statusCode: number; responseBody: string | null; success: boolean }> {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10_000);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-finder-event": "webhook",
          "x-finder-signature": signature,
        },
        body,
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const responseBody = await res.text().catch(() => null);
      return { statusCode: res.status, responseBody: responseBody?.slice(0, 500) ?? null, success: res.ok };
    } catch {
      return { statusCode: 0, responseBody: null, success: false };
    }
  }

  /** Legacy single-attempt deliver() — kept for backwards compatibility in tests. */
  async deliver(sub: WebhookSubscription, event: DomainEvent<unknown>): Promise<number> {
    const body = JSON.stringify({ id: event.aggregateId, type: event.type, ts: event.occurredAt, payload: event.payload });
    const signature = signPayload(decryptSecret(sub.secret), body);
    const { statusCode, responseBody, success } = await this.attemptPost(sub.url, body, signature);
    await this.db.query(
      `INSERT INTO webhook_deliveries (id, tenant_id, subscription_id, event_type, status, status_code, attempt_count, last_response_body, created_at)
       VALUES (@id, @tenant_id, @subscription_id, @event_type, @status, @statusCode, 1, @responseBody, @created_at)`,
      {
        id: `whd_${uuidv7()}`,
        tenant_id: sub.tenant_id,
        subscription_id: sub.id,
        event_type: event.type,
        status: success ? "delivered" : "failed",
        statusCode,
        responseBody: responseBody?.slice(0, 500) ?? null,
        created_at: Date.now(),
      },
    );
    return statusCode;
  }
}
