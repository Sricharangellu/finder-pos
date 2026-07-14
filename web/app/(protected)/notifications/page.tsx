"use client";

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { apiGet, apiPost, apiPatch, apiDelete, ApiResponseError } from "@/api-client/client";
import type { Notification, NotificationsResponse, NotificationSeverity, NotificationType } from "@/api-client/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "inbox" | "preferences" | "rules" | "digest";

type Channel = "in_app" | "email" | "sms" | "push";

interface PrefRow {
  type: string; label: string;
  in_app: boolean; email: boolean; sms: boolean; push: boolean;
  min_severity: "info" | "warning" | "critical";
}

interface AlertRule {
  id: string; name: string; trigger: string; condition: string;
  threshold: number | null; channels: string[];
  enabled: boolean; fires_count: number;
  last_fired_at: number | null; created_at: number;
}

interface DigestConfig {
  enabled: boolean; frequency: "daily" | "weekly"; day_of_week: number; hour: number;
  include: string[]; recipient_emails: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string }[] = [
  { key: "inbox",       label: "Inbox" },
  { key: "preferences", label: "Preferences" },
  { key: "rules",       label: "Alert Rules" },
  { key: "digest",      label: "Digest" },
];

const SEV_CLS: Record<NotificationSeverity, string> = {
  info:     "bg-blue-100 text-blue-700",
  warning:  "bg-amber-100 text-amber-700",
  critical: "bg-red-100 text-red-700",
};

const TYPE_LABELS: Record<NotificationType, string> = {
  low_stock:               "Low Stock",
  payment_failed:          "Payment Failed",
  new_order:               "New Order",
  order_fulfilled:         "Fulfilled",
  purchase_order_received: "PO Received",
  sync_error:              "Sync Error",
  system:                  "System",
  refund_requested:        "Refund",
  price_override:          "Price Override",
  reorder_suggestion:      "Reorder",
};

const CHANNEL_META: Record<Channel, { label: string; icon: string }> = {
  in_app: { label: "In-App",       icon: "🔔" },
  email:  { label: "Email",        icon: "✉️" },
  sms:    { label: "SMS",          icon: "💬" },
  push:   { label: "Browser Push", icon: "📲" },
};

const CHANNELS: Channel[] = ["in_app", "email", "sms", "push"];

