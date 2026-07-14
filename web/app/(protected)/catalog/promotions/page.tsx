"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { apiGet, apiPost, apiPatch, apiDelete, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/date";
import { Can } from "@/components/rbac";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "campaigns" | "coupons" | "flash-sales" | "bundles" | "stackability" | "analytics";

type PromoType   = "percent_off" | "fixed_off" | "bogo" | "bundle" | "flash";
type PromoStatus = "active" | "scheduled" | "expired" | "draft";
type PromoScope  = "all" | "category" | "product";

interface Promotion {
  id: string;
  name: string;
  code: string | null;
  type: PromoType;
  value: number;
  scope: PromoScope;
  scope_value: string | null;
  status: PromoStatus;
  starts_at: number;
  ends_at: number | null;
  usage_count: number;
  usage_limit: number | null;
  per_customer_limit: number | null;
  channel: "all" | "pos" | "ecommerce";
  stackable: boolean;
  revenue_impact_cents: number;
  created_at: number;
}

interface CouponCode {
  id: string;
  code: string;
  promotion_id: string;
  promotion_name: string;
  type: "single_use" | "multi_use";
  used: boolean;
  used_at: number | null;
  customer_name: string | null;
  created_at: number;
}

interface FlashSale {
  id: string;
  name: string;
  discount_pct: number;
  scope: PromoScope;
  scope_value: string | null;
  starts_at: number;
  ends_at: number;
  status: "upcoming" | "live" | "ended";
  units_sold: number;
  revenue_cents: number;
}

interface BundleRule {
  id: string;
  name: string;
  min_items: number;
  discount_pct: number;
  products: Array<{ sku: string; name: string }>;
  active: boolean;
  usage_count: number;
}

interface StackRule {
  id: string;
  promo_a_name: string;
  promo_b_name: string;
  can_stack: boolean;
  priority: number;
  note: string | null;
}

interface PromoAnalytics {
  total_redemptions: number;
  total_revenue_impact_cents: number;
  avg_order_lift_pct: number;
  top_promotions: Array<{ name: string; redemptions: number; revenue_cents: number }>;
  redemptions_by_day: Array<{ date: string; count: number }>;
  channel_split: { pos: number; ecommerce: number };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string }[] = [
  { key: "campaigns",    label: "Campaigns" },
  { key: "coupons",      label: "Coupon Codes" },
  { key: "flash-sales",  label: "Flash Sales" },
  { key: "bundles",      label: "Bundle Rules" },
  { key: "stackability", label: "Stackability" },
  { key: "analytics",    label: "Analytics" },
];

const TYPE_LABELS: Record<PromoType, string> = {
  percent_off: "% Off",
  fixed_off:   "$ Off",
  bogo:        "Buy 1 Get 1",
  bundle:      "Bundle",
  flash:       "Flash Sale",
};

const TYPE_CLS: Record<PromoType, string> = {
  percent_off: "bg-indigo-100 text-indigo-700",
  fixed_off:   "bg-blue-100 text-blue-700",
  bogo:        "bg-purple-100 text-purple-700",
  bundle:      "bg-teal-100 text-teal-700",
  flash:       "bg-red-100 text-red-700",
};

const STATUS_CLS: Record<PromoStatus, string> = {
  active:    "bg-emerald-100 text-emerald-700",
  scheduled: "bg-blue-100 text-blue-700",
  expired:   "bg-slate-100 text-slate-500",
  draft:     "bg-amber-100 text-amber-700",
};

