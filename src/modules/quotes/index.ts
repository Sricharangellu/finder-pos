import type { PosModule } from "../types.js";
import { QuotesService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_QUOTES_TABLE = `
CREATE TABLE IF NOT EXISTS quotations (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL,
  outlet_id             TEXT,
  customer_id           TEXT,
  quote_number          TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'draft',
  currency              TEXT NOT NULL DEFAULT 'USD',
  subtotal_cents        BIGINT NOT NULL DEFAULT 0,
  discount_cents        BIGINT NOT NULL DEFAULT 0,
  tax_cents             BIGINT NOT NULL DEFAULT 0,
  total_cents           BIGINT NOT NULL DEFAULT 0,
  valid_until           BIGINT,
  notes                 TEXT,
  converted_order_id    TEXT,
  created_by            TEXT,
  created_at            BIGINT NOT NULL,
  updated_at            BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS quotations_tenant_idx ON quotations (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS quotations_customer_idx ON quotations (tenant_id, customer_id) WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS quotation_lines (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  quote_id      TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL,
  sku           TEXT NOT NULL DEFAULT '',
  name          TEXT NOT NULL,
  quantity      INTEGER NOT NULL,
  unit_cents    BIGINT NOT NULL,
  discount_cents BIGINT NOT NULL DEFAULT 0,
  tax_cents     BIGINT NOT NULL DEFAULT 0,
  line_cents    BIGINT NOT NULL,
  created_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS quotation_lines_quote_idx ON quotation_lines (tenant_id, quote_id);
`;

export const quotesModule: PosModule = {
  name: "quotes",
  migrations: [CREATE_QUOTES_TABLE],
  register({ db, router }) {
    registerRoutes(router, new QuotesService(db));
  },
};

export { QuotesService } from "./service.js";
