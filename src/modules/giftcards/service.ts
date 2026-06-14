import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { HttpError } from "../../shared/http.js";

/** Gift cards. Tenant-scoped, integer-cents balances. A card is issued with a
 *  unique human-friendly code and drawn down via redeem until the balance hits 0. */

export type GiftCardStatus = "active" | "redeemed" | "void";

export interface GiftCard {
  id: string;
  tenant_id: string;
  code: string;
  initial_cents: number;
  balance_cents: number;
  status: GiftCardStatus;
  created_at: number;
  updated_at: number;
}

function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  const block = () =>
    Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `GC-${block()}-${block()}-${block()}`;
}

export class GiftCardsService {
  constructor(
    private readonly db: DB,
    private readonly events: EventBus,
  ) {}

  /** Issue a new gift card for `amountCents`. Retries on the (rare) code collision. */
  async issue(amountCents: number, tenantId: string): Promise<GiftCard> {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new HttpError(400, "bad_request", "amountCents must be a positive integer");
    }
    const now = Date.now();
    for (let attempt = 0; attempt < 5; attempt++) {
      const card: GiftCard = {
        id: `gft_${uuidv7()}`,
        tenant_id: tenantId,
        code: randomCode(),
        initial_cents: amountCents,
        balance_cents: amountCents,
        status: "active",
        created_at: now,
        updated_at: now,
      };
      try {
        await this.db.query(
          `INSERT INTO gift_cards (id, tenant_id, code, initial_cents, balance_cents, status, created_at, updated_at)
           VALUES (@id, @tenant_id, @code, @initial_cents, @balance_cents, @status, @created_at, @updated_at)`,
          card as unknown as Record<string, unknown>,
        );
        await this.events.publish(
          "gift_card.issued",
          { id: card.id, tenantId, code: card.code, amountCents },
          card.id,
        );
        return card;
      } catch (err) {
        if ((err as { code?: string }).code === "23505") continue; // unique code collision — retry
        throw err;
      }
    }
    throw new HttpError(500, "code_generation_failed", "could not allocate a unique gift card code");
  }

  async getByCode(code: string, tenantId: string): Promise<GiftCard | undefined> {
    return this.db.one<GiftCard>(
      "SELECT * FROM gift_cards WHERE code = @code AND tenant_id = @tenantId",
      { code, tenantId },
    );
  }

  /** Draw down a card by `amountCents`. Never goes negative; flips to 'redeemed' at 0. */
  async redeem(
    code: string,
    amountCents: number,
    tenantId: string,
  ): Promise<{ code: string; redeemedCents: number; balanceCents: number; status: GiftCardStatus }> {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new HttpError(400, "bad_request", "amountCents must be a positive integer");
    }
    // Mutate atomically under a row lock inside the tx, then publish the domain
    // event AFTER the tx commits. The sync outbox (events.onAny) writes via the
    // shared pool, so publishing while the tx still holds the only pooled
    // connection (PG_POOL_MAX=1) would deadlock. This mirrors orders/payments.
    const { card, balance, status } = await this.db.tx(async (tdb) => {
      const card = await tdb.one<GiftCard>(
        "SELECT * FROM gift_cards WHERE code = @code AND tenant_id = @tenantId FOR UPDATE",
        { code, tenantId },
      );
      if (!card) throw new HttpError(404, "not_found", `gift card '${code}' not found`);
      if (card.status === "void") throw new HttpError(409, "card_void", "gift card is void");
      if (card.balance_cents < amountCents) {
        throw new HttpError(400, "insufficient_balance", `balance ${card.balance_cents} < requested ${amountCents}`);
      }
      const balance = card.balance_cents - amountCents;
      const status: GiftCardStatus = balance === 0 ? "redeemed" : "active";
      await tdb.query(
        "UPDATE gift_cards SET balance_cents = @balance, status = @status, updated_at = @now WHERE id = @id AND tenant_id = @tenantId",
        { balance, status, now: Date.now(), id: card.id, tenantId },
      );
      return { card, balance, status };
    });

    await this.events.publish(
      "gift_card.redeemed",
      { id: card.id, tenantId, code, amountCents, balanceCents: balance },
      card.id,
    );
    return { code, redeemedCents: amountCents, balanceCents: balance, status };
  }
}
