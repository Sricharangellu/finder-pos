import type { PosModule } from "../types.js";
import { ReportsService } from "./service.js";
import { registerRoutes } from "./routes.js";

// Analytics pre-aggregation tables for background job population.
const CREATE_ANALYTICS_TABLES = `
CREATE TABLE IF NOT EXISTS daily_sales_summary (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL,
  outlet_id            TEXT,
  summary_date         TEXT NOT NULL,
  gross_sales_cents    BIGINT NOT NULL DEFAULT 0,
  discount_cents       BIGINT NOT NULL DEFAULT 0,
  net_sales_cents      BIGINT NOT NULL DEFAULT 0,
  tax_cents            BIGINT NOT NULL DEFAULT 0,
  refund_cents         BIGINT NOT NULL DEFAULT 0,
  payment_cents        BIGINT NOT NULL DEFAULT 0,
  transaction_count    INTEGER NOT NULL DEFAULT 0,
  avg_order_cents      BIGINT NOT NULL DEFAULT 0,
  created_at           BIGINT NOT NULL,
  updated_at           BIGINT NOT NULL,
  CONSTRAINT daily_sales_summary_unique UNIQUE (tenant_id, outlet_id, summary_date)
);
CREATE INDEX IF NOT EXISTS daily_sales_summary_tenant_date_idx ON daily_sales_summary (tenant_id, summary_date DESC);

CREATE TABLE IF NOT EXISTS product_sales_summary (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  product_id        TEXT NOT NULL,
  outlet_id         TEXT,
  period_start      TEXT NOT NULL,
  period_end        TEXT NOT NULL,
  period_type       TEXT NOT NULL DEFAULT 'daily',
  quantity_sold     INTEGER NOT NULL DEFAULT 0,
  gross_sales_cents BIGINT NOT NULL DEFAULT 0,
  discount_cents    BIGINT NOT NULL DEFAULT 0,
  net_sales_cents   BIGINT NOT NULL DEFAULT 0,
  cost_cents        BIGINT NOT NULL DEFAULT 0,
  gross_profit_cents BIGINT NOT NULL DEFAULT 0,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL,
  CONSTRAINT product_sales_summary_unique UNIQUE (tenant_id, product_id, outlet_id, period_start, period_type)
);
CREATE INDEX IF NOT EXISTS product_sales_summary_tenant_idx ON product_sales_summary (tenant_id, period_start DESC);

CREATE TABLE IF NOT EXISTS fiscal_periods (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  period_name TEXT NOT NULL,
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  closed_by   TEXT,
  closed_at   BIGINT,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_periods_tenant_name_idx ON fiscal_periods (tenant_id, period_name);
`;

/**
 * Reports — a read-only analytics bounded context. It reads
 * the orders + payments tables (shared schema) as a CQRS-lite read model and is
 * always tenant-scoped. Also owns pre-aggregation summary tables.
 */
export const reportsModule: PosModule = {
  name: "reports",
  migrations: [CREATE_ANALYTICS_TABLES],
  async register({ db, router }) {
    const service = new ReportsService(db);
    registerRoutes(router, service);
  },
};

export { ReportsService } from "./service.js";
export type { SalesSummary } from "./service.js";
