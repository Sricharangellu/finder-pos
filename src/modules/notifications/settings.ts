import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";

// ─────────────────────────────────────────────────────────────────────────────
// Notification preferences: one row per (tenant, notification "type" category).
// A missing row reads as a sensible default (never a 404) — same precedent as
// inventory.getStock(). Defaults below mirror the pre-existing MSW mock
// (web/mocks/mockHandlers.ts) so real behavior matches what the demo already
// showed. Labels are a presentation concern and are NOT persisted — they're
// re-derived from this table on every read so future label copy edits don't
// require a data migration.
// ─────────────────────────────────────────────────────────────────────────────

export type PrefChannel = "in_app" | "email" | "sms" | "push";
export type PrefSeverity = "info" | "warning" | "critical";

export interface PrefRow {
  type: string;
  label: string;
  in_app: boolean;
  email: boolean;
  sms: boolean;
  push: boolean;
  min_severity: PrefSeverity;
}

interface PrefDefault {
  type: string;
  label: string;
  in_app: boolean;
  email: boolean;
  sms: boolean;
  push: boolean;
  min_severity: PrefSeverity;
}

const DEFAULT_PREFS: PrefDefault[] = [
  { type: "low_stock", label: "Low Stock Alerts", in_app: true, email: true, sms: false, push: true, min_severity: "warning" },
  { type: "payment_failed", label: "Payment Failures", in_app: true, email: true, sms: true, push: true, min_severity: "critical" },
  { type: "new_order", label: "New Orders", in_app: true, email: false, sms: false, push: false, min_severity: "info" },
  { type: "order_fulfilled", label: "Order Fulfillment", in_app: true, email: true, sms: false, push: false, min_severity: "info" },
  { type: "purchase_order_received", label: "PO Received", in_app: true, email: false, sms: false, push: false, min_severity: "info" },
  { type: "sync_error", label: "Sync Errors", in_app: true, email: true, sms: false, push: true, min_severity: "warning" },
  { type: "system", label: "System Alerts", in_app: true, email: true, sms: true, push: true, min_severity: "warning" },
  { type: "refund_requested", label: "Refund Requests", in_app: true, email: true, sms: false, push: false, min_severity: "warning" },
  { type: "price_override", label: "Price Override Approvals", in_app: true, email: false, sms: false, push: false, min_severity: "info" },
  { type: "reorder_suggestion", label: "Reorder Suggestions", in_app: true, email: true, sms: false, push: false, min_severity: "info" },
];

const DEFAULT_BY_TYPE = new Map(DEFAULT_PREFS.map((d) => [d.type, d]));

export interface PrefUpdateItem {
  type: string;
  channel?: PrefChannel;
  enabled?: boolean;
  min_severity?: PrefSeverity;
}

