import type { PosModule } from "../types.js";
import { SalesService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_QUOTATIONS = `
CREATE TABLE IF NOT EXISTS quotations (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  quote_number   TEXT NOT NULL,
  customer_id    TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft',
  subtotal_cents BIGINT NOT NULL,
  discount_cents BIGINT NOT NULL DEFAULT 0,
  total_cents    BIGINT NOT NULL,
  sales_rep_id   TEXT,
  store_id       TEXT,
  valid_until    BIGINT,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL,
  UNIQUE (tenant_id, quote_number)
);`;

const CREATE_QUOTATION_LINES = `
CREATE TABLE IF NOT EXISTS quotation_lines (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  quotation_id  TEXT NOT NULL,
  product_id    TEXT NOT NULL,
  name          TEXT NOT NULL,
  quantity      INTEGER NOT NULL,
  unit_cents    BIGINT NOT NULL,
  line_cents    BIGINT NOT NULL
);`;

const CREATE_SALES_ORDERS = `
CREATE TABLE IF NOT EXISTS sales_orders (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  so_number      TEXT NOT NULL,
  quotation_id   TEXT,
  customer_id    TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending_approve',
  subtotal_cents BIGINT NOT NULL,
  discount_cents BIGINT NOT NULL DEFAULT 0,
  total_cents    BIGINT NOT NULL,
  sales_rep_id   TEXT,
  picker_id      TEXT,
  store_id       TEXT,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL,
  UNIQUE (tenant_id, so_number)
);`;

const CREATE_SO_LINES = `
CREATE TABLE IF NOT EXISTS sales_order_lines (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  sales_order_id  TEXT NOT NULL,
  product_id      TEXT NOT NULL,
  name            TEXT NOT NULL,
  quantity        INTEGER NOT NULL,
  unit_cents      BIGINT NOT NULL,
  line_cents      BIGINT NOT NULL
);`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS quotations_tenant_status_idx ON quotations (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS quotation_lines_parent_idx ON quotation_lines (tenant_id, quotation_id);
CREATE INDEX IF NOT EXISTS sales_orders_tenant_status_idx ON sales_orders (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_orders_rep_idx ON sales_orders (tenant_id, sales_rep_id);
CREATE INDEX IF NOT EXISTS sales_orders_picker_idx ON sales_orders (tenant_id, picker_id);
CREATE UNIQUE INDEX IF NOT EXISTS sales_orders_quote_uidx ON sales_orders (tenant_id, quotation_id) WHERE quotation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS so_lines_parent_idx ON sales_order_lines (tenant_id, sales_order_id);`;

// Tier (1=best price .. 5=list) added here so the sales module can resolve
// tier-aware pricing without a hard dependency on the customers module's DDL.
const ADD_CUSTOMER_TIER = `ALTER TABLE customers ADD COLUMN IF NOT EXISTS tier INTEGER NOT NULL DEFAULT 5;`;

/** Sales — quotations + sales orders (B2B order-to-cash front half). */
export const salesModule: PosModule = {
  name: "sales",
  migrations: [CREATE_QUOTATIONS, CREATE_QUOTATION_LINES, CREATE_SALES_ORDERS, CREATE_SO_LINES, INDEXES, ADD_CUSTOMER_TIER],
  register({ db, events, router }) {
    registerRoutes(router, new SalesService(db, events));
  },
};

export { SalesService } from "./service.js";
export type { Quotation, SalesOrder, SalesLine, QuoteStatus, SOStatus } from "./service.js";
