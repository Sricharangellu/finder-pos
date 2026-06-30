"use client";

/**
 * FE-M1: Manufacturing — production orders with BOM and status lifecycle.
 * Module-gated by module:production_orders.
 */

import { useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Badge } from "@/components/Badge";
import { apiGet, apiPost, apiPatch, safeLoad } from "@/api-client/client";

interface BomLine {
  id: string;
  raw_material_id: string;
  qty_required: number;
  qty_consumed: number;
  unit: string;
}

interface ProductionOrder {
  id: string;
  product_id: string;
  quantity: number;
  status: string;
  started_at: number | null;
  completed_at: number | null;
  notes: string | null;
  created_at: number;
  bom?: BomLine[];
}

const STATUS_BADGE: Record<string, "gray" | "blue" | "yellow" | "green" | "red"> = {
  draft:       "gray",
  in_progress: "yellow",
  completed:   "green",
  cancelled:   "red",
};

const STATUS_NEXT: Record<string, string> = {
  draft: "in_progress",
  in_progress: "completed",
};

export default function ManufacturingPage() {
  const [orders, setOrders]         = useState<ProductionOrder[]>([]);
  const [loading, setLoading]       = useState(true);
  const [filter, setFilter]         = useState("all");
  const [selected, setSelected]     = useState<ProductionOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [modal, setModal]           = useState(false);
  const [saving, setSaving]         = useState(false);
  const [advancing, setAdvancing]   = useState<string | null>(null);
  const [form, setForm]             = useState({
    productId: "", quantity: "1", notes: "",
    bom: [{ rawMaterialId: "", qtyRequired: "1", unit: "unit" }],
  });

  const load = () => {
    setLoading(true);
    const qs = filter !== "all" ? `?status=${filter}` : "";
    safeLoad(
      apiGet<{ items: ProductionOrder[] }>(`/api/v1/manufacturing/orders${qs}`)
        .then(r => setOrders(r.items ?? []))
        .finally(() => setLoading(false)),
    );
  };

  const openDetail = (id: string) => {
    setDetailLoading(true);
    safeLoad(
      apiGet<ProductionOrder>(`/api/v1/manufacturing/orders/${id}`)
        .then(r => setSelected(r))
        .finally(() => setDetailLoading(false)),
    );
  };

  useEffect(() => { load(); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async () => {
    setSaving(true);
    try {
      const bom = form.bom
        .filter(l => l.rawMaterialId && l.qtyRequired)
        .map(l => ({ rawMaterialId: l.rawMaterialId, qtyRequired: Number(l.qtyRequired), unit: l.unit }));
      const res = await apiPost<ProductionOrder>("/api/v1/manufacturing/orders", {
        productId: form.productId,
        quantity: Number(form.quantity),
        notes: form.notes || undefined,
        bom,
      });
      setModal(false);
      setForm({ productId: "", quantity: "1", notes: "", bom: [{ rawMaterialId: "", qtyRequired: "1", unit: "unit" }] });
      load();
      openDetail(res.id);
    } finally { setSaving(false); }
  };

  const advance = async (orderId: string, status: string) => {
    const next = STATUS_NEXT[status];
    if (!next) return;
    setAdvancing(orderId);
    try {
      await apiPatch(`/api/v1/manufacturing/orders/${orderId}/status`, { status: next });
      load();
      if (selected?.id === orderId) openDetail(orderId);
    } finally { setAdvancing(null); }
  };

  const addBomLine = () => setForm(f => ({ ...f, bom: [...f.bom, { rawMaterialId: "", qtyRequired: "1", unit: "unit" }] }));
  const removeBomLine = (i: number) => setForm(f => ({ ...f, bom: f.bom.filter((_, idx) => idx !== i) }));
  const updateBomLine = (i: number, field: string, value: string) =>
    setForm(f => ({ ...f, bom: f.bom.map((l, idx) => idx === i ? { ...l, [field]: value } : l) }));

  const FILTERS = ["all", "draft", "in_progress", "completed", "cancelled"];

  return (
    <EnterpriseShell active="manufacturing" title="Production Orders" subtitle="BOM-based manufacturing workflow">
      <div className="mx-auto w-full max-w-6xl gap-5 px-4 py-5 sm:px-6 grid grid-cols-1 lg:grid-cols-5">

        {/* Order list */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex gap-1 flex-wrap">
              {FILTERS.map(s => (
                <button key={s} type="button" onClick={() => setFilter(s)}
                  className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                    filter === s ? "bg-brand-600 text-white" : "bg-gray-100 text-[var(--color-text-secondary)] hover:bg-gray-200"
                  }`}>
                  {s.replace("_", " ")}
                </button>
              ))}
            </div>
            <Button variant="primary" size="sm" onClick={() => setModal(true)}>+ Order</Button>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />)}
            </div>
          ) : orders.length === 0 ? (
            <Card><p className="py-8 text-center text-sm text-[var(--color-text-secondary)]">No orders found.</p></Card>
          ) : (
            <div className="space-y-1.5">
              {orders.map(o => (
                <button key={o.id} type="button" onClick={() => openDetail(o.id)}
                  className={`w-full rounded-xl border p-3 text-left transition-colors hover:border-brand-400 hover:bg-brand-50 ${
                    selected?.id === o.id ? "border-brand-600 bg-brand-50" : "border-[var(--color-table-border)] bg-white"
                  }`}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{o.product_id}</p>
                    <Badge variant={STATUS_BADGE[o.status] ?? "gray"} size="sm">{o.status.replace("_"," ")}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Qty: {o.quantity}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Order detail */}
        <div className="lg:col-span-3">
          {!selected && !detailLoading && (
            <Card>
              <div className="py-16 text-center">
                <p className="text-2xl">🏭</p>
                <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Select a production order</p>
              </div>
            </Card>
          )}
          {detailLoading && <div className="h-64 animate-pulse rounded-xl bg-gray-100" />}
          {selected && !detailLoading && (
            <div className="space-y-4">
              <Card>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-bold text-[var(--color-text-primary)]">{selected.product_id}</h3>
                    <p className="text-sm text-[var(--color-text-secondary)]">Quantity: {selected.quantity}</p>
                    {selected.notes && <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{selected.notes}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge variant={STATUS_BADGE[selected.status] ?? "gray"}>
                      {selected.status.replace("_"," ")}
                    </Badge>
                    {STATUS_NEXT[selected.status] && (
                      <Button variant="primary" size="sm"
                        loading={advancing === selected.id}
                        onClick={() => advance(selected.id, selected.status)}>
                        {selected.status === "draft" ? "Start Production" : "Mark Complete"}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>

              <div>
                <h4 className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">
                  Bill of Materials ({selected.bom?.length ?? 0} lines)
                </h4>
                {!selected.bom?.length ? (
                  <Card><p className="py-4 text-center text-sm text-[var(--color-text-secondary)]">No BOM lines.</p></Card>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-[var(--color-table-border)]">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs font-medium text-[var(--color-text-secondary)] uppercase">
                        <tr>
                          <th className="px-3 py-2 text-left">Material</th>
                          <th className="px-3 py-2 text-right">Required</th>
                          <th className="px-3 py-2 text-right">Consumed</th>
                          <th className="px-3 py-2 text-left">Unit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-table-border)] bg-white">
                        {selected.bom.map(line => (
                          <tr key={line.id}>
                            <td className="px-3 py-2 font-medium text-[var(--color-text-primary)]">{line.raw_material_id}</td>
                            <td className="px-3 py-2 text-right text-[var(--color-text-secondary)]">{line.qty_required}</td>
                            <td className={`px-3 py-2 text-right font-medium ${
                              Number(line.qty_consumed) >= Number(line.qty_required) ? "text-green-600" : "text-amber-600"
                            }`}>{line.qty_consumed}</td>
                            <td className="px-3 py-2 text-[var(--color-text-secondary)]">{line.unit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New production order modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="New Production Order">
        <div className="space-y-3 p-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Product ID / SKU *</label>
              <input type="text" value={form.productId}
                onChange={e => setForm(f => ({ ...f, productId: e.target.value }))}
                placeholder="SKU or product ID"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Quantity *</label>
              <input type="number" min={1} value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Notes</label>
              <input type="text" value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-[var(--color-text-secondary)]">Bill of Materials *</label>
              <button type="button" onClick={addBomLine} className="text-xs text-brand-600 hover:underline">+ Add line</button>
            </div>
            <div className="space-y-2">
              {form.bom.map((line, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input type="text" placeholder="Material ID" value={line.rawMaterialId}
                    onChange={e => updateBomLine(i, "rawMaterialId", e.target.value)}
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-brand-600" />
                  <input type="number" placeholder="Qty" value={line.qtyRequired} min={0.001} step={0.001}
                    onChange={e => updateBomLine(i, "qtyRequired", e.target.value)}
                    className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-600" />
                  <input type="text" placeholder="Unit" value={line.unit}
                    onChange={e => updateBomLine(i, "unit", e.target.value)}
                    className="w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-600" />
                  {form.bom.length > 1 && (
                    <button type="button" onClick={() => removeBomLine(i)}
                      className="text-red-500 hover:text-red-700 text-sm">×</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" fullWidth onClick={() => setModal(false)}>Cancel</Button>
            <Button variant="primary" fullWidth loading={saving} onClick={handleCreate}
              disabled={!form.productId || !form.quantity}>Create</Button>
          </div>
        </div>
      </Modal>
    </EnterpriseShell>
  );
}
