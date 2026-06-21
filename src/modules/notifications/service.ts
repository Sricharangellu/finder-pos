import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";

export type NotificationSeverity = "info" | "warning" | "critical";
export type NotificationType =
  | "low_stock"
  | "overdue_invoice"
  | "new_order"
  | "system"
  | "payment_failed"
  | "reorder_point";

export interface Notification {
  id: string;
  tenant_id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  read: boolean;
  created_at: number;
}

export interface CreateNotificationInput {
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
}

export interface ListOptions {
  unread?: boolean;
  limit?: number;
  offset?: number;
}

export class NotificationsService {
  constructor(private readonly db: DB) {}

  async create(input: CreateNotificationInput, tenantId: string): Promise<Notification> {
    const notif: Notification = {
      id: `ntf_${uuidv7()}`,
      tenant_id: tenantId,
      type: input.type,
      severity: input.severity,
      title: input.title,
      message: input.message,
      read: false,
      created_at: Date.now(),
    };
    await this.db.query(
      `INSERT INTO notifications (id, tenant_id, type, severity, title, message, read, created_at)
       VALUES (@id, @tenant_id, @type, @severity, @title, @message, @read, @created_at)`,
      notif as unknown as Record<string, unknown>,
    );
    return notif;
  }

  async list(tenantId: string, opts: ListOptions = {}): Promise<{ items: Notification[]; total: number }> {
    const limit = Math.min(opts.limit ?? 25, 200);
    const offset = opts.offset ?? 0;

    const conditions = ["tenant_id = @tenantId"];
    const params: Record<string, unknown> = { tenantId, limit, offset };

    if (opts.unread) {
      conditions.push("read = FALSE");
    }

    const where = conditions.join(" AND ");

    const [items, countRow] = await Promise.all([
      this.db.query<Notification>(
        `SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`,
        params,
      ),
      this.db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM notifications WHERE ${where}`,
        { tenantId, ...(opts.unread ? {} : {}) },
      ),
    ]);

    return { items, total: countRow[0]?.n ?? 0 };
  }

  async markRead(id: string, tenantId: string): Promise<boolean> {
    const result = await this.db.query<{ id: string }>(
      `UPDATE notifications SET read = TRUE WHERE id = @id AND tenant_id = @tenantId RETURNING id`,
      { id, tenantId },
    );
    return result.length > 0;
  }

  async markAllRead(tenantId: string): Promise<number> {
    const result = await this.db.query<{ id: string }>(
      `UPDATE notifications SET read = TRUE WHERE read = FALSE AND tenant_id = @tenantId RETURNING id`,
      { tenantId },
    );
    return result.length;
  }

  async unreadCount(tenantId: string): Promise<number> {
    const row = await this.db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM notifications WHERE tenant_id = @tenantId AND read = FALSE`,
      { tenantId },
    );
    return row[0]?.n ?? 0;
  }
}