const TRIGGER_LABELS: Record<string, string> = {
  inventory: "Inventory",
  payment:   "Payment",
  sales:     "Sales",
  invoice:   "Invoice",
  order:     "Order",
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function Badge({ label, cls }: { label: string; cls: string }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${cls}`}>{label}</span>;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-600/30 ${on ? "bg-brand-600" : "bg-slate-200"}`}
    >
      <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : "translate-x-0"}`} />
    </button>
  );
}

function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />
      ))}
    </div>
  );
}

// ── Inbox Tab ─────────────────────────────────────────────────────────────────

function InboxTab() {
  const [items, setItems]           = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [filter, setFilter]         = useState<"all" | "unread">("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = filter === "unread" ? "?unread=true" : "";
      const data = await apiGet<NotificationsResponse>(`/api/v1/notifications${params}`);
      setItems(data.items);
      setUnreadCount(data.unread_count);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load notifications.");
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const markRead = async (id: string) => {
    try {
      await apiPatch(`/api/v1/notifications/${id}/read`, {});
      setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch { /* ignore */ }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      await apiPost("/api/v1/notifications/mark-all-read", {});
      setItems(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } finally { setMarkingAll(false); }
  };

  const filtered = typeFilter === "all" ? items : items.filter(n => n.type === typeFilter);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-slate-900">
          {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
        </span>
        <div className="flex overflow-hidden rounded-lg border border-slate-200 text-sm">
          {(["all", "unread"] as const).map(f => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={`px-3 py-1.5 capitalize transition-colors ${filter === f ? "bg-brand-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
              {f}
            </button>
          ))}
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="h-9 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 focus:border-brand-600 focus:outline-none">
          <option value="all">All types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {unreadCount > 0 && (
          <button type="button" disabled={markingAll} onClick={() => void markAllRead()}
            className="ml-auto rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {markingAll ? "Marking…" : "Mark all as read"}
          </button>
        )}
      </div>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">{error}</p>}
      {loading && <Skeleton />}

      {!loading && filtered.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center">
          <p className="text-sm text-slate-400">{filter === "unread" ? "No unread notifications." : "No notifications found."}</p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map(n => (
            <div key={n.id}
              className={`relative rounded-xl border px-5 py-4 transition-colors ${n.read ? "border-slate-200 bg-white" : "border-brand-600/30 bg-indigo-50"}`}>
              {!n.read && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-brand-600" />}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 pl-2">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{n.title}</span>
                    <Badge label={n.severity} cls={SEV_CLS[n.severity]} />
                    <Badge label={TYPE_LABELS[n.type]} cls="bg-slate-100 text-slate-600" />
                  </div>
                  <p className="text-sm text-slate-600">{n.body}</p>
                  <p className="mt-1 text-xs text-slate-400">{relativeTime(n.created_at)}</p>
                </div>
                {!n.read && (
                  <button type="button" onClick={() => void markRead(n.id)}
                    className="shrink-0 text-xs font-medium text-brand-600 hover:underline">
                    Mark read
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Preferences Tab ───────────────────────────────────────────────────────────

function PreferencesTab() {
  const [prefs, setPrefs]     = useState<PrefRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

  useEffect(() => {
    void apiGet<{ items: PrefRow[] }>("/api/v1/notifications/preferences").then(r => {
      setPrefs(r.items ?? []); setLoading(false);
    }).catch((err: unknown) => { setError((err as Error).message ?? "Failed to load"); setLoading(false); });
  }, []);

  const toggle = (type: string, channel: Channel) => {
    setPrefs(prev => prev.map(p => p.type === type ? { ...p, [channel]: !p[channel] } : p));
    setSaved(false);
  };

  const setSeverity = (type: string, sev: PrefRow["min_severity"]) => {
    setPrefs(prev => prev.map(p => p.type === type ? { ...p, min_severity: sev } : p));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = prefs.flatMap(p =>
        CHANNELS.map(ch => ({ type: p.type, channel: ch, enabled: p[ch] }))
      );
      await apiPatch("/api/v1/notifications/preferences", updates);
      setSaved(true);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const SEV_CLS2: Record<PrefRow["min_severity"], string> = {
    info:     "bg-blue-100 text-blue-700",
    warning:  "bg-amber-100 text-amber-700",
    critical: "bg-red-100 text-red-700",
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-blue-100 bg-blue-50 px-5 py-3 text-sm text-blue-700">
        Control which channels each notification type uses. Changes take effect immediately for your account.
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500">
              <tr>
                <th className="px-5 py-3 min-w-[200px]">Notification Type</th>
                {CHANNELS.map(ch => (
                  <th key={ch} className="px-5 py-3 text-center">
                    <span className="mr-1">{CHANNEL_META[ch].icon}</span>
                    {CHANNEL_META[ch].label}
                  </th>
                ))}
                <th className="px-5 py-3">Min Severity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="py-8 text-center"><div className="mx-auto h-3 w-48 animate-pulse rounded bg-slate-100" /></td></tr>
              ) : error ? (
                <tr><td colSpan={6} className="px-5 py-4 text-sm text-red-600">{error}</td></tr>
              ) : prefs.map(p => (
                <tr key={p.type} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5 font-medium text-slate-900">{p.label}</td>
                  {CHANNELS.map(ch => (
                    <td key={ch} className="px-5 py-3.5 text-center">
                      <Toggle on={p[ch]} onChange={() => toggle(p.type, ch)} />
                    </td>
                  ))}
                  <td className="px-5 py-3.5">
                    <select value={p.min_severity}
                      onChange={e => setSeverity(p.type, e.target.value as PrefRow["min_severity"])}
                      className="h-8 rounded-lg border border-slate-200 px-2 text-xs focus:border-brand-600 focus:outline-none">
                      <option value="info">Info+</option>
                      <option value="warning">Warning+</option>
                      <option value="critical">Critical only</option>
                    </select>
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${SEV_CLS2[p.min_severity]}`}>
                      {p.min_severity}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
          {saved && <p className="text-xs text-emerald-600 font-medium">Preferences saved.</p>}
          {!saved && <span />}
          <button type="button" disabled={saving || loading} onClick={() => void handleSave()}
            className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8] disabled:opacity-50">
            {saving ? "Saving…" : "Save preferences"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Alert Rules Tab ───────────────────────────────────────────────────────────

function AlertRulesTab() {
  const [rules, setRules]     = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await apiGet<{ items: AlertRule[] }>("/api/v1/notifications/rules");
      setRules(r.items ?? []);
    } catch (err: unknown) {
      setError(err instanceof ApiResponseError ? err.message : "Failed to load rules.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleRule = async (id: string, enabled: boolean) => {
    try {
      await apiPatch(`/api/v1/notifications/rules/${id}`, { enabled });
      setRules(prev => prev.map(r => r.id === id ? { ...r, enabled } : r));
    } catch { /* ignore */ }
  };

  const deleteRule = async (id: string) => {
    try {
      await apiDelete(`/api/v1/notifications/rules/${id}`);
      setRules(prev => prev.filter(r => r.id !== id));
    } catch { /* ignore */ }
  };

  const CONDITION_LABELS: Record<string, string> = {
    qty_lte_reorder_point: "Qty ≤ reorder point",
    qty_eq:                "Qty equals",
    amount_gte:            "Amount ≥",
    status_eq_failed:      "Status = failed",
    pct_drop_gte:          "% drop ≥",
    overdue_days_gte:      "Overdue days ≥",
  };

  const CHANNEL_ICONS: Record<string, string> = { in_app: "🔔", email: "✉️", sms: "💬", push: "📲" };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-100 bg-amber-50 px-5 py-3 text-sm text-amber-700">
        Alert rules fire notifications automatically when business conditions are met. Each rule can target multiple channels.
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-slate-900">{rules.length} alert rules</h3>
          <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8]">
            + New Rule
          </button>
        </div>

        {loading ? <Skeleton rows={6} /> : error ? (
          <p className="px-5 py-6 text-sm text-red-600">{error}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500">
              <tr>
                <th className="px-5 py-3">Rule</th>
                <th className="px-5 py-3">Trigger</th>
                <th className="px-5 py-3">Condition</th>
                <th className="px-5 py-3">Channels</th>
                <th className="px-5 py-3 text-right">Fires</th>
                <th className="px-5 py-3">Last fired</th>
                <th className="px-5 py-3">Active</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rules.map(r => (
                <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5 font-medium text-slate-900">{r.name}</td>
                  <td className="px-5 py-3.5">
                    <Badge label={TRIGGER_LABELS[r.trigger] ?? r.trigger} cls="bg-indigo-100 text-indigo-700" />
                  </td>
                  <td className="px-5 py-3.5 text-xs text-slate-600">
                    {CONDITION_LABELS[r.condition] ?? r.condition}
                    {r.threshold !== null && <span className="ml-1 font-semibold">{r.threshold}</span>}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex gap-1">
                      {r.channels.map(ch => (
                        <span key={ch} title={ch} className="text-sm">{CHANNEL_ICONS[ch] ?? ch}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-right font-semibold text-slate-900">{r.fires_count.toLocaleString()}</td>
                  <td className="px-5 py-3.5 text-xs text-slate-500">
                    {r.last_fired_at ? relativeTime(r.last_fired_at) : "Never"}
                  </td>
                  <td className="px-5 py-3.5">
                    <Toggle on={r.enabled} onChange={v => void toggleRule(r.id, v)} />
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex gap-1.5">
                      <button className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        Edit
                      </button>
                      <button onClick={() => void deleteRule(r.id)}
                        className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rules.length === 0 && (
                <tr><td colSpan={8} className="py-10 text-center text-sm text-slate-400">No alert rules configured.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Digest Tab ────────────────────────────────────────────────────────────────

function DigestTab() {
  const [config, setConfig]   = useState<DigestConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [newEmail, setNewEmail] = useState("");

  useEffect(() => {
    void apiGet<DigestConfig>("/api/v1/notifications/digest").then(d => {
      setConfig(d); setLoading(false);
    }).catch((err: unknown) => { setError((err as Error).message ?? "Failed to load"); setLoading(false); });
  }, []);

  const update = <K extends keyof DigestConfig>(k: K, v: DigestConfig[K]) => {
    setConfig(c => c ? { ...c, [k]: v } : c);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await apiPatch("/api/v1/notifications/digest", config);
      setSaved(true);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const addEmail = () => {
    if (!newEmail.trim() || !config) return;
    update("recipient_emails", [...config.recipient_emails, newEmail.trim()]);
    setNewEmail("");
  };

  const removeEmail = (email: string) => {
    if (!config) return;
    update("recipient_emails", config.recipient_emails.filter(e => e !== email));
  };

  const ALL_TYPES = Object.entries(TYPE_LABELS);

  const inp = "h-9 rounded-lg border border-slate-200 px-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20";

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="rounded-xl border border-teal-100 bg-teal-50 px-5 py-3 text-sm text-teal-700">
        A scheduled digest delivers a summary of recent activity to configured email addresses. Useful for managers who don't monitor the app in real time.
      </div>

      {loading && <Skeleton rows={4} />}
      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">{error}</p>}

      {!loading && !error && config && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold text-slate-900">Schedule</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">Enable digest emails</p>
                  <p className="text-xs text-slate-500">Send scheduled summaries to configured recipients</p>
                </div>
                <Toggle on={config.enabled} onChange={v => update("enabled", v)} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Frequency</label>
                  <select value={config.frequency} onChange={e => update("frequency", e.target.value as DigestConfig["frequency"])}
                    className={inp + " w-full"} disabled={!config.enabled}>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
                {config.frequency === "weekly" && (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">Day of week</label>
                    <select value={config.day_of_week} onChange={e => update("day_of_week", Number(e.target.value))}
                      className={inp + " w-full"} disabled={!config.enabled}>
                      {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Send at (store time)</label>
                  <select value={config.hour} onChange={e => update("hour", Number(e.target.value))}
                    className={inp + " w-full"} disabled={!config.enabled}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>{h.toString().padStart(2, "0")}:00</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold text-slate-900">What to include</h3>
            <div className="grid grid-cols-2 gap-2">
              {ALL_TYPES.map(([type, label]) => {
                const checked = config.include.includes(type);
                return (
                  <label key={type} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 hover:bg-slate-50 transition-colors">
                    <input type="checkbox" checked={checked} disabled={!config.enabled}
                      onChange={e => {
                        const next = e.target.checked
                          ? [...config.include, type]
                          : config.include.filter(t => t !== type);
                        update("include", next);
                      }}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600" />
                    <span className="text-sm text-slate-700">{label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold text-slate-900">Recipients</h3>
            <div className="space-y-2">
              {config.recipient_emails.map(email => (
                <div key={email} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5">
                  <span className="text-sm text-slate-700">{email}</span>
                  <button onClick={() => removeEmail(email)} className="text-xs text-red-500 hover:underline">Remove</button>
                </div>
              ))}
              <div className="flex gap-2">
                <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addEmail()}
                  placeholder="Add email address…"
                  className={inp + " flex-1"} disabled={!config.enabled} />
                <button type="button" onClick={addEmail} disabled={!newEmail.trim() || !config.enabled}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  Add
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            {saved && <p className="text-sm font-medium text-emerald-600">Digest settings saved.</p>}
            {!saved && <span />}
            <button type="button" disabled={saving} onClick={() => void handleSave()}
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8] disabled:opacity-50">
              {saving ? "Saving…" : "Save digest settings"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("inbox");

  return (
    <EnterpriseShell
      active="notifications"
      title="Notification Center"
      subtitle="Inbox, channel preferences, alert rules, and digest scheduling"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-6xl space-y-0 px-4 py-5 sm:px-6">
        <div className="border-b border-slate-200">
          <nav className="-mb-px flex gap-1 overflow-x-auto">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === t.key
                    ? "border-brand-600 text-brand-600"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
                }`}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="pt-5">
          {activeTab === "inbox"       && <InboxTab />}
          {activeTab === "preferences" && <PreferencesTab />}
          {activeTab === "rules"       && <AlertRulesTab />}
          {activeTab === "digest"      && <DigestTab />}
        </div>
      </div>
    </EnterpriseShell>
  );
}
