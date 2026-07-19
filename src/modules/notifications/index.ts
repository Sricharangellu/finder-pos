import type { PosModule } from "../types.js";
import { NotificationsService } from "./service.js";
import { registerRoutes } from "./routes.js";
import { NotificationSettingsService } from "./settings.js";
import { registerSettingsRoutes } from "./settings-routes.js";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  type        TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'info',
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  read        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  BIGINT NOT NULL
);
`;

const CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS notifications_tenant_created_idx ON notifications (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_tenant_unread_idx  ON notifications (tenant_id, read) WHERE read = FALSE;
`;

// Notifications settings surface (2026-07-18, Phase 0 gap-closure): channel
// preferences, alert rules, digest scheduling. See settings.ts for the
// service and settings-routes.ts for the routes.
const CREATE_PREFERENCES_TABLE = `
CREATE TABLE IF NOT EXISTS notification_preferences (
  tenant_id     TEXT NOT NULL,
  type          TEXT NOT NULL,
  in_app        BOOLEAN NOT NULL DEFAULT TRUE,
  email         BOOLEAN NOT NULL DEFAULT FALSE,
  sms           BOOLEAN NOT NULL DEFAULT FALSE,
  push          BOOLEAN NOT NULL DEFAULT FALSE,
  min_severity  TEXT NOT NULL DEFAULT 'info',
  updated_at    BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, type)
);
`;

const CREATE_ALERT_RULES_TABLE = `
CREATE TABLE IF NOT EXISTS notification_alert_rules (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  name           TEXT NOT NULL,
  trigger        TEXT NOT NULL,
  condition      TEXT NOT NULL,
  threshold      DOUBLE PRECISION,
  channels       TEXT NOT NULL DEFAULT '[]',
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  fires_count    INTEGER NOT NULL DEFAULT 0,
  last_fired_at  BIGINT,
  created_at     BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS notification_alert_rules_tenant_idx ON notification_alert_rules (tenant_id, created_at DESC);
`;

const CREATE_DIGEST_CONFIG_TABLE = `
CREATE TABLE IF NOT EXISTS notification_digest_config (
  tenant_id         TEXT PRIMARY KEY,
  enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  frequency         TEXT NOT NULL DEFAULT 'daily',
  day_of_week       INTEGER NOT NULL DEFAULT 1,
  hour              INTEGER NOT NULL DEFAULT 8,
  include           TEXT NOT NULL DEFAULT '[]',
  recipient_emails  TEXT NOT NULL DEFAULT '[]',
  updated_at        BIGINT NOT NULL
);
`;

export const notificationsModule: PosModule = {
  name: "notifications",
  migrations: [
    CREATE_TABLE,
    CREATE_INDEXES,
    CREATE_PREFERENCES_TABLE,
    CREATE_ALERT_RULES_TABLE,
    CREATE_DIGEST_CONFIG_TABLE,
  ],
  async register({ db, events, router }) {
    const service = new NotificationsService(db);
    const settingsService = new NotificationSettingsService(db);

    // Emit a notification when stock drops to zero after an order.
    events.on("inventory.adjusted", async (event) => {
      const p = event.payload as { tenantId?: string; sku?: string; available?: number; name?: string };
      if (p.tenantId && typeof p.available === "number" && p.available <= 0) {
        await service.create(
          {
            type: "low_stock",
            severity: "warning",
            title: "Low stock alert",
            message: `${p.name ?? p.sku ?? "A product"} is out of stock (available: ${p.available}).`,
          },
          p.tenantId,
        ).catch(() => {});
      }
    });

    // Emit a notification when an invoice goes overdue.
    events.on("invoice.overdue", async (event) => {
      const p = event.payload as { tenantId?: string; invoiceNo?: string; dunningLevel?: number };
      if (p.tenantId) {
        const level = p.dunningLevel ?? 1;
        const severity = level >= 3 ? "critical" : level === 2 ? "warning" : "info";
        await service.create(
          {
            type: "overdue_invoice",
            severity,
            title: "Invoice overdue",
            message: `Invoice ${p.invoiceNo ?? ""} is overdue (dunning level ${level}).`,
          },
          p.tenantId,
        ).catch(() => {});
      }
    });

    registerRoutes(router, service);
    registerSettingsRoutes(router, settingsService);
  },
};

export { NotificationsService } from "./service.js";
export type { Notification, NotificationSeverity, NotificationType } from "./service.js";
