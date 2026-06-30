"use client";

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { apiGet, apiPost, apiPatch, apiDelete, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/date";

// ── Types ─────────────────────────────────────────────────────────────────────

type PromoType = "percent_off" | "fixed_off" | "bogo" | "bundle";
type PromoStatus = "active" | "scheduled" | "expired" | "draft";
type PromoScope = "all" | "category" | "product";

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
  created_at: number;
}

interface PromotionsResponse { items: Promotion[]; total: number }

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<PromoStatus, "green" | "blue" | "gray" | "yellow"> = {
  active:    "green",
  scheduled: "blue",
  expired:   "gray",
  draft:     "yellow",
};

const TYPE_LABELS: Record<PromoType, string> = {
  percent_off: "% Off",
  fixed_off:   "$ Off",
  bogo:        "Buy 1 Get 1",
  bundle:      "Bundle deal",
};

function formatValue(p: Promotion): string {
  if (p.type === "percent_off") return `${p.value}% off`;
  if (p.type === "fixed_off")   return `${formatMoney(p.value)} off`;
  if (p.type === "bogo")        return "Buy 1 Get 1 Free";
  return `Bundle: ${p.value} items`;
}

function promoStatusFor(p: Promotion): PromoStatus {
  if (p.status === "draft") return "draft";
  const now = Date.now();
  if (now < p.starts_at) return "scheduled";
  if (p.ends_at && now > p.ends_at) return "expired";
  return "active";
}

// ── Form modal ────────────────────────────────────────────────────────────────

interface PromoForm {
  name: string; code: string; type: PromoType;
  value: string; scope: PromoScope; scope_value: string;
  starts_at: string; ends_at: string; usage_limit: string; status: PromoStatus;
}

function emptyForm(): PromoForm {
  const today = new Date().toISOString().slice(0, 10);
  return { name: "", code: "", type: "percent_off", value: "", scope: "all", scope_value: "", starts_at: today, ends_at: "", usage_limit: "", status: "active" };
}

function promoToForm(p: Promotion): PromoForm {
  return {
    name: p.name,
    code: p.code ?? "",
    type: p.type,
    value: p.type === "fixed_off" ? String(p.value / 100) : String(p.value),
    scope: p.scope,
    scope_value: p.scope_value ?? "",
    starts_at: new Date(p.starts_at).toISOString().slice(0, 10),
    ends_at: p.ends_at ? new Date(p.ends_at).toISOString().slice(0, 10) : "",
    usage_limit: p.usage_limit != null ? String(p.usage_limit) : "",
    status: p.status,
  };
}

function formToBody(f: PromoForm): Record<string, unknown> {
  const value = f.type === "fixed_off" ? Math.round(parseFloat(f.value) * 100) : parseFloat(f.value);
  return {
    name: f.name.trim(),
    code: f.code.trim().toUpperCase() || null,
    type: f.type,
    value,
    scope: f.scope,
    scope_value: f.scope_value.trim() || null,
    starts_at: new Date(f.starts_at).getTime(),
    ends_at: f.ends_at ? new Date(f.ends_at).getTime() : null,
    usage_limit: f.usage_limit ? parseInt(f.usage_limit) : null,
    status: f.status,
  };
}

