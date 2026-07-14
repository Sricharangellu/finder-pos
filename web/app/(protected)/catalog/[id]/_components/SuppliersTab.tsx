"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { apiGet, apiPost, apiPatch, apiDelete, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProductSupplier {
  id: string;
  product_id: string;
  vendor_id: string;
  vendor_name: string;
  vendor_sku: string | null;
  cost_cents: number | null;
  lead_time_days: number | null;
  moq: number | null;
  case_pack: number | null;
  is_preferred: boolean;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

type SupplierForm = {
  vendor_name: string;
  vendor_sku: string;
  cost_cents: string;
  lead_time_days: string;
  moq: string;
  case_pack: string;
  is_preferred: boolean;
  notes: string;
};

const EMPTY_FORM: SupplierForm = { vendor_name: "", vendor_sku: "", cost_cents: "", lead_time_days: "", moq: "", case_pack: "", is_preferred: false, notes: "" };

const INPUT = "w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-[#111] outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      {children}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SuppliersTab({ productId }: { productId: string }) {
  const [suppliers, setSuppliers] = useState<ProductSupplier[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [busy, setBusy]           = useState(false);
  const [showAdd, setShowAdd]     = useState(false);
  const [editId, setEditId]       = useState<string | null>(null);
  const [form, setForm]           = useState<SupplierForm>(EMPTY_FORM);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await apiGet<{ items: ProductSupplier[] }>(`/api/v1/catalog/${productId}/suppliers`);
      setSuppliers(d.items ?? []);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load suppliers.");
    } finally { setLoading(false); }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  const openAdd = () => { setForm(EMPTY_FORM); setEditId(null); setShowAdd(true); };
  const openEdit = (s: ProductSupplier) => {
    setForm({ vendor_name: s.vendor_name, vendor_sku: s.vendor_sku ?? "", cost_cents: s.cost_cents != null ? (s.cost_cents / 100).toFixed(2) : "", lead_time_days: s.lead_time_days?.toString() ?? "", moq: s.moq?.toString() ?? "", case_pack: s.case_pack?.toString() ?? "", is_preferred: s.is_preferred, notes: s.notes ?? "" });
    setEditId(s.id); setShowAdd(true);
  };

  const save = async () => {
    if (!form.vendor_name.trim()) return;
    setBusy(true);
    try {
      const payload = { vendor_name: form.vendor_name.trim(), vendor_sku: form.vendor_sku || null, cost_cents: form.cost_cents ? Math.round(parseFloat(form.cost_cents) * 100) : null, lead_time_days: form.lead_time_days ? parseInt(form.lead_time_days) : null, moq: form.moq ? parseInt(form.moq) : null, case_pack: form.case_pack ? parseInt(form.case_pack) : null, is_preferred: form.is_preferred, notes: form.notes || null };
      if (editId) {
        await apiPatch(`/api/v1/catalog/${productId}/suppliers/${editId}`, payload);
      } else {
        await apiPost(`/api/v1/catalog/${productId}/suppliers`, payload);
      }
      setShowAdd(false); setEditId(null);
      await load();
    } finally { setBusy(false); }
  };

  const setPreferred = async (s: ProductSupplier) => {
    setBusy(true);
    try {
      await apiPatch(`/api/v1/catalog/${productId}/suppliers/${s.id}`, { is_preferred: true });
      await load();
    } finally { setBusy(false); }
  };

  const remove = async (s: ProductSupplier) => {
    if (!confirm(`Remove ${s.vendor_name} as a supplier for this product?`)) return;
    setBusy(true);
    try {
      await apiDelete(`/api/v1/catalog/${productId}/suppliers/${s.id}`);
      await load();
    } finally { setBusy(false); }
  };

  if (loading) return (
    <div className="space-y-3">
      {[1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-slate-100" />)}
    </div>
  );

  if (error) return <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;

  return (
    <div className="space-y-4">

      {/* ── Add / Edit form ──────────────────────────────────────────────── */}
      {showAdd && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
          <p className="mb-4 text-sm font-semibold text-slate-700">{editId ? "Edit supplier" : "Add supplier"}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="col-span-2 sm:col-span-3">
              <Field label="Supplier / Vendor name *">
                <input className={INPUT} value={form.vendor_name} onChange={(e) => setForm((f) => ({ ...f, vendor_name: e.target.value }))} placeholder="e.g. Acme Distributors" />
              </Field>
            </div>
            <Field label="Vendor SKU">
              <input className={INPUT} value={form.vendor_sku} onChange={(e) => setForm((f) => ({ ...f, vendor_sku: e.target.value }))} placeholder="e.g. ACM-0042" />
            </Field>
            <Field label="Cost ($)">
              <input type="number" step="0.01" min={0} className={INPUT} value={form.cost_cents} onChange={(e) => setForm((f) => ({ ...f, cost_cents: e.target.value }))} placeholder="0.00" />
            </Field>
            <Field label="Lead Time (days)">
              <input type="number" min={0} className={INPUT} value={form.lead_time_days} onChange={(e) => setForm((f) => ({ ...f, lead_time_days: e.target.value }))} placeholder="e.g. 5" />
            </Field>
            <Field label="MOQ (min order qty)">
              <input type="number" min={1} className={INPUT} value={form.moq} onChange={(e) => setForm((f) => ({ ...f, moq: e.target.value }))} placeholder="e.g. 6" />
            </Field>
            <Field label="Case Pack">
              <input type="number" min={1} className={INPUT} value={form.case_pack} onChange={(e) => setForm((f) => ({ ...f, case_pack: e.target.value }))} placeholder="e.g. 12" />
            </Field>
            <div className="col-span-2 sm:col-span-3">
              <Field label="Notes">
                <input className={INPUT} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Optional notes about this supplier" />
              </Field>
            </div>
            <div className="col-span-2 sm:col-span-3 flex items-center gap-2">
              <input type="checkbox" id="preferred" checked={form.is_preferred} onChange={(e) => setForm((f) => ({ ...f, is_preferred: e.target.checked }))} className="h-4 w-4 rounded border-slate-300 accent-brand-600" />
              <label htmlFor="preferred" className="text-sm text-slate-600">Set as preferred supplier</label>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => { setShowAdd(false); setEditId(null); }}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={save} disabled={busy || !form.vendor_name.trim()}>
              {busy ? "Saving…" : editId ? "Save changes" : "Add supplier"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Supplier cards ───────────────────────────────────────────────── */}
      {suppliers.length === 0 && !showAdd ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-12 text-center">
          <p className="text-sm text-slate-400">No suppliers linked to this product.</p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={openAdd}>Add first supplier</Button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">{suppliers.length} supplier{suppliers.length !== 1 ? "s" : ""}</p>
            {!showAdd && <Button size="sm" variant="secondary" onClick={openAdd}>+ Add supplier</Button>}
          </div>

          <div className="space-y-3">
            {suppliers.map((s) => (
              <div key={s.id} className={`rounded-lg border bg-white shadow-sm ${s.is_preferred ? "border-brand-600" : "border-slate-200"}`}>
                <div className="flex items-start justify-between px-5 py-4">
                  <div className="flex items-center gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{s.vendor_name}</span>
                        {s.is_preferred && <Badge variant="blue">Preferred</Badge>}
                      </div>
                      {s.vendor_sku && <p className="text-xs text-slate-400 mt-0.5">Vendor SKU: {s.vendor_sku}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!s.is_preferred && (
                      <button type="button" onClick={() => void setPreferred(s)} disabled={busy}
                        className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                        Set preferred
                      </button>
                    )}
                    <button type="button" onClick={() => openEdit(s)}
                      className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
                      Edit
                    </button>
                    <button type="button" onClick={() => void remove(s)} disabled={busy}
                      className="rounded border border-red-100 px-2 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-40">
                      Remove
                    </button>
                  </div>
                </div>
                <div className="border-t border-slate-100 px-5 py-3">
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
                    <span>Cost: <strong className="text-slate-700">{s.cost_cents != null ? formatMoney(s.cost_cents) : "—"}</strong></span>
                    <span>Lead time: <strong className="text-slate-700">{s.lead_time_days != null ? `${s.lead_time_days}d` : "—"}</strong></span>
                    <span>MOQ: <strong className="text-slate-700">{s.moq ?? "—"}</strong></span>
                    <span>Case pack: <strong className="text-slate-700">{s.case_pack ?? "—"}</strong></span>
                    {s.notes && <span className="col-span-2 italic text-slate-400">"{s.notes}"</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
