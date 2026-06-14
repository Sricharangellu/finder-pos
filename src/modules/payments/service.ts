import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { Money, type Cents } from "../../shared/money.js";
import { notFound, badRequest, conflict } from "../../shared/http.js";

export type PaymentMethod = "cash" | "card" | "split";
export type PaymentStatus = "captured" | "declined";

export interface PaymentRecord {
  id: string;
  tenant_id: string;
  order_id: string;
  method: PaymentMethod;
  amount_cents: Cents;
  cash_cents: Cents;
  card_cents: Cents;
  change_cents: Cents;
  card_last4: string | null;
  auth_code: string | null;
  status: PaymentStatus;
  created_at: number;
}

export interface CapturePaymentInput {
  orderId: string;
  method: PaymentMethod;
  cashCents?: Cents;
  cardCents?: Cents;
  tenderedCents?: Cents;
  /** Idempotency key: a retried capture with the same key returns the cached result without re-charging. */
  idempotencyKey?: string;
}

interface OrderRow {
  total_cents: number;
  status: string;
}

const CLOSED_ORDER_STATUSES = new Set(["completed", "refunded", "voided", "paid"]);

function simulateCardRead(): { last4: string; authCode: string } {
  const last4 = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  const token = uuidv7().replace(/-/g, "").slice(0, 12).toUpperCase();
  return { last4, authCode: `EMV-${token}` };
}

/**
 * Stable fingerprint of the meaningful capture inputs (everything that affects
 * the charge except the idempotency key itself). Reusing a key with a request
 * whose fingerprint differs is a client error, not a safe retry.
 */
function captureFingerprint(input: CapturePaymentInput): string {
  const canonical = JSON.stringify({
    orderId: input.orderId,
    method: input.method,
    cashCents: input.cashCents ?? 0,
    cardCents: input.cardCents ?? 0,
    tenderedCents: input.tenderedCents ?? 0,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Shape persisted in idempotency_keys.response. */
interface IdempotencyEnvelope {
  fingerprint: string;
  record: PaymentRecord;
}

function isEnvelope(value: unknown): value is IdempotencyEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { fingerprint?: unknown }).fingerprint === "string" &&
    typeof (value as { record?: unknown }).record === "object"
  );
}

export class PaymentsService {
  constructor(
    private readonly db: DB,
    private readonly events: EventBus,
  ) {}

  /** Resolve the amount owed from the orders table, enforcing existence/status and tenant. */
  private async loadOrderOwed(orderId: string, tenantId: string): Promise<Cents> {
    const order = await this.db.one<OrderRow>(
      "SELECT total_cents, status FROM orders WHERE id = @id AND tenant_id = @tenantId",
      { id: orderId, tenantId },
    );
    if (!order) {
      throw notFound(`order ${orderId} not found`);
    }
    if (CLOSED_ORDER_STATUSES.has(order.status)) {
      throw conflict(`order ${orderId} is ${order.status} and cannot be paid`);
    }
    return order.total_cents;
  }

