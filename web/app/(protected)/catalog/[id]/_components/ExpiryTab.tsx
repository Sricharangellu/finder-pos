"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { apiGet, apiPost, apiPatch, apiDelete, ApiResponseError } from "@/api-client/client";
import { fmtDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExpiryStatus = "ok" | "warning" | "critical" | "expired";

export interface ExpiryRecord {
  id: string;
  product_id: string;
  batch_number: string;
  lot_code: string | null;
  quantity: number;
  unit_cost_cents: number;
  expiry_date: number | null;
  received_at: number;
  supplier_name: string | null;
  location_name: string | null;
  notes: string | null;
  expiry_status: ExpiryStatus;
  days_until_expiry: number | null;
  created_at: number;
  updated_at: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadgeVariant(s: ExpiryStatus): "green" | "yellow" | "red" | "gray" {
  if (s === "expired")  return "red";
  if (s === "critical") return "red";
  if (s === "warning")  return "yellow";
  return "green";
}

function statusLabel(r: ExpiryRecord): string {
  const d = r.days_until_expiry;
  if (d === null) return "No expiry";
  if (d < 0)  return `Expired ${Math.abs(d)}d ago`;
  if (d === 0) return "Expires today";
  if (r.expiry_status === "critical") return `${d}d — Critical`;
  if (r.expiry_status === "warning")  return `${d}d — Expiring`;
  return `${d}d remaining`;
}

const FIELD = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</label>
      {children}
    </div>
  );
}

// ── Add/Edit Modal ────────────────────────────────────────────────────────────