function PromoFormModal({
  initial, onSave, onClose,
}: { initial?: Promotion; onSave: (b: Record<string, unknown>) => Promise<void>; onClose: () => void }) {
  const [form, setForm] = useState<PromoForm>(initial ? promoToForm(initial) : emptyForm());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof PromoForm>(k: K, v: PromoForm[K]) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setErr("Name is required."); return; }
    if (!form.value || isNaN(parseFloat(form.value))) { setErr("Value is required."); return; }
    setSaving(true); setErr(null);
    try { await onSave(formToBody(form)); onClose(); }
    catch (ex) { setErr(ex instanceof ApiResponseError ? ex.message : "Save failed."); setSaving(false); }
  };

  const cls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">{initial ? "Edit promotion" : "New promotion"}</h2>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-xl text-gray-400 hover:bg-gray-100">&times;</button>
        </div>
        <form id="promo-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Promotion name <span className="text-red-500">*</span></label>
            <input type="text" value={form.name} onChange={e => set("name", e.target.value)} placeholder="Summer Sale 20% Off" className={cls} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Coupon code</label>
              <input type="text" value={form.code} onChange={e => set("code", e.target.value.toUpperCase())} placeholder="SUMMER20" className={`${cls} font-mono`} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Status</label>
              <select value={form.status} onChange={e => set("status", e.target.value as PromoStatus)} className={cls}>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="scheduled">Scheduled</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Discount type</label>
              <select value={form.type} onChange={e => { set("type", e.target.value as PromoType); set("value", ""); }} className={cls}>
                <option value="percent_off">Percentage off (%)</option>
                <option value="fixed_off">Fixed amount off ($)</option>
                <option value="bogo">Buy 1 Get 1 Free</option>
                <option value="bundle">Bundle deal</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {form.type === "percent_off" ? "Percent off" : form.type === "fixed_off" ? "Amount off ($)" : form.type === "bundle" ? "Min items in bundle" : "N/A"}
              </label>
              {form.type !== "bogo" ? (
                <input type="number" step={form.type === "fixed_off" ? "0.01" : "1"} min="0"
                  value={form.value} onChange={e => set("value", e.target.value)} placeholder="0" className={cls} />
              ) : (
                <input readOnly value="Buy 1 Get 1 Free" className={`${cls} bg-gray-50 text-gray-500`} />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Applies to</label>
              <select value={form.scope} onChange={e => { set("scope", e.target.value as PromoScope); set("scope_value", ""); }} className={cls}>
                <option value="all">All products</option>
                <option value="category">Specific category</option>
                <option value="product">Specific product SKU</option>
              </select>
            </div>
            {form.scope !== "all" && (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  {form.scope === "category" ? "Category name" : "Product SKU"}
                </label>
                <input type="text" value={form.scope_value} onChange={e => set("scope_value", e.target.value)}
                  placeholder={form.scope === "category" ? "Beverages" : "BEV-001"} className={cls} />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Starts</label>
              <input type="date" value={form.starts_at} onChange={e => set("starts_at", e.target.value)} className={cls} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Ends (optional)</label>
              <input type="date" value={form.ends_at} onChange={e => set("ends_at", e.target.value)} className={cls} />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Usage limit (optional)</label>
            <input type="number" min="1" step="1" value={form.usage_limit} onChange={e => set("usage_limit", e.target.value)}
              placeholder="Unlimited" className={cls} />
          </div>
        </form>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button type="button" onClick={onClose} className="min-h-[40px] rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="submit" form="promo-form" disabled={saving}
            className="min-h-[40px] rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
            {saving ? "Saving…" : initial ? "Save changes" : "Create promotion"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PromotionsPage() {
  const [promos, setPromos]   = useState<Promotion[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const [filterStatus, setFilterStatus] = useState<string>("");
  const [search, setSearch]             = useState<string>("");

  const [showCreate, setShowCreate]   = useState(false);
  const [editTarget, setEditTarget]   = useState<Promotion | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Promotion | null>(null);
  const [deleting, setDeleting]       = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (filterStatus) params.set("status", filterStatus);
      if (search)       params.set("q",      search);
      const data = await apiGet<PromotionsResponse>(`/api/v1/promotions?${params}`);
      setPromos(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Failed to load promotions.");
    } finally { setLoading(false); }
  }, [filterStatus, search]);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async (body: Record<string, unknown>) => {
    await apiPost("/api/v1/promotions", body);
    await load();
  };

  const handleEdit = async (body: Record<string, unknown>) => {
    if (!editTarget) return;
    await apiPatch(`/api/v1/promotions/${editTarget.id}`, body);
    await load();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true); setDeleteError(null);
    try {
      await apiDelete(`/api/v1/promotions/${deleteTarget.id}`);
      setDeleteTarget(null);
      await load();
    } catch {
      setDeleteError("Delete failed.");
    } finally { setDeleting(false); }
  };

  const activeCount    = promos.filter(p => promoStatusFor(p) === "active").length;
  const scheduledCount = promos.filter(p => promoStatusFor(p) === "scheduled").length;
  const expiredCount   = promos.filter(p => promoStatusFor(p) === "expired").length;

  return (
    <EnterpriseShell active="catalog" title="Promotions" subtitle="Discount rules, coupon codes, and bundle deals" contentClassName="overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 sm:px-6">

        {/* Metrics */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Total", value: total, color: "text-gray-900" },
            { label: "Active now", value: activeCount, color: "text-green-700" },
            { label: "Scheduled", value: scheduledCount, color: "text-blue-700" },
            { label: "Expired", value: expiredCount, color: "text-gray-400" },
          ].map(m => (
            <div key={m.label} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{m.label}</p>
              <p className={`mt-1 text-2xl font-bold tabular-nums ${m.color}`}>{m.value}</p>
            </div>
          ))}
        </div>

        <Card className="overflow-hidden p-0">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-3">
            <input type="search" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search promotions…"
              className="min-h-[40px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="min-h-[40px] rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="scheduled">Scheduled</option>
              <option value="expired">Expired</option>
              <option value="draft">Draft</option>
            </select>
            <button type="button" onClick={() => setShowCreate(true)}
              className="min-h-[40px] rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              + New promotion
            </button>
          </div>

          {/* Table */}
          {loading ? (
            <div className="divide-y divide-gray-100">
              {[1,2,3,4].map(i => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <div className="h-4 flex-1 animate-pulse rounded bg-gray-100" />
                  <div className="h-4 w-20 animate-pulse rounded bg-gray-100" />
                  <div className="h-4 w-16 animate-pulse rounded bg-gray-100" />
                </div>
              ))}
            </div>
          ) : error ? (
            <p role="alert" className="px-4 py-6 text-sm text-red-700">{error}</p>
          ) : promos.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-sm font-medium text-gray-500">No promotions yet.</p>
              <button type="button" onClick={() => setShowCreate(true)}
                className="mt-2 text-sm font-medium text-blue-600 hover:underline">
                Create your first promotion →
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3">Promotion</th>
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Value</th>
                    <th className="px-4 py-3">Scope</th>
                    <th className="px-4 py-3">Dates</th>
                    <th className="px-4 py-3 text-right">Usage</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {promos.map(p => {
                    const computed = promoStatusFor(p);
                    const usagePct = p.usage_limit ? Math.min(100, (p.usage_count / p.usage_limit) * 100) : null;
                    return (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{p.name}</p>
                          <p className="text-xs text-gray-400">{TYPE_LABELS[p.type]}</p>
                        </td>
                        <td className="px-4 py-3">
                          {p.code ? (
                            <code className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-bold text-blue-700">{p.code}</code>
                          ) : (
                            <span className="text-gray-400 text-xs">Auto-apply</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{TYPE_LABELS[p.type]}</td>
                        <td className="px-4 py-3 font-medium text-gray-900">{formatValue(p)}</td>
                        <td className="px-4 py-3">
                          {p.scope === "all" ? (
                            <span className="text-gray-500 text-xs">All products</span>
                          ) : (
                            <span className="text-xs">
                              <span className="text-gray-400">{p.scope === "category" ? "Cat:" : "SKU:"}</span>{" "}
                              <span className="font-medium text-gray-700">{p.scope_value}</span>
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          <span>{fmtDate(p.starts_at)}</span>
                          {p.ends_at && <><br /><span className="text-gray-400">→ {fmtDate(p.ends_at)}</span></>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={clsx("text-sm tabular-nums", usagePct === 100 ? "font-semibold text-orange-600" : "text-gray-700")}>
                            {p.usage_count}
                          </span>
                          {p.usage_limit && (
                            <span className="text-xs text-gray-400"> / {p.usage_limit}</span>
                          )}
                          {usagePct !== null && (
                            <div className="mt-1 h-1 w-16 rounded-full bg-gray-100 ml-auto">
                              <div className={clsx("h-1 rounded-full", usagePct >= 90 ? "bg-orange-500" : "bg-blue-500")}
                                style={{ width: `${usagePct}%` }} />
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={STATUS_BADGE[computed]}>
                            {computed.charAt(0).toUpperCase() + computed.slice(1)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button type="button" onClick={() => setEditTarget(p)}
                              className="min-h-[32px] rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100">
                              Edit
                            </button>
                            <button type="button" onClick={() => setDeleteTarget(p)}
                              className="min-h-[32px] rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && promos.length > 0 && (
            <div className="border-t border-gray-200 px-4 py-3 text-xs text-gray-500">
              {promos.length} of {total} promotions
            </div>
          )}
        </Card>
      </div>

      {/* Modals */}
      {showCreate && <PromoFormModal onSave={handleCreate} onClose={() => setShowCreate(false)} />}
      {editTarget  && <PromoFormModal initial={editTarget} onSave={handleEdit} onClose={() => setEditTarget(null)} />}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDeleteTarget(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-gray-900">Delete &ldquo;{deleteTarget.name}&rdquo;?</h2>
            <p className="mt-2 text-sm text-gray-600">This will permanently remove the promotion. This action cannot be undone.</p>
            {deleteError && <p className="mt-3 text-sm text-red-700">{deleteError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteTarget(null)}
                className="min-h-[40px] rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={() => void handleDelete()} disabled={deleting}
                className="min-h-[40px] rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60">
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </EnterpriseShell>
  );
}
