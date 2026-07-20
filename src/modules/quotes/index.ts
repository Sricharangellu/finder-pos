import type { PosModule } from "../types.js";
import { QuotesService } from "./service.js";
import { registerRoutes } from "./routes.js";

// Named customer_quotations (NOT quotations) — the sales module already owns
// a table literally called quotations (B2B quote-to-order front half,
// sales_rep_id/store_id-keyed). A same-name CREATE TABLE IF NOT EXISTS here
// previously lost the race (sales registers before quotes in
// modules/index.ts), so every insert here silently ran against sales'
// incompatible column set and 500'd with "column outlet_id does not exist"
// on every call. No data migration needed: nothing had shipped against the
// collided name (every insert failed).
const CREATE_QUOTATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS customer_quotations (
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
`;

const CREATE_QUOTATIONS_INDEXES = `
CREATE INDEX IF NOT EXISTS customer_quotations_tenant_idx ON customer_quotations (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_quotations_customer_idx ON customer_quotations (tenant_id, customer_id) WHERE customer_id IS NOT NULL;
`;

const CREATE_QUOTATION_LINES_TABLE = `
CREATE TABLE IF NOT EXISTS customer_quotation_lines (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  quote_id       TEXT NOT NULL REFERENCES customer_quotations(id) ON DELETE CASCADE,
  product_id     TEXT NOT NULL,
  sku            TEXT NOT NULL DEFAULT '',
  name           TEXT NOT NULL,
  quantity       INTEGER NOT NULL,
  unit_cents     BIGINT NOT NULL,
  discount_cents BIGINT NOT NULL DEFAULT 0,
  tax_cents      BIGINT NOT NULL DEFAULT 0,
  line_cents     BIGINT NOT NULL,
  created_at     BIGINT NOT NULL
);
`;

const CREATE_QUOTATION_LINES_INDEX = `
CREATE INDEX IF NOT EXISTS customer_quotation_lines_quote_idx ON customer_quotation_lines (tenant_id, quote_id);
`;

export const quotesModule: PosModule = {
  name: "quotes",
  migrations: [CREATE_QUOTATIONS_TABLE, CREATE_QUOTATIONS_INDEXES, CREATE_QUOTATION_LINES_TABLE, CREATE_QUOTATION_LINES_INDEX],
  register({ db, router }) {
    registerRoutes(router, new QuotesService(db));
  },
};

export { QuotesService } from "./service.js";