function ExpiryModal({
  productId,
  existing,
  onClose,
  onSaved,
}: {
  productId: string;
  existing?: ExpiryRecord;
  onClose: () => void;
  onSaved: (r: ExpiryRecord) => void;
}) {
  const today = new Date().toISOString().split("T")[0]!;
  const [form, setForm] = useState({
    batch_number: existing?.batch_number ?? "",
    lot_code: existing?.lot_code ?? "",
    supplier_name: existing?.supplier_name ?? "",
    location_name: existing?.location_name ?? "Main Floor",
    expiry_date: existing?.expiry_date ? new Date(existing.expiry_date).toISOString().split("T")[0]! : "",
    received_at: existing ? new Date(existing.received_at).toISOString().split("T")[0]! : today,
    quantity: existing ? String(existing.quantity) : "",
    unit_cost_cents: existing?.unit_cost_cents ? String(existing.unit_cost_cents / 100) : "",
    notes: existing?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.batch_number.trim() || !form.quantity) {
      setError("Batch number and quantity are required.");
      return;
    }
    setSaving(true); setError(null);
    const payload = {
      batch_number: form.batch_number.trim(),
      lot_code: form.lot_code.trim() || null,
      supplier_name: form.supplier_name.trim() || null,
      location_name: form.location_name.trim() || null,
      expiry_date: form.expiry_date ? new Date(form.expiry_date).getTime() : null,
      received_at: form.received_at ? new Date(form.received_at).getTime() : Date.now(),
      quantity: parseInt(form.quantity) || 0,
      unit_cost_cents: form.unit_cost_cents ? Math.round(parseFloat(form.unit_cost_cents) * 100) : 0,
      notes: form.notes.trim() || null,
    };
    try {
      let saved: ExpiryRecord;
      if (existing) {
        saved = await apiPatch<ExpiryRecord>(`/api/v1/catalog/${productId}/expiry/${existing.id}`, payload);
      } else {
        saved = await apiPost<ExpiryRecord>(`/api/v1/catalog/${productId}/expiry`, payload);
      }
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Save failed.");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-[#111]">{existing ? "Edit Batch" : "Add Batch / Lot"}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Batch / Lot Number *">
              <input className={FIELD} value={form.batch_number} onChange={(e) => set("batch_number", e.target.value)} placeholder="L-2024-001" />
            </Field>
            <Field label="Lot Code">
              <input className={FIELD} value={form.lot_code} onChange={(e) => set("lot_code", e.target.value)} placeholder="Optional secondary code" />
            </Field>
            <Field label="Supplier">
              <input className={FIELD} value={form.supplier_name} onChange={(e) => set("supplier_name", e.target.value)} placeholder="Optional" />
            </Field>
            <Field label="Location">
              <input className={FIELD} value={form.location_name} onChange={(e) => set("location_name", e.target.value)} placeholder="Main Floor" />
            </Field>
            <Field label="Received Date">
              <input type="date" className={FIELD} value={form.received_at} onChange={(e) => set("received_at", e.target.value)} />
            </Field>
            <Field label="Expiry Date">
              <input type="date" className={FIELD} value={form.expiry_date} onChange={(e) => set("expiry_date", e.target.value)} />
            </Field>
            <Field label="Quantity *">
              <input type="number" min="0" className={FIELD} value={form.quantity} onChange={(e) => set("quantity", e.target.value)} placeholder="0" />
            </Field>
            <Field label="Unit Cost ($)">
              <input type="number" step="0.01" min="0" className={FIELD} value={form.unit_cost_cents} onChange={(e) => set("unit_cost_cents", e.target.value)} placeholder="0.00" />
            </Field>
          </div>
          <Field label="Notes">
            <input className={FIELD} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional notes…" />
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => void handleSave()} disabled={saving}
            className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-[#4849d0] disabled:opacity-40">
            {saving ? "Saving…" : existing ? "Update Batch" : "Add Batch"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ExpiryTab ─────────────────────────────────────────────────────────────────

export function ExpiryTab({ productId }: { productId: string }) {
  const [records, setRecords] = useState<ExpiryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<ExpiryRecord | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiGet<{ items: ExpiryRecord[] }>(`/api/v1/catalog/${productId}/expiry`)
      .then((r) => setRecords(r.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [productId]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    await apiDelete(`/api/v1/catalog/${productId}/expiry/${id}`);
    setRecords((prev) => prev.filter((r) => r.id !== id));
    setDeleteId(null);
  };

  const expired  = records.filter((r) => r.expiry_status === "expired");
  const critical = records.filter((r) => r.expiry_status === "critical");
  const warning  = records.filter((r) => r.expiry_status === "warning");
  const totalQty = records.reduce((s, r) => s + r.quantity, 0);

  return (
    <div className="space-y-4">

      {/* Alert banners */}
      {expired.length > 0 && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-red-700">{expired.length} batch{expired.length !== 1 ? "es" : ""} expired</p>
            <p className="text-xs text-red-600">Remove or quarantine expired stock to prevent sale.</p>
          </div>
        </div>
      )}
      {critical.length > 0 && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-red-700">{critical.length} batch{critical.length !== 1 ? "es" : ""} expiring within 7 days</p>
            <p className="text-xs text-red-600">Prioritise FEFO (first-expiry, first-out) when selling.</p>
          </div>
        </div>
      )}
      {warning.length > 0 && critical.length === 0 && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-amber-700">{warning.length} batch{warning.length !== 1 ? "es" : ""} expiring within 30 days</p>
            <p className="text-xs text-amber-600">Consider promotions or markdowns to move this stock.</p>
          </div>
        </div>
      )}

      {/* Stats + Add button */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-5">
          {[
            { label: "Total batches",     value: String(records.length) },
            { label: "Total on hand",     value: `${totalQty} units` },
            { label: "Expired",           value: String(expired.length),  danger: expired.length > 0 },
            { label: "Critical (< 7d)",   value: String(critical.length), danger: critical.length > 0 },
            { label: "Warning (< 30d)",   value: String(warning.length),  warn: warning.length > 0 },
          ].map(({ label, value, danger, warn }) => (
            <div key={label}>
              <p className="text-[11px] text-slate-400">{label}</p>
              <p className={`text-lg font-bold ${danger ? "text-red-600" : warn ? "text-amber-600" : "text-[#111]"}`}>{value}</p>
            </div>
          ))}
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>+ Add Batch</Button>
      </div>

      {/* Batch table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="space-y-2 p-4">
            {[1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />)}
          </div>
        ) : records.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-slate-400">No batches recorded for this product.</p>
            <button type="button" onClick={() => setShowAdd(true)} className="mt-2 text-sm font-medium text-brand-600 hover:underline">
              Add the first batch
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Batch #</th>
                <th className="px-4 py-3 hidden lg:table-cell">Lot Code</th>
                <th className="px-4 py-3 hidden sm:table-cell">Supplier</th>
                <th className="px-4 py-3 hidden md:table-cell">Location</th>
                <th className="px-4 py-3">Expiry</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 hidden md:table-cell text-right">Unit Cost</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {records.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs font-semibold text-[#111]">{r.batch_number}</p>
                    {r.notes && <p className="mt-0.5 text-[11px] text-slate-400 truncate max-w-[120px]">{r.notes}</p>}
                  </td>
                  <td className="hidden px-4 py-3 font-mono text-xs text-slate-500 lg:table-cell">{r.lot_code ?? "—"}</td>
                  <td className="hidden px-4 py-3 text-slate-500 sm:table-cell">{r.supplier_name ?? "—"}</td>
                  <td className="hidden px-4 py-3 text-slate-500 md:table-cell">{r.location_name ?? "—"}</td>
                  <td className="px-4 py-3 font-medium text-[#111]">
                    {r.expiry_date ? fmtDate(r.expiry_date) : <span className="text-slate-400 text-xs">None</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={statusBadgeVariant(r.expiry_status)}>{statusLabel(r)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-[#111]">{r.quantity}</td>
                  <td className="hidden px-4 py-3 text-right text-slate-500 md:table-cell">
                    {r.unit_cost_cents ? formatMoney(r.unit_cost_cents) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setEditing(r)}
                        className="text-xs font-medium text-brand-600 hover:underline">Edit</button>
                      <button type="button" onClick={() => setDeleteId(r.id)}
                        className="text-xs font-medium text-red-500 hover:underline">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modals */}
      {(showAdd || editing) && (
        <ExpiryModal
          productId={productId}
          existing={editing ?? undefined}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onSaved={(rec) => {
            setRecords((prev) => {
              const idx = prev.findIndex((x) => x.id === rec.id);
              return idx === -1 ? [...prev, rec] : prev.map((x) => x.id === rec.id ? rec : x);
            });
          }}
        />
      )}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <p className="font-semibold text-[#111]">Delete this batch?</p>
            <p className="mt-1 text-sm text-slate-500">This will remove the batch record. Stock adjustment may be needed.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteId(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={() => void handleDelete(deleteId)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
