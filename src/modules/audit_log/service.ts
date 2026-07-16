import type { DB } from "../../shared/db.js";
import { clampLimit, decodeCursor, encodeCursor, type CursorPage } from "../../shared/pagination.js";

export interface AuditActor {
  id: string;
  email: string;
  role: string;
}

export interface AuditEventChange {
  from: unknown;
  to: unknown;
}

export interface AuditEvent {
  id: string;
  actor: AuditActor;
  action: string;
  resource_type: string;
  resource_id: string;
  resource_label: string;
  changes: Record<string, AuditEventChange> | null;
  ip_address: string | null;
  created_at: number;
}

export interface ListOptions {
  actor?: string;       // actor email substring
  resourceType?: string;
  action?: string;
  limit?: number;
  offset?: number;
}

interface AuditRow {
  id: string;
  actor_id: string;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before_state: string | null;
  after_state: string | null;
  occurred_at: number;
}

function buildChanges(before: string | null, after: string | null): Record<string, AuditEventChange> | null {
  if (!before && !after) return null;
  try {
    const b: Record<string, unknown> = before ? (JSON.parse(before) as Record<string, unknown>) : {};
    const a: Record<string, unknown> = after ? (JSON.parse(after) as Record<string, unknown>) : {};
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    const changes: Record<string, AuditEventChange> = {};
    for (const k of keys) {
      if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) {
        changes[k] = { from: b[k] ?? null, to: a[k] ?? null };
      }
    }
    return Object.keys(changes).length > 0 ? changes : null;
  } catch {
    return null;
  }
}

function toEvent(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    actor: {
      id: row.actor_id,
      email: row.actor_email ?? row.actor_id,
      role: row.actor_role ?? "unknown",
    },
    action: row.action,
    resource_type: row.entity_type,
    resource_id: row.entity_id,
    resource_label: row.entity_id,
    changes: buildChanges(row.before_state, row.after_state),
    ip_address: null,
    created_at: row.occurred_at,
  };
}

export class AuditLogService {
  constructor(private readonly db: DB) {}

  async list(tenantId: string, opts: ListOptions = {}): Promise<{ items: AuditEvent[]; total: number; limit: number; offset: number }> {
    const limit = Math.min(opts.limit ?? 20, 200);
    const offset = opts.offset ?? 0;

    const conditions: string[] = ["al.tenant_id = @tenantId"];
    const params: Record<string, unknown> = { tenantId, limit, offset };

    if (opts.resourceType) {
      conditions.push("al.entity_type = @resourceType");
      params["resourceType"] = opts.resourceType;
    }
    if (opts.action) {
      conditions.push("al.action = @action");
      params["action"] = opts.action;
    }
    if (opts.actor) {
      conditions.push("u.email ILIKE @actor");
      params["actor"] = `%${opts.actor}%`;
    }

    const where = conditions.join(" AND ");

    const [rows, countRows] = await Promise.all([
      this.db.query<AuditRow>(
        `SELECT al.id, al.actor_id, u.email AS actor_email, u.role AS actor_role,
                al.action, al.entity_type, al.entity_id,
                al.before_state, al.after_state, al.occurred_at
         FROM audit_log al
         LEFT JOIN users u ON u.id = al.actor_id AND u.tenant_id = al.tenant_id
         WHERE ${where}
         ORDER BY al.occurred_at DESC, al.id DESC
         LIMIT @limit OFFSET @offset`,
        params,
      ),
      this.db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n
         FROM audit_log al
         LEFT JOIN users u ON u.id = al.actor_id AND u.tenant_id = al.tenant_id
         WHERE ${where}`,
        params,
      ),
    ]);

    return {
      items: rows.map(toEvent),
      total: countRows[0]?.n ?? 0,
      limit,
      offset,
    };
  }

  /**
   * Keyset-paginated listing (CODING_STANDARDS: cursor REQUIRED for unbounded
   * append-heavy lists). Additive alongside list() — the offset path stays for
   * existing clients; deep pages and the COUNT(*) scan are avoided here.
   */
  async listCursor(
    tenantId: string,
    opts: Omit<ListOptions, "offset"> & { cursor?: string } = {},
  ): Promise<CursorPage<AuditEvent>> {
    const limit = clampLimit(opts.limit, 20, 200);
    const cur = decodeCursor(opts.cursor);

    const conditions: string[] = ["al.tenant_id = @tenantId"];
    const params: Record<string, unknown> = { tenantId, limit };

    if (opts.resourceType) {
      conditions.push("al.entity_type = @resourceType");
      params["resourceType"] = opts.resourceType;
    }
    if (opts.action) {
      conditions.push("al.action = @action");
      params["action"] = opts.action;
    }
    if (opts.actor) {
      conditions.push("u.email ILIKE @actor");
      params["actor"] = `%${opts.actor}%`;
    }
    if (cur) {
      conditions.push("(al.occurred_at, al.id) < (@curAt, @curId)");
      params["curAt"] = cur.at;
      params["curId"] = cur.id;
    }

    const rows = await this.db.query<AuditRow>(
      `SELECT al.id, al.actor_id, u.email AS actor_email, u.role AS actor_role,
              al.action, al.entity_type, al.entity_id,
              al.before_state, al.after_state, al.occurred_at
       FROM audit_log al
       LEFT JOIN users u ON u.id = al.actor_id AND u.tenant_id = al.tenant_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY al.occurred_at DESC, al.id DESC
       LIMIT @limit`,
      params,
    );

    const events = rows.map(toEvent);
    const last = events[events.length - 1];
    return {
      items: events,
      nextCursor: events.length === limit && last ? encodeCursor({ at: last.created_at, id: last.id }) : null,
      limit,
    };
  }
}