  async capture(input: CapturePaymentInput, tenantId: string): Promise<PaymentRecord> {
    // Payment idempotency: if a key is provided and we already processed it,
    // return the cached result without re-charging (Wave 1 requirement). The
    // stored response is fingerprinted with the original request, so a key
    // replayed with a DIFFERENT request (e.g. another order or amount) is
    // rejected rather than silently served the wrong payment.
    const fingerprint = input.idempotencyKey ? captureFingerprint(input) : undefined;
    if (input.idempotencyKey) {
      const existing = await this.db.one<{ response: string }>(
        "SELECT response FROM idempotency_keys WHERE tenant_id = @tenantId AND key = @key",
        { tenantId, key: input.idempotencyKey },
      );
      if (existing) {
        const parsed = JSON.parse(existing.response) as unknown;
        if (isEnvelope(parsed)) {
          if (parsed.fingerprint !== fingerprint) {
            throw conflict(
              `idempotency key '${input.idempotencyKey}' was already used with a different request`,
            );
          }
          return parsed.record;
        }
        // Legacy rows stored the bare PaymentRecord (pre-fingerprint); honor
        // them as a safe replay rather than failing.
        return parsed as PaymentRecord;
      }
    }

    const owed = await this.loadOrderOwed(input.orderId, tenantId);

    let cashCents = 0;
    let cardCents = 0;
    let changeCents = 0;
    let cardLast4: string | null = null;
    let authCode: string | null = null;
    const status: PaymentStatus = "captured";

    switch (input.method) {
      case "cash": {
        const tendered = input.tenderedCents ?? 0;
        if (tendered < owed) {
          throw badRequest(`insufficient cash: tendered ${tendered} < owed ${owed}`);
        }
        cashCents = tendered;
        changeCents = Money.sub(tendered, owed);
        break;
      }

      case "card": {
        if (owed <= 0) {
          throw badRequest(`cannot charge card for non-positive amount ${owed}`);
        }
        const { last4, authCode: code } = simulateCardRead();
        cardCents = owed;
        cardLast4 = last4;
        authCode = code;
        break;
      }

      case "split": {
        const cash = input.cashCents ?? 0;
        const card = input.cardCents ?? 0;
        if (cash < 0 || card < 0) {
          throw badRequest("split amounts must be non-negative");
        }
        const total = Money.add(cash, card);
        if (total < owed) {
          throw badRequest(`split tender ${total} is less than owed ${owed}`);
        }
        if (card > owed) {
          throw badRequest(
            `card tender ${card} exceeds owed ${owed}; change is returned as cash only`,
          );
        }
        changeCents = Money.sub(total, owed);
        cashCents = cash;
        cardCents = card;
        if (card > 0) {
          const { last4, authCode: code } = simulateCardRead();
          cardLast4 = last4;
          authCode = code;
        }
        break;
      }

      default: {
        const exhaustive: never = input.method;
        throw badRequest(`unsupported payment method ${String(exhaustive)}`);
      }
    }

    const record: PaymentRecord = {
      id: `pay_${uuidv7()}`,
      tenant_id: tenantId,
      order_id: input.orderId,
      method: input.method,
      amount_cents: owed,
      cash_cents: cashCents,
      card_cents: cardCents,
      change_cents: changeCents,
      card_last4: cardLast4,
      auth_code: authCode,
      status,
      created_at: Date.now(),
    };

    await this.db.query(
      `INSERT INTO payments
         (id, tenant_id, order_id, method, amount_cents, cash_cents, card_cents,
          change_cents, card_last4, auth_code, status, created_at)
       VALUES
         (@id, @tenant_id, @order_id, @method, @amount_cents, @cash_cents, @card_cents,
          @change_cents, @card_last4, @auth_code, @status, @created_at)`,
      record as unknown as Record<string, unknown>,
    );

    // Store the idempotency key so retries return the same record.
    if (input.idempotencyKey && fingerprint) {
      const now = Date.now();
      await this.db.query(
        `INSERT INTO idempotency_keys (id, tenant_id, key, response, created_at, expires_at)
         VALUES (@id, @tenantId, @key, @response, @created_at, @expires_at)
         ON CONFLICT (tenant_id, key) DO NOTHING`,
        {
          id: `idk_${uuidv7()}`,
          tenantId,
          key: input.idempotencyKey,
          response: JSON.stringify({ fingerprint, record } satisfies IdempotencyEnvelope),
          created_at: now,
          expires_at: now + 24 * 60 * 60 * 1000, // 24h TTL
        },
      );
    }

    await this.events.publish(
      "payment.captured",
      {
        id: record.id,
        tenantId,
        orderId: record.order_id,
        method: record.method,
        amountCents: record.amount_cents,
        changeCents: record.change_cents,
      },
      record.id,
    );

    return record;
  }

  async get(id: string, tenantId: string): Promise<PaymentRecord> {
    const row = await this.db.one<PaymentRecord>(
      "SELECT * FROM payments WHERE id = @id AND tenant_id = @tenantId",
      { id, tenantId },
    );
    if (!row) {
      throw notFound(`payment ${id} not found`);
    }
    return row;
  }

  async listByOrder(orderId: string, tenantId: string): Promise<PaymentRecord[]> {
    return this.db.query<PaymentRecord>(
      "SELECT * FROM payments WHERE order_id = @orderId AND tenant_id = @tenantId ORDER BY created_at ASC",
      { orderId, tenantId },
    );
  }
}
