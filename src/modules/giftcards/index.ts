import type { PosModule } from "../types.js";
import { GiftCardsService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_GIFT_CARDS_TABLE = `
CREATE TABLE IF NOT EXISTS gift_cards (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  code          TEXT NOT NULL,
  initial_cents BIGINT NOT NULL,
  balance_cents BIGINT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  UNIQUE (tenant_id, code)
);
`;

const CREATE_GIFT_CARDS_INDEXES = `
CREATE INDEX IF NOT EXISTS gift_cards_tenant_status_idx ON gift_cards (tenant_id, status, created_at DESC);
`;

/** Gift cards — tenant-scoped stored-value cards (issue / balance / redeem). */
export const giftcardsModule: PosModule = {
  name: "giftcards",
  migrations: [CREATE_GIFT_CARDS_TABLE, CREATE_GIFT_CARDS_INDEXES],
  async register({ db, events, router }) {
    const service = new GiftCardsService(db, events);
    registerRoutes(router, service);
  },
};

export { GiftCardsService } from "./service.js";
export type { GiftCard, GiftCardStatus } from "./service.js";