interface PrefStoredRow {
  tenant_id: string;
  type: string;
  in_app: boolean;
  email: boolean;
  sms: boolean;
  push: boolean;
  min_severity: PrefSeverity;
  updated_at: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Alert rules: real CRUD, one row per rule. `channels` is stored as a JSON
// TEXT column (repo convention — see catalog.service's restricted_states),
// not JSONB.
// ─────────────────────────────────────────────────────────────────────────────

export interface AlertRule {
  id: string;
  name: string;
  trigger: string;
  condition: string;
  threshold: number | null;
  channels: string[];
  enabled: boolean;
  fires_count: number;
  last_fired_at: number | null;
  created_at: number;
}

interface AlertRuleRow {
  id: string;
  tenant_id: string;
  name: string;
  trigger: string;
  condition: string;
  threshold: number | null;
  channels: string;
  enabled: boolean;
  fires_count: number;
  last_fired_at: number | null;
  created_at: number;
}

export interface CreateRuleInput {
  name: string;
  trigger: string;
  condition: string;
  threshold?: number | null;
  channels?: string[];
  enabled?: boolean;
}

export interface UpdateRuleInput {
  name?: string;
  trigger?: string;
  condition?: string;
  threshold?: number | null;
  channels?: string[];
  enabled?: boolean;
}

function rowToRule(row: AlertRuleRow): AlertRule {
  let channels: string[] = [];
  try {
    const parsed = JSON.parse(row.channels) as unknown;
    if (Array.isArray(parsed)) channels = parsed.map((c) => String(c));
  } catch {
    channels = [];
  }
  return {
    id: row.id,
    name: row.name,
    trigger: row.trigger,
    condition: row.condition,
    threshold: row.threshold === null || row.threshold === undefined ? null : Number(row.threshold),
    channels,
    enabled: row.enabled,
    fires_count: Number(row.fires_count ?? 0),
    last_fired_at: row.last_fired_at === null || row.last_fired_at === undefined ? null : Number(row.last_fired_at),
    created_at: Number(row.created_at),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Digest config: single row per tenant, same "missing row reads as a sensible
// default" pattern. The honest default is OFF with no recipients — we never
// fabricate a recipient or silently turn emailing on for a tenant that hasn't
// configured it.
// ─────────────────────────────────────────────────────────────────────────────

export interface DigestConfig {
  enabled: boolean;
  frequency: "daily" | "weekly";
  day_of_week: number;
  hour: number;
  include: string[];
  recipient_emails: string[];
}

interface DigestConfigRow {
  tenant_id: string;
  enabled: boolean;
  frequency: "daily" | "weekly";
  day_of_week: number;
  hour: number;
  include: string;
  recipient_emails: string;
  updated_at: number;
}

const DEFAULT_DIGEST: DigestConfig = {
  enabled: false,
  frequency: "daily",
  day_of_week: 1,
  hour: 8,
  include: [],
  recipient_emails: [],
};

export interface UpdateDigestInput {
  enabled?: boolean;
  frequency?: "daily" | "weekly";
  day_of_week?: number;
  hour?: number;
  include?: string[];
  recipient_emails?: string[];
}

function digestRowToConfig(row: DigestConfigRow): DigestConfig {
  let include: string[] = [];
  let recipient_emails: string[] = [];
  try {
    const parsed = JSON.parse(row.include) as unknown;
    if (Array.isArray(parsed)) include = parsed.map((v) => String(v));
  } catch { /* keep [] */ }
  try {
    const parsed = JSON.parse(row.recipient_emails) as unknown;
    if (Array.isArray(parsed)) recipient_emails = parsed.map((v) => String(v));
  } catch { /* keep [] */ }
  return {
    enabled: row.enabled,
    frequency: row.frequency,
    day_of_week: Number(row.day_of_week),
    hour: Number(row.hour),
    include,
    recipient_emails,
  };
}

export class NotificationSettingsService {
  constructor(private readonly db: DB) {}

  // ── Preferences ──────────────────────────────────────────────────────────

  async getPreferences(tenantId: string): Promise<PrefRow[]> {
    const rows = await this.db.query<PrefStoredRow>(
      `SELECT * FROM notification_preferences WHERE tenant_id = @tenantId`,
      { tenantId },
    );
    const byType = new Map(rows.map((r) => [r.type, r]));
    return DEFAULT_PREFS.map((def) => {
      const row = byType.get(def.type);
      if (!row) return { ...def };
      return {
        type: def.type,
        label: def.label,
        in_app: row.in_app,
        email: row.email,
        sms: row.sms,
        push: row.push,
        min_severity: row.min_severity,
      };
    });
  }

  private async getPrefRowOrDefault(tenantId: string, type: string): Promise<PrefDefault> {
    const row = await this.db.one<PrefStoredRow>(
      `SELECT * FROM notification_preferences WHERE tenant_id = @tenantId AND type = @type`,
      { tenantId, type },
    );
    if (row) {
      const label = DEFAULT_BY_TYPE.get(type)?.label ?? type;
      return { type, label, in_app: row.in_app, email: row.email, sms: row.sms, push: row.push, min_severity: row.min_severity };
    }
    return DEFAULT_BY_TYPE.get(type) ?? { type, label: type, in_app: true, email: false, sms: false, push: false, min_severity: "info" };
  }

  /** Batch-upsert channel/severity updates, grouped by type so a save covering
   *  every channel for a row never clobbers fields it didn't touch. */
  async updatePreferences(tenantId: string, updates: PrefUpdateItem[]): Promise<void> {
    const byType = new Map<string, PrefUpdateItem[]>();
    for (const u of updates) {
      const list = byType.get(u.type) ?? [];
      list.push(u);
      byType.set(u.type, list);
    }
    const now = Date.now();
    for (const [type, items] of byType) {
      const current = await this.getPrefRowOrDefault(tenantId, type);
      const next = { ...current };
      for (const item of items) {
        if (item.channel && item.enabled !== undefined) next[item.channel] = item.enabled;
        if (item.min_severity) next.min_severity = item.min_severity;
      }
      await this.db.query(
        `INSERT INTO notification_preferences (tenant_id, type, in_app, email, sms, push, min_severity, updated_at)
         VALUES (@tenantId, @type, @in_app, @email, @sms, @push, @min_severity, @now)
         ON CONFLICT (tenant_id, type) DO UPDATE SET
           in_app = @in_app, email = @email, sms = @sms, push = @push,
           min_severity = @min_severity, updated_at = @now`,
        {
          tenantId, type,
          in_app: next.in_app, email: next.email, sms: next.sms, push: next.push,
          min_severity: next.min_severity, now,
        },
      );
    }
  }

  // ── Alert rules ──────────────────────────────────────────────────────────

  async listRules(tenantId: string): Promise<AlertRule[]> {
    const rows = await this.db.query<AlertRuleRow>(
      `SELECT * FROM notification_alert_rules WHERE tenant_id = @tenantId ORDER BY created_at DESC`,
      { tenantId },
    );
    return rows.map(rowToRule);
  }

  async createRule(tenantId: string, input: CreateRuleInput): Promise<AlertRule> {
    const now = Date.now();
    const row: AlertRuleRow = {
      id: `rule_${uuidv7()}`,
      tenant_id: tenantId,
      name: input.name,
      trigger: input.trigger,
      condition: input.condition,
      threshold: input.threshold ?? null,
      channels: JSON.stringify(input.channels ?? ["in_app"]),
      enabled: input.enabled ?? true,
      fires_count: 0,
      last_fired_at: null,
      created_at: now,
    };
    await this.db.query(
      `INSERT INTO notification_alert_rules
         (id, tenant_id, name, trigger, condition, threshold, channels, enabled, fires_count, last_fired_at, created_at)
       VALUES (@id, @tenant_id, @name, @trigger, @condition, @threshold, @channels, @enabled, @fires_count, @last_fired_at, @created_at)`,
      row as unknown as Record<string, unknown>,
    );
    return rowToRule(row);
  }

  async updateRule(tenantId: string, id: string, patch: UpdateRuleInput): Promise<AlertRule | undefined> {
    const existing = await this.db.one<AlertRuleRow>(
      `SELECT * FROM notification_alert_rules WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId },
    );
    if (!existing) return undefined;
    const next: AlertRuleRow = {
      ...existing,
      name: patch.name ?? existing.name,
      trigger: patch.trigger ?? existing.trigger,
      condition: patch.condition ?? existing.condition,
      threshold: patch.threshold !== undefined ? patch.threshold : existing.threshold,
      channels: patch.channels !== undefined ? JSON.stringify(patch.channels) : existing.channels,
      enabled: patch.enabled !== undefined ? patch.enabled : existing.enabled,
    };
    await this.db.query(
      `UPDATE notification_alert_rules SET
         name = @name, trigger = @trigger, condition = @condition, threshold = @threshold,
         channels = @channels, enabled = @enabled
       WHERE id = @id AND tenant_id = @tenant_id`,
      next as unknown as Record<string, unknown>,
    );
    return rowToRule(next);
  }

  async deleteRule(tenantId: string, id: string): Promise<boolean> {
    const result = await this.db.query<{ id: string }>(
      `DELETE FROM notification_alert_rules WHERE id = @id AND tenant_id = @tenantId RETURNING id`,
      { id, tenantId },
    );
    return result.length > 0;
  }

  // ── Digest config ────────────────────────────────────────────────────────

  async getDigest(tenantId: string): Promise<DigestConfig> {
    const row = await this.db.one<DigestConfigRow>(
      `SELECT * FROM notification_digest_config WHERE tenant_id = @tenantId`,
      { tenantId },
    );
    return row ? digestRowToConfig(row) : { ...DEFAULT_DIGEST };
  }

  async updateDigest(tenantId: string, patch: UpdateDigestInput): Promise<DigestConfig> {
    const current = await this.getDigest(tenantId);
    const next: DigestConfig = {
      enabled: patch.enabled !== undefined ? patch.enabled : current.enabled,
      frequency: patch.frequency ?? current.frequency,
      day_of_week: patch.day_of_week !== undefined ? patch.day_of_week : current.day_of_week,
      hour: patch.hour !== undefined ? patch.hour : current.hour,
      include: patch.include !== undefined ? patch.include : current.include,
      recipient_emails: patch.recipient_emails !== undefined ? patch.recipient_emails : current.recipient_emails,
    };
    const now = Date.now();
    await this.db.query(
      `INSERT INTO notification_digest_config
         (tenant_id, enabled, frequency, day_of_week, hour, include, recipient_emails, updated_at)
       VALUES (@tenantId, @enabled, @frequency, @day_of_week, @hour, @include, @recipient_emails, @now)
       ON CONFLICT (tenant_id) DO UPDATE SET
         enabled = @enabled, frequency = @frequency, day_of_week = @day_of_week, hour = @hour,
         include = @include, recipient_emails = @recipient_emails, updated_at = @now`,
      {
        tenantId,
        enabled: next.enabled,
        frequency: next.frequency,
        day_of_week: next.day_of_week,
        hour: next.hour,
        include: JSON.stringify(next.include),
        recipient_emails: JSON.stringify(next.recipient_emails),
        now,
      },
    );
    return next;
  }
}