const CHANNEL_CLS: Record<string, string> = {
  all:       "bg-slate-100 text-slate-600",
  pos:       "bg-indigo-100 text-indigo-700",
  ecommerce: "bg-teal-100 text-teal-700",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function Badge({ label, cls }: { label: string; cls: string }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${cls}`}>{label}</span>;
}

function formatValue(type: PromoType, value: number): string {
  if (type === "percent_off" || type === "flash") return `${value}% off`;
  if (type === "fixed_off")  return `${formatMoney(value)} off`;
  if (type === "bogo")       return "Buy 1 Get 1 Free";
  return `${value}+ items`;
}

function promoStatusFor(p: Promotion): PromoStatus {
  if (p.status === "draft") return "draft";
  const now = Date.now();
  if (now < p.starts_at) return "scheduled";
  if (p.ends_at && now > p.ends_at) return "expired";
  return "active";
}

function Countdown({ endsAt }: { endsAt: number }) {
  const remaining = Math.max(0, endsAt - Date.now());
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  if (remaining === 0) return <span className="font-mono text-xs text-slate-400">Ended</span>;
  return (
    <span className="font-mono text-xs font-bold text-red-600">
      {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </span>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return <p className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">{msg}</p>;
}

function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
        <div className="h-3 w-48 animate-pulse rounded bg-slate-200" />
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3.5">
            <div className="h-3 flex-1 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-20 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-16 animate-pulse rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Form modal ────────────────────────────────────────────────────────────────

interface PromoForm {
  name: string; code: string; type: PromoType;
  value: string; scope: PromoScope; scope_value: string;
  starts_at: string; ends_at: string;
  usage_limit: string; per_customer_limit: string;
  channel: "all" | "pos" | "ecommerce";
  stackable: boolean; status: PromoStatus;
}

function emptyForm(): PromoForm {
  const today = new Date().toISOString().slice(0, 10);
  return {
    name: "", code: "", type: "percent_off", value: "", scope: "all", scope_value: "",
    starts_at: today, ends_at: "", usage_limit: "", per_customer_limit: "",
    channel: "all", stackable: true, status: "active",
  };
}

function promoToForm(p: Promotion): PromoForm {
  return {
    name: p.name, code: p.code ?? "", type: p.type,
    value: p.type === "fixed_off" ? String(p.value / 100) : String(p.value),
    scope: p.scope, scope_value: p.scope_value ?? "",
    starts_at: new Date(p.starts_at).toISOString().slice(0, 10),
    ends_at: p.ends_at ? new Date(p.ends_at).toISOString().slice(0, 10) : "",
    usage_limit: p.usage_limit != null ? String(p.usage_limit) : "",
    per_customer_limit: p.per_customer_limit != null ? String(p.per_customer_limit) : "",
    channel: p.channel, stackable: p.stackable, status: p.status,
  };
}

function formToBody(f: PromoForm): Record<string, unknown> {
  const value = f.type === "fixed_off" ? Math.round(parseFloat(f.value) * 100) : parseFloat(f.value);
  return {
    name: f.name.trim(), code: f.code.trim().toUpperCase() || null,
    type: f.type, value, scope: f.scope,
    scope_value: f.scope_value.trim() || null,
    starts_at: new Date(f.starts_at).getTime(),
    ends_at: f.ends_at ? new Date(f.ends_at).getTime() : null,
    usage_limit: f.usage_limit ? parseInt(f.usage_limit) : null,
    per_customer_limit: f.per_customer_limit ? parseInt(f.per_customer_limit) : null,
    channel: f.channel, stackable: f.stackable, status: f.status,
  };
}

function PromoFormModal({ initial, onSave, onClose }: {
  initial?: Promotion;
  onSave: (b: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<PromoForm>(initial ? promoToForm(initial) : emptyForm());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof PromoForm>(k: K, v: PromoForm[K]) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setErr("Name is required."); return; }
    if (form.type !== "bogo" && (!form.value || isNaN(parseFloat(form.value)))) {
      setErr("Value is required."); return;
    }
    setSaving(true); setErr(null);
    try { await onSave(formToBody(form)); onClose(); }
    catch (ex) { setErr(ex instanceof ApiResponseError ? ex.message : "Save failed."); setSaving(false); }
  };

  const inp = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">{initial ? "Edit campaign" : "New campaign"}</h2>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-xl text-slate-400 hover:bg-slate-100">&times;</button>
        </div>
        <form id="promo-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Campaign name <span className="text-red-500">*</span></label>
            <input type="text" value={form.name} onChange={e => set("name", e.target.value)} placeholder="Summer Sale 20% Off" className={inp} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Coupon code</label>
              <input type="text" value={form.code} onChange={e => set("code", e.target.value.toUpperCase())}
                placeholder="SUMMER20 (blank = auto-apply)" className={`${inp} font-mono`} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Status</label>
              <select value={form.status} onChange={e => set("status", e.target.value as PromoStatus)} className={inp}>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="scheduled">Scheduled</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Discount type</label>
              <select value={form.type} onChange={e => { set("type", e.target.value as PromoType); set("value", ""); }} className={inp}>
                <option value="percent_off">Percentage off (%)</option>
                <option value="fixed_off">Fixed amount off ($)</option>
                <option value="bogo">Buy 1 Get 1 Free</option>
                <option value="bundle">Bundle deal</option>
                <option value="flash">Flash sale</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {form.type === "percent_off" || form.type === "flash" ? "Percent off" : form.type === "fixed_off" ? "Amount off ($)" : form.type === "bundle" ? "Min items in bundle" : "N/A"}
              </label>
              {form.type !== "bogo" ? (
                <input type="number" step={form.type === "fixed_off" ? "0.01" : "1"} min="0"
                  value={form.value} onChange={e => set("value", e.target.value)} placeholder="0" className={inp} />
              ) : (
                <input readOnly value="Buy 1 Get 1 Free" className={`${inp} bg-slate-50 text-slate-500`} />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Applies to</label>
              <select value={form.scope} onChange={e => { set("scope", e.target.value as PromoScope); set("scope_value", ""); }} className={inp}>
                <option value="all">All products</option>
                <option value="category">Specific category</option>
                <option value="product">Specific product SKU</option>
              </select>
            </div>
            {form.scope !== "all" && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  {form.scope === "category" ? "Category name" : "Product SKU"}
                </label>
                <input type="text" value={form.scope_value} onChange={e => set("scope_value", e.target.value)}
                  placeholder={form.scope === "category" ? "Beverages" : "BEV-001"} className={inp} />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Channel</label>
              <select value={form.channel} onChange={e => set("channel", e.target.value as PromoForm["channel"])} className={inp}>
                <option value="all">All channels</option>
                <option value="pos">POS only</option>
                <option value="ecommerce">Ecommerce only</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Stackable with others?</label>
              <select value={form.stackable ? "yes" : "no"} onChange={e => set("stackable", e.target.value === "yes")} className={inp}>
                <option value="yes">Yes — can stack</option>
                <option value="no">No — exclusive</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Starts</label>
              <input type="date" value={form.starts_at} onChange={e => set("starts_at", e.target.value)} className={inp} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Ends (optional)</label>
              <input type="date" value={form.ends_at} onChange={e => set("ends_at", e.target.value)} className={inp} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Total usage limit</label>
              <input type="number" min="1" step="1" value={form.usage_limit}
                onChange={e => set("usage_limit", e.target.value)} placeholder="Unlimited" className={inp} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Per-customer limit</label>
              <input type="number" min="1" step="1" value={form.per_customer_limit}
                onChange={e => set("per_customer_limit", e.target.value)} placeholder="Unlimited" className={inp} />
            </div>
          </div>
        </form>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose} className="min-h-[40px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" form="promo-form" disabled={saving}
            className="min-h-[40px] rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-[#4B4DC8] disabled:opacity-60">
            {saving ? "Saving…" : initial ? "Save changes" : "Create campaign"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Campaigns Tab ─────────────────────────────────────────────────────────────

function CampaignsTab() {
  const [promos, setPromos]   = useState<Promotion[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState("");
  const [status, setStatus]   = useState("");
  const [showCreate, setShowCreate]     = useState(false);
  const [editTarget, setEditTarget]     = useState<Promotion | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Promotion | null>(null);
  const [deleting, setDeleting]         = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams({ limit: "50" });
      if (status) p.set("status", status);
      if (search) p.set("q", search);
      const r = await apiGet<{ items: Promotion[]; total: number }>(`/api/v1/promotions?${p}`);
      setPromos(r.items ?? []); setTotal(r.total ?? 0);
    } catch (err: unknown) {
      setError(err instanceof ApiResponseError ? err.message : "Failed to load campaigns.");
    } finally { setLoading(false); }
  }, [search, status]);

  useEffect(() => { void load(); }, [load]);

  const activeCount    = promos.filter(p => promoStatusFor(p) === "active").length;
  const scheduledCount = promos.filter(p => promoStatusFor(p) === "scheduled").length;
  const expiredCount   = promos.filter(p => promoStatusFor(p) === "expired").length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total",     value: total,          cls: "text-slate-900" },
          { label: "Active",    value: activeCount,    cls: "text-emerald-700" },
          { label: "Scheduled", value: scheduledCount, cls: "text-blue-700" },
          { label: "Expired",   value: expiredCount,   cls: "text-slate-400" },
        ].map(m => (
          <div key={m.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{m.label}</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${m.cls}`}>{m.value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-3.5">
          <input type="search" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search campaigns…"
            className="h-9 w-56 rounded-lg border border-slate-200 px-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20" />
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 focus:border-brand-600 focus:outline-none">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="scheduled">Scheduled</option>
            <option value="expired">Expired</option>
            <option value="draft">Draft</option>
          </select>
          <Can permission="promotions.manage">
            <button type="button" onClick={() => setShowCreate(true)}
              className="ml-auto rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8]">
              + New Campaign
            </button>
          </Can>
        </div>

        {loading ? <Skeleton /> : error ? (
          <p className="px-5 py-6 text-sm text-red-600">{error}</p>
        ) : promos.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-slate-500">No campaigns found.</p>
            <button type="button" onClick={() => setShowCreate(true)} className="mt-1 text-sm font-medium text-brand-600 hover:underline">
              Create your first campaign →
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500">
                <tr>
                  <th className="px-5 py-3">Campaign</th>
                  <th className="px-5 py-3">Code</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Value</th>
                  <th className="px-5 py-3">Scope</th>
                  <th className="px-5 py-3">Channel</th>
                  <th className="px-5 py-3">Dates</th>
                  <th className="px-5 py-3 text-right">Usage</th>
                  <th className="px-5 py-3">Stack</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {promos.map(p => {
                  const computed = promoStatusFor(p);
                  const usagePct = p.usage_limit ? Math.min(100, (p.usage_count / p.usage_limit) * 100) : null;
                  return (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <p className="font-semibold text-slate-900">{p.name}</p>
                        <p className="text-xs text-slate-400">{TYPE_LABELS[p.type]}</p>
                      </td>
                      <td className="px-5 py-3.5">
                        {p.code
                          ? <code className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-bold text-brand-600">{p.code}</code>
                          : <span className="text-xs text-slate-400">Auto-apply</span>}
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge label={TYPE_LABELS[p.type]} cls={TYPE_CLS[p.type]} />
                      </td>
                      <td className="px-5 py-3.5 font-semibold text-slate-900">{formatValue(p.type, p.value)}</td>
                      <td className="px-5 py-3.5 text-xs text-slate-500">
                        {p.scope === "all" ? "All products" : `${p.scope === "category" ? "Cat:" : "SKU:"} ${p.scope_value}`}
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge label={p.channel === "all" ? "All channels" : p.channel.toUpperCase()} cls={CHANNEL_CLS[p.channel]} />
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-500">
                        {fmtDate(p.starts_at)}
                        {p.ends_at && <><br /><span className="text-slate-400">→ {fmtDate(p.ends_at)}</span></>}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className={`text-sm tabular-nums ${usagePct === 100 ? "font-bold text-orange-600" : "text-slate-700"}`}>
                          {p.usage_count.toLocaleString()}
                        </span>
                        {p.usage_limit && <span className="text-xs text-slate-400"> / {p.usage_limit.toLocaleString()}</span>}
                        {usagePct !== null && (
                          <div className="ml-auto mt-1 h-1 w-16 overflow-hidden rounded-full bg-slate-100">
                            <div className={`h-full rounded-full ${usagePct >= 90 ? "bg-orange-500" : "bg-brand-600"}`}
                              style={{ width: `${usagePct}%` }} />
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs font-semibold ${p.stackable ? "text-emerald-600" : "text-slate-400"}`}>
                          {p.stackable ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge label={computed.charAt(0).toUpperCase() + computed.slice(1)} cls={STATUS_CLS[computed]} />
                      </td>
                      <td className="px-5 py-3.5">
                        <Can permission="promotions.manage">
                          <div className="flex items-center gap-1.5">
                            <button type="button" onClick={() => setEditTarget(p)}
                              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">
                              Edit
                            </button>
                            <button type="button" onClick={() => setDeleteTarget(p)}
                              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
                              Delete
                            </button>
                          </div>
                        </Can>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && promos.length > 0 && (
          <div className="border-t border-slate-200 px-5 py-2.5 text-xs text-slate-400">
            {promos.length} of {total} campaigns
          </div>
        )}
      </div>

      {showCreate && (
        <PromoFormModal
          onSave={async body => { await apiPost("/api/v1/promotions", body); await load(); }}
          onClose={() => setShowCreate(false)}
        />
      )}
      {editTarget && (
        <PromoFormModal
          initial={editTarget}
          onSave={async body => { await apiPatch(`/api/v1/promotions/${editTarget.id}`, body); await load(); }}
          onClose={() => setEditTarget(null)}
        />
      )}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDeleteTarget(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-900">Delete &ldquo;{deleteTarget.name}&rdquo;?</h2>
            <p className="mt-2 text-sm text-slate-600">This permanently removes the campaign and all its coupon codes. This cannot be undone.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteTarget(null)}
                className="min-h-[40px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try { await apiDelete(`/api/v1/promotions/${deleteTarget.id}`); setDeleteTarget(null); await load(); }
                  catch { /* keep modal open */ }
                  finally { setDeleting(false); }
                }}
                className="min-h-[40px] rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60">
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Coupon Codes Tab ──────────────────────────────────────────────────────────

function CouponsTab() {
  const [codes, setCodes]     = useState<CouponCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState("");
  const [filter, setFilter]   = useState<"all" | "used" | "unused">("all");
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await apiGet<{ items: CouponCode[] }>("/api/v1/promotions/coupons");
      setCodes(r.items ?? []);
    } catch (err: unknown) {
      setError(err instanceof ApiResponseError ? err.message : "Failed to load coupon codes.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return codes.filter(c => {
      if (filter === "used" && !c.used) return false;
      if (filter === "unused" && c.used) return false;
      return !q || c.code.toLowerCase().includes(q) || c.promotion_name.toLowerCase().includes(q);
    });
  }, [codes, search, filter]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await apiPost("/api/v1/promotions/coupons/generate", { count: 10, type: "single_use" });
      await load();
    } catch { /* ignore */ }
    finally { setGenerating(false); }
  };

  const usedCount   = codes.filter(c => c.used).length;
  const unusedCount = codes.filter(c => !c.used).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Codes", value: codes.length, cls: "text-slate-900" },
          { label: "Used",        value: usedCount,    cls: "text-slate-500" },
          { label: "Available",   value: unusedCount,  cls: "text-emerald-700" },
        ].map(m => (
          <div key={m.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{m.label}</p>
            <p className={`mt-1 text-2xl font-bold ${m.cls}`}>{m.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50 px-5 py-3 text-sm text-blue-700">
        Single-use codes are invalidated after one redemption. Multi-use codes can be redeemed up to the campaign&apos;s usage limit.
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-3.5">
          <input type="search" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search codes…"
            className="h-9 w-48 rounded-lg border border-slate-200 px-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20" />
          {(["all", "used", "unused"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${filter === f ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <Can permission="promotions.manage">
            <button type="button" onClick={() => void handleGenerate()} disabled={generating}
              className="ml-auto rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {generating ? "Generating…" : "Bulk Generate (10)"}
            </button>
            <button type="button"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8]">
              + New Code
            </button>
          </Can>
        </div>

        {loading ? <Skeleton /> : error ? <ErrorBanner msg={error} /> : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500">
              <tr>
                <th className="px-5 py-3">Code</th>
                <th className="px-5 py-3">Campaign</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Redeemed by</th>
                <th className="px-5 py-3">Redeemed at</th>
                <th className="px-5 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(c => (
                <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5">
                    <code className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-bold text-brand-600">{c.code}</code>
                  </td>
                  <td className="px-5 py-3.5 text-slate-700">{c.promotion_name}</td>
                  <td className="px-5 py-3.5">
                    <Badge label={c.type === "single_use" ? "Single-use" : "Multi-use"}
                      cls={c.type === "single_use" ? "bg-purple-100 text-purple-700" : "bg-teal-100 text-teal-700"} />
                  </td>
                  <td className="px-5 py-3.5">
                    <Badge label={c.used ? "Used" : "Available"}
                      cls={c.used ? "bg-slate-100 text-slate-500" : "bg-emerald-100 text-emerald-700"} />
                  </td>
                  <td className="px-5 py-3.5 text-slate-600">{c.customer_name ?? "—"}</td>
                  <td className="px-5 py-3.5 text-xs text-slate-500">{c.used_at ? fmtDateTime(c.used_at) : "—"}</td>
                  <td className="px-5 py-3.5 text-xs text-slate-500">{fmtDate(c.created_at)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-sm text-slate-400">No codes match your search.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Flash Sales Tab ───────────────────────────────────────────────────────────

function FlashSalesTab() {
  const [sales, setSales]     = useState<FlashSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    void apiGet<{ items: FlashSale[] }>("/api/v1/promotions/flash-sales").then(r => {
      setSales(r.items ?? []); setLoading(false);
    }).catch((err: unknown) => { setError((err as Error).message ?? "Failed to load"); setLoading(false); });
  }, []);

  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const SALE_STATUS_CLS: Record<FlashSale["status"], string> = {
    upcoming: "bg-blue-100 text-blue-700",
    live:     "bg-red-100 text-red-700",
    ended:    "bg-slate-100 text-slate-500",
  };

  if (error) return <ErrorBanner msg={error} />;
  if (loading) return <Skeleton />;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">
        Flash sales apply time-limited discounts across all channels simultaneously. Live sales show a real-time countdown.
      </div>
      <div className="space-y-3">
        {sales.map(s => (
          <div key={s.id} className={`overflow-hidden rounded-xl border shadow-sm ${s.status === "live" ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-slate-900">{s.name}</p>
                  <Badge label={s.status === "live" ? "LIVE" : s.status.charAt(0).toUpperCase() + s.status.slice(1)} cls={SALE_STATUS_CLS[s.status]} />
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {s.discount_pct}% off · {s.scope === "all" ? "All products" : `${s.scope === "category" ? "Category" : "SKU"}: ${s.scope_value}`}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {fmtDateTime(s.starts_at)} → {fmtDateTime(s.ends_at)}
                </p>
              </div>
              <div className="text-right shrink-0">
                {s.status === "live" && (
                  <div className="mb-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-red-500">Ends in</p>
                    <Countdown endsAt={s.ends_at} />
                  </div>
                )}
                <p className="text-sm font-semibold text-slate-900">{s.units_sold.toLocaleString()} sold</p>
                <p className="text-xs text-slate-400">{formatMoney(s.revenue_cents)} revenue</p>
              </div>
              <Can permission="promotions.manage">
                <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  {s.status === "upcoming" ? "Edit" : "View"}
                </button>
              </Can>
            </div>
          </div>
        ))}
        {sales.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-400">No flash sales configured.</p>
        )}
      </div>
      <Can permission="promotions.manage">
        <div className="flex justify-end">
          <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8]">
            + Create Flash Sale
          </button>
        </div>
      </Can>
    </div>
  );
}

// ── Bundle Rules Tab ──────────────────────────────────────────────────────────

function BundlesTab() {
  const [bundles, setBundles] = useState<BundleRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ items: BundleRule[] }>("/api/v1/promotions/bundles").then(r => {
      setBundles(r.items ?? []); setLoading(false);
    }).catch((err: unknown) => { setError((err as Error).message ?? "Failed to load"); setLoading(false); });
  }, []);

  if (error) return <ErrorBanner msg={error} />;
  if (loading) return <Skeleton />;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-teal-100 bg-teal-50 px-5 py-3 text-sm text-teal-700">
        Bundle rules trigger a discount when all required products are in the same cart. Min-item count can be configured per bundle.
      </div>
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500">{bundles.length} bundle rules</p>
        <Can permission="promotions.manage">
          <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8]">
            + New Bundle Rule
          </button>
        </Can>
      </div>
      <div className="space-y-3">
        {bundles.map(b => (
          <div key={b.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-slate-900">{b.name}</p>
                  <Badge label={b.active ? "Active" : "Inactive"}
                    cls={b.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"} />
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  Buy {b.min_items}+ items from this bundle → {b.discount_pct}% off · {b.usage_count.toLocaleString()} uses
                </p>
              </div>
              <Can permission="promotions.manage">
                <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Edit</button>
              </Can>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {b.products.map(p => (
                <div key={p.sku} className="flex items-center gap-1.5 rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5">
                  <span className="font-mono text-[10px] text-slate-400">{p.sku}</span>
                  <span className="text-xs text-slate-700">{p.name}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {bundles.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-400">No bundle rules configured.</p>
        )}
      </div>
    </div>
  );
}

// ── Stackability Tab ──────────────────────────────────────────────────────────

function StackabilityTab() {
  const [rules, setRules]     = useState<StackRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ items: StackRule[] }>("/api/v1/promotions/stackability").then(r => {
      setRules(r.items ?? []); setLoading(false);
    }).catch((err: unknown) => { setError((err as Error).message ?? "Failed to load"); setLoading(false); });
  }, []);

  if (error) return <ErrorBanner msg={error} />;
  if (loading) return <Skeleton />;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-100 bg-amber-50 px-5 py-3 text-sm text-amber-700">
        Stackability rules define which promotions can be applied together in a single transaction. If no rule exists for a pair, the system uses the campaign&apos;s default stackable flag.
      </div>
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500">{rules.length} stacking rules</p>
        <Can permission="promotions.manage">
          <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8]">
            + New Rule
          </button>
        </Can>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500">
            <tr>
              <th className="px-5 py-3">Promotion A</th>
              <th className="px-5 py-3">Promotion B</th>
              <th className="px-5 py-3">Can Stack?</th>
              <th className="px-5 py-3">Priority</th>
              <th className="px-5 py-3">Note</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rules.map(r => (
              <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-5 py-3.5 font-medium text-slate-900">{r.promo_a_name}</td>
                <td className="px-5 py-3.5 font-medium text-slate-900">{r.promo_b_name}</td>
                <td className="px-5 py-3.5">
                  <Badge
                    label={r.can_stack ? "✓ Can stack" : "✗ Exclusive"}
                    cls={r.can_stack ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}
                  />
                </td>
                <td className="px-5 py-3.5 text-slate-600">{r.priority}</td>
                <td className="px-5 py-3.5 text-xs text-slate-500">{r.note ?? "—"}</td>
                <td className="px-5 py-3.5">
                  <Can permission="promotions.manage">
                    <button className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      Edit
                    </button>
                  </Can>
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr><td colSpan={6} className="py-10 text-center text-sm text-slate-400">No stackability rules defined. Campaign defaults apply.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Analytics Tab ─────────────────────────────────────────────────────────────

function AnalyticsTab() {
  const [data, setData]       = useState<PromoAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    void apiGet<PromoAnalytics>("/api/v1/promotions/analytics").then(d => {
      setData(d); setLoading(false);
    }).catch((err: unknown) => { setError((err as Error).message ?? "Failed to load"); setLoading(false); });
  }, []);

  if (error) return <ErrorBanner msg={error} />;
  if (loading) return <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />)}</div>;
  if (!data) return null;

  const maxRedemptions = Math.max(...data.redemptions_by_day.map(d => d.count), 1);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Total Redemptions",  value: data.total_redemptions.toLocaleString(),               sub: "all time" },
          { label: "Revenue Impact",     value: formatMoney(data.total_revenue_impact_cents),           sub: "discount given" },
          { label: "Avg Order Lift",     value: `+${data.avg_order_lift_pct.toFixed(1)}%`,             sub: "vs no-promo orders" },
          { label: "Channel Split",      value: `${data.channel_split.pos}% POS`,                      sub: `${data.channel_split.ecommerce}% ecommerce` },
        ].map(m => (
          <div key={m.label} className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{m.label}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{m.value}</p>
            {m.sub && <p className="mt-0.5 text-xs text-slate-400">{m.sub}</p>}
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Redemptions — Last 14 Days</h3>
        <div className="flex h-32 items-end gap-1">
          {data.redemptions_by_day.map(d => (
            <div key={d.date} className="group relative flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full rounded-t bg-brand-600 transition-opacity group-hover:opacity-80"
                style={{ height: `${Math.max(4, (d.count / maxRedemptions) * 100)}%` }}
              />
              <span className="text-[9px] text-slate-400 rotate-45 origin-left mt-1 hidden group-hover:block absolute -bottom-4">
                {d.date.slice(5)}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-between text-[10px] text-slate-400">
          <span>{data.redemptions_by_day[0]?.date ?? ""}</span>
          <span>{data.redemptions_by_day[data.redemptions_by_day.length - 1]?.date ?? ""}</span>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-slate-900">Top Campaigns by Redemption</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500">
            <tr>
              <th className="px-5 py-3">Campaign</th>
              <th className="px-5 py-3 text-right">Redemptions</th>
              <th className="px-5 py-3 text-right">Revenue Impact</th>
              <th className="px-5 py-3">Share</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.top_promotions.map((p, i) => {
              const pct = data.total_redemptions > 0 ? Math.round((p.redemptions / data.total_redemptions) * 100) : 0;
              return (
                <tr key={i} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5 font-medium text-slate-900">{p.name}</td>
                  <td className="px-5 py-3.5 text-right font-semibold text-slate-900">{p.redemptions.toLocaleString()}</td>
                  <td className="px-5 py-3.5 text-right text-red-600">{formatMoney(p.revenue_cents)}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-slate-500">{pct}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PromotionsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("campaigns");

  return (
    <EnterpriseShell
      active="promotions"
      title="Promotion Engine"
      subtitle="Campaigns, coupon codes, flash sales, bundles, and stackability rules"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-7xl space-y-0 px-4 py-5 sm:px-6">
        {/* Tabs */}
        <div className="border-b border-slate-200">
          <nav className="-mb-px flex gap-1 overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === t.key
                    ? "border-brand-600 text-brand-600"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="pt-5">
          {activeTab === "campaigns"    && <CampaignsTab />}
          {activeTab === "coupons"      && <CouponsTab />}
          {activeTab === "flash-sales"  && <FlashSalesTab />}
          {activeTab === "bundles"      && <BundlesTab />}
          {activeTab === "stackability" && <StackabilityTab />}
          {activeTab === "analytics"    && <AnalyticsTab />}
        </div>
      </div>
    </EnterpriseShell>
  );
}
