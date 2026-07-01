"use client";
import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { apiGet, apiPost, apiPatch, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { ProductBatch, ExpirySummary, ExpiryStatus } from "@/api-client/types";
import { fmtDate } from "@/lib/date";

type BadgeVariant = "gray" | "blue" | "yellow" | "green" | "red" | "purple";

const STATUS_BADGE: Record<string, BadgeVariant> = {
  expired: "red",
  critical: "yellow",
  warning: "blue",
  ok: "green",
};
const STATUS_LABEL: Record<string, string> = {
  expired: "Expired",
  critical: "Critical (≤7d)",
  warning: "Warning (≤30d)",
  ok: "OK",
};

function daysLabel(days: number | null): string {
  if (days == null) return "No expiry";
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return "Today";
  return `${days}d left`;
}

function ExpiryBar({ pct }: { pct: number }) {
  const color = pct <= 0 ? "bg-red-500" : pct <= 25 ? "bg-amber-500" : pct <= 60 ? "bg-yellow-400" : "bg-emerald-500";
  return (
    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

interface AddBatchForm {
  product_id: string;
  batch_number: string;
  expiry_date_str: string;
  qty: string;
  cost_cents_str: string;
  supplier_name: string;
  notes: string;
}
const EMPTY_FORM: AddBatchForm = {
  product_id: "", batch_number: "", expiry_date_str: "", qty: "", cost_cents_str: "", supplier_name: "", notes: "",
};

function AddBatchModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<AddBatchForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const f = (k: keyof AddBatchForm, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      const expiryDate = form.expiry_date_str ? new Date(form.expiry_date_str).getTime() : null;
      await apiPost("/api/v1/product-batches", {
        product_id: form.product_id.trim(),
        batch_number: form.batch_number.trim() || undefined,
        expiry_date: expiryDate,
        qty: parseInt(form.qty, 10) || 0,
        cost_cents: Math.round(parseFloat(form.cost_cents_str || "0") * 100),
        supplier_name: form.supplier_name.trim() || null,
        notes: form.notes.trim() || null,
      });
      onSaved();
    } catch (ex) { setErr(ex instanceof ApiResponseError ? ex.message : "Failed to add batch."); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">Add Product Batch</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
        </div>
        <form id="add-batch-form" onSubmit={(e) => void handleSubmit(e)} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Product SKU / ID <span className="text-red-500">*</span></label>
            <input required value={form.product_id} onChange={(e) => f("product_id", e.target.value)}
              placeholder="Enter product SKU or ID"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Batch / Lot Number</label>
              <input value={form.batch_number} onChange={(e) => f("batch_number", e.target.value)}
                placeholder="LOT-2025-001"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Expiry Date</label>
              <input type="date" value={form.expiry_date_str} onChange={(e) => f("expiry_date_str", e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Quantity <span className="text-red-500">*</span></label>
              <input required type="number" min="0" value={form.qty} onChange={(e) => f("qty", e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Unit Cost ($)</label>
              <input type="number" min="0" step="0.01" value={form.cost_cents_str} onChange={(e) => f("cost_cents_str", e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Supplier</label>
            <input value={form.supplier_name} onChange={(e) => f("supplier_name", e.target.value)}
              placeholder="e.g. Core-Mark, McLane, KeHE"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <input value={form.notes} onChange={(e) => f("notes", e.target.value)}
              placeholder="Any notes about this batch…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </form>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-batch-form" disabled={saving}>
            {saving ? "Adding…" : "Add Batch"}
          </Button>
        </div>
      </div>
    </div>
  );
}

type FilterStatus = ExpiryStatus | "all";

const FILTER_OPTIONS: Array<{ value: FilterStatus; label: string }> = [
  { value: "all", label: "All Batches" },
  { value: "expired", label: "Expired" },
  { value: "critical", label: "Critical (≤7d)" },
  { value: "warning", label: "Warning (≤30d)" },
  { value: "ok", label: "OK" },
];

export default function ExpiryTrackingPage() {
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [summary, setSummary] = useState<ExpirySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<ProductBatch | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("status", filter);
      const [batchData, summaryData] = await Promise.all([
        apiGet<{ items: ProductBatch[] }>(`/api/v1/product-batches?${params}`),
        apiGet<ExpirySummary>("/api/v1/product-batches/summary"),
      ]);
      setBatches(batchData.items);
      setSummary(summaryData);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load expiry data.");
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const handleMarkAdjusted = async (batch: ProductBatch) => {
    try {
      await apiPatch(`/api/v1/product-batches/${batch.id}`, { qty: 0 });
      await load();
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to update batch.");
    }
  };

  const filtered = batches.filter((b) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      b.product_name.toLowerCase().includes(q) ||
      b.product_sku.toLowerCase().includes(q) ||
      b.batch_number.toLowerCase().includes(q) ||
      (b.supplier_name ?? "").toLowerCase().includes(q)
    );
  });

  const urgentTotal = (summary?.expired ?? 0) + (summary?.critical ?? 0);
  const urgentQty = (summary?.expired_qty ?? 0) + (summary?.critical_qty ?? 0);

  return (
    <EnterpriseShell active="inventory-expiry" title="Expiry Tracking" subtitle="Monitor product batches and expiration dates"
      contentClassName="overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 sm:px-6">
        {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        {/* Alert banner */}
        {urgentTotal > 0 && (
          <div className="flex items-center gap-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center shrink-0">
              <span className="text-red-600 text-sm font-bold">!</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-red-800">
                {urgentTotal} batch{urgentTotal !== 1 ? "es" : ""} require immediate attention
              </p>
              <p className="text-xs text-red-600">{urgentQty} units expired or expiring within 7 days — review and remove from shelves.</p>
            </div>
            <button onClick={() => setFilter("expired")} className="ml-auto text-xs text-red-700 underline hover:no-underline">
              View expired
            </button>
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { key: "expired", label: "Expired", count: summary?.expired ?? 0, qty: summary?.expired_qty ?? 0, color: "text-red-700 bg-red-50 border-red-200" },
            { key: "critical", label: "Critical (≤7d)", count: summary?.critical ?? 0, qty: summary?.critical_qty ?? 0, color: "text-amber-700 bg-amber-50 border-amber-200" },
            { key: "warning", label: "Warning (≤30d)", count: summary?.warning ?? 0, qty: summary?.warning_qty ?? 0, color: "text-yellow-700 bg-yellow-50 border-yellow-200" },
            { key: "ok", label: "OK", count: summary?.ok ?? 0, qty: null, color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
          ].map((s) => (
            <button
              key={s.key}
              onClick={() => setFilter(filter === (s.key as FilterStatus) ? "all" : (s.key as FilterStatus))}
              className={`rounded-xl border p-4 text-left transition-all hover:shadow-md ${s.color} ${filter === s.key ? "ring-2 ring-offset-1 ring-current" : ""}`}
            >
              <p className="text-2xl font-bold">{s.count}</p>
              <p className="text-sm font-medium mt-0.5">{s.label}</p>
              {s.qty != null && <p className="text-xs opacity-70 mt-0.5">{s.qty} units</p>}
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            placeholder="Search product, batch, or supplier…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
            {FILTER_OPTIONS.map((o) => (
              <button key={o.value} onClick={() => setFilter(o.value)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${filter === o.value ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                {o.label}
              </button>
            ))}
          </div>
          <div className="ml-auto">
            <Button variant="primary" onClick={() => setShowAdd(true)}>+ Add Batch</Button>
          </div>
        </div>

        {/* Table */}
        <Card className="overflow-hidden p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-slate-400">Loading batches…</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm font-medium text-slate-700">No batches found</p>
              <p className="text-xs text-slate-400 mt-1">Add product batches with expiry dates to start tracking.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Product</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Batch #</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Expiry</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Qty</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Unit Cost</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Supplier</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Progress</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((batch) => {
                  const days = batch.days_until_expiry;
                  const pct = days == null ? 100 : days < 0 ? 0 : Math.min(100, (days / 90) * 100);
                  const isUrgent = batch.expiry_status === "expired" || batch.expiry_status === "critical";
                  return (
                    <tr key={batch.id} className={`hover:bg-slate-50 ${isUrgent ? "bg-red-50/40" : ""}`}>
                      <td className="px-4 py-3">
                        <button onClick={() => setSelectedBatch(batch)} className="text-left">
                          <p className="font-medium text-slate-900 hover:text-blue-600">{batch.product_name}</p>
                          <p className="text-xs text-slate-400 font-mono">{batch.product_sku}</p>
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{batch.batch_number || "—"}</td>
                      <td className="px-4 py-3">
                        {batch.expiry_status ? (
                          <Badge variant={STATUS_BADGE[batch.expiry_status]}>{STATUS_LABEL[batch.expiry_status]}</Badge>
                        ) : (
                          <Badge variant="gray">No date</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {batch.expiry_date ? (
                          <div>
                            <p className="text-slate-700 text-xs">{fmtDate(batch.expiry_date)}</p>
                            <p className={`text-xs font-medium ${isUrgent ? "text-red-600" : days != null && days <= 30 ? "text-amber-600" : "text-slate-400"}`}>
                              {daysLabel(days)}
                            </p>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-700">{batch.qty}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-600">{formatMoney(batch.cost_cents)}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{batch.supplier_name ?? "—"}</td>
                      <td className="px-4 py-3 w-24">
                        <ExpiryBar pct={pct} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isUrgent && (
                          <button onClick={() => void handleMarkAdjusted(batch)}
                            className="text-xs text-red-600 hover:underline">Remove</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!loading && filtered.length > 0 && (
            <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-400">
              {filtered.length} batch{filtered.length !== 1 ? "es" : ""} · {filtered.reduce((s, b) => s + b.qty, 0)} units total
            </div>
          )}
        </Card>
      </div>

      {/* Batch detail modal */}
      {selectedBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSelectedBatch(null)}>
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-950">Batch Details</h2>
              <button onClick={() => setSelectedBatch(null)} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center gap-2">
                {selectedBatch.expiry_status && <Badge variant={STATUS_BADGE[selectedBatch.expiry_status]}>{STATUS_LABEL[selectedBatch.expiry_status]}</Badge>}
                <span className="text-sm font-medium text-slate-900">{selectedBatch.product_name}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ["Batch #", selectedBatch.batch_number || "—"],
                  ["SKU", selectedBatch.product_sku],
                  ["Category", selectedBatch.category || "—"],
                  ["Supplier", selectedBatch.supplier_name ?? "—"],
                  ["Quantity", String(selectedBatch.qty)],
                  ["Unit Cost", formatMoney(selectedBatch.cost_cents)],
                  ["Received", fmtDate(selectedBatch.received_at)],
                  ["Expiry", selectedBatch.expiry_date ? fmtDate(selectedBatch.expiry_date) : "—"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-xs text-slate-400">{k}</p>
                    <p className="font-medium text-slate-900">{v}</p>
                  </div>
                ))}
              </div>
              {selectedBatch.notes && (
                <div>
                  <p className="text-xs text-slate-400">Notes</p>
                  <p className="text-sm text-slate-700">{selectedBatch.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showAdd && <AddBatchModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); void load(); }} />}
    </EnterpriseShell>
  );
}
