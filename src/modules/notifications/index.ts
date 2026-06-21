import type { PosModule } from "../types.js";
import { NotificationsService } from "./service.js";
import { registerRoutes } from "./routes.js";

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

export const notificationsModule: PosModule = {
  name: "notifications",
  migrations: [CREATE_TABLE, CREATE_INDEXES],
  async register({ db, events, router }) {
    const service = new NotificationsService(db);

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
  },
};

export { NotificationsService } from "./service.js";
export type { Notification, NotificationSeverity, NotificationType } from "./service.js";
