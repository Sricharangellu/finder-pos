import type { PosModule } from "../types.js";
import { InsightsService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_SCHEDULED_REPORTS = `
CREATE TABLE IF NOT EXISTS scheduled_reports (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  report_type      TEXT NOT NULL,
  frequency        TEXT NOT NULL,
  recipient_emails TEXT NOT NULL DEFAULT '[]',
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  last_sent_at     BIGINT,
  next_send_at     BIGINT NOT NULL,
  created_at       BIGINT NOT NULL,
  updated_at       BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS scheduled_reports_tenant_idx
  ON scheduled_reports (tenant_id, enabled, next_send_at ASC);
`;

const ADD_PRODUCT_FORECAST_COLUMNS = `
ALTER TABLE products ADD COLUMN IF NOT EXISTS reorder_point  INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS lead_time_days INTEGER;
`;

/** Insights module — scheduled report emails, inventory forecasting, order recommendations. */
export const insightsModule: PosModule = {
  name: "insights",
  migrations: [CREATE_SCHEDULED_REPORTS, ADD_PRODUCT_FORECAST_COLUMNS],
  register({ db, router }) {
    registerRoutes(router, new InsightsService(db));
  },
};

export { InsightsService } from "./service.js";
export type {
  ScheduledReport,
  ReorderRecommendation,
  OrderRecommendation,
  ReportFrequency,
  ReportType,
} from "./service.js";
