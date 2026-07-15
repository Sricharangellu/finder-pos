import type { PosModule } from "../types.js";
import { QuotesService } from "./service.js";
import { QuotesRepository } from "./quotes.repository.js";
import { registerRoutes } from "./routes.js";

// NOTE: named "quote_headers", not "quotations" — the sales module already owns
// a table literally named "quotations" with an incompatible schema (no
// outlet_id/currency/notes/converted_order_id). Both modules did
// `CREATE TABLE IF NOT EXISTS quotations`; since sales registers first in
// modules/index.ts, this module silently ran against sales' schema and every
// query failed on a missing column. Distinct table name closes that collision.
const CREATE_QUOTATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS quote_headers (
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
CREATE INDEX IF NOT EXISTS quote_headers_tenant_idx ON quote_headers (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS quote_headers_customer_idx ON quote_headers (tenant_id, customer_id) WHERE customer_id IS NOT NULL;
`;

const CREATE_QUOTATION_LINES_TABLE = `
CREATE TABLE IF NOT EXISTS quote_lines (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  quote_id       TEXT NOT NULL REFERENCES quote_headers(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS quote_lines_quote_idx ON quote_lines (tenant_id, quote_id);
`;

export const quotesModule: PosModule = {
  name: "quotes",
  migrations: [CREATE_QUOTATIONS_TABLE, CREATE_QUOTATIONS_INDEXES, CREATE_QUOTATION_LINES_TABLE, CREATE_QUOTATION_LINES_INDEX],
  register({ db, events, router }) {
    registerRoutes(router, new QuotesService(new QuotesRepository(db), events));
  },
};

export { QuotesService } from "./service.js";
