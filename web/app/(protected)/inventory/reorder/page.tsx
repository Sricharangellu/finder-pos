"use client";
import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import type { ReorderSuggestion, ReorderSuggestionsResponse } from "@/api-client/types";

// ── Stat card ──────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-950">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

// ── Urgency badge ──────────────────────────────────────────────────────────────
function UrgencyBadge({ stock, reorderPt }: { stock: number; reorderPt: number }) {
  if (stock === 0) return <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Out</span>;
  const pct = stock / reorderPt;
  if (pct <= 0.25) return <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">Critical</span>;
  return <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-700">Low</span>;
}

// ── Confirm modal ─────────────────────────────────────────────────────────────
function ConfirmModal({
  groups,
  onConfirm,
  onClose,
  saving,
}: {
  groups: Map<string, { vendorName: string; lines: Array<ReorderSuggestion & { qty: number }> }>;
  onConfirm: () => void;
  onClose: () => void;
  saving: boolean;
}) {
  const totalLines = [...groups.values()].reduce((s, g) => s + g.lines.length, 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">Confirm Draft Purchase Orders</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <p className="text-sm text-slate-600">
            This will create <strong>{groups.size} draft PO{groups.size !== 1 ? "s" : ""}</strong> covering{" "}
            <strong>{totalLines} SKU{totalLines !== 1 ? "s" : ""}</strong>.
          </p>
          {[...groups.entries()].map(([vendorId, g]) => (
            <div key={vendorId} className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                  {g.vendorName} ({g.lines.length} line{g.lines.length !== 1 ? "s" : ""})
                </p>
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {g.lines.map(l => (
                    <tr key={l.product_id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2 text-slate-800">{l.product_name}</td>
                      <td className="px-4 py-2 text-slate-500">{l.sku ?? "—"}</td>
                      <td className="px-4 py-2 text-right font-semibold text-slate-700">×{l.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button onClick={onClose} disabled={saving}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-40">
            {saving ? "Creating…" : "Create POs"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function ReorderPage() {
  const [items, setItems] = useState<ReorderSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await apiGet<ReorderSuggestionsResponse>("/api/v1/inventory/reorder-suggestions");
      setItems(data.items);
      const defaultQtys: Record<string, number> = {};
      for (const s of data.items) defaultQtys[s.product_id] = s.suggested_qty;
      setQtys(defaultQtys);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load reorder suggestions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Derived stats ────────────────────────────────────────────────────────────
  const outCount = items.filter(i => i.stock_qty === 0).length;
  const vendorSet = new Set(items.map(i => i.preferred_vendor_id ?? "__none__"));
  const vendorCount = vendorSet.size - (vendorSet.has("__none__") ? 1 : 0) + (vendorSet.has("__none__") ? 1 : 0);

  // ── Selection helpers ────────────────────────────────────────────────────────
  const toggleAll = () => {
    if (selected.size === items.length) { setSelected(new Set()); }
    else { setSelected(new Set(items.map(i => i.product_id))); }
  };

  const toggleItem = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── Group selected items by vendor for PO creation ───────────────────────────
  const buildGroups = () => {
    const groups = new Map<string, { vendorName: string; lines: Array<ReorderSuggestion & { qty: number }> }>();
    for (const item of items) {
      if (!selected.has(item.product_id)) continue;
      const vendorId = item.preferred_vendor_id ?? "no_vendor";
      const vendorName = item.preferred_vendor_name ?? "No Vendor Assigned";
      const existing = groups.get(vendorId) ?? { vendorName, lines: [] };
      existing.lines.push({ ...item, qty: qtys[item.product_id] ?? item.suggested_qty });
      groups.set(vendorId, existing);
    }
    return groups;
  };

  const handleCreatePO = async () => {
    setSaving(true);
    try {
      const groups = buildGroups();
      const lines = [...groups.entries()].flatMap(([vendorId, g]) =>
        g.lines.map(l => ({
          productId: l.product_id,
          productName: l.product_name,
          vendorId,
          quantity: l.qty,
          unitCostCents: 0,
        }))
      );
      const res = await apiPost<{ orders: unknown[] }>("/api/v1/inventory/reorder-suggestions/create-po", { lines });
      setSuccessMsg(`Created ${res.orders.length} draft PO${res.orders.length !== 1 ? "s" : ""} successfully.`);
      setShowConfirm(false);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to create purchase orders.");
      setShowConfirm(false);
    } finally {
      setSaving(false);
    }
  };

  // ── Group items by vendor for display ─────────────────────────────────────────
  const byVendor = new Map<string, { vendorName: string; items: ReorderSuggestion[] }>();
  for (const item of items) {
    const key = item.preferred_vendor_id ?? "__none__";
    const name = item.preferred_vendor_name ?? "No Vendor Assigned";
    const g = byVendor.get(key) ?? { vendorName: name, items: [] };
    g.items.push(item);
    byVendor.set(key, g);
  }

  const confirmGroups = buildGroups();

  return (
    <EnterpriseShell active="inventory-reorder" title="Reorder Dashboard"
      subtitle="Products at or below reorder point" contentClassName="overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 sm:px-6">

        {/* Alerts */}
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <p role="alert" className="text-sm text-red-700">{error}</p>
          </div>
        )}
        {successMsg && (
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 flex items-center justify-between">
            <p className="text-sm text-green-700">{successMsg}</p>
            <button onClick={() => setSuccessMsg(null)} className="text-green-500 hover:text-green-700 text-lg">&times;</button>
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="SKUs to Reorder" value={loading ? "—" : items.length} sub="at or below reorder point" />
          <StatCard label="Out of Stock" value={loading ? "—" : outCount} sub="zero inventory" />
          <StatCard label="Vendors Affected" value={loading ? "—" : vendorCount} sub="with reorder items" />
          <StatCard label="Selected" value={selected.size} sub={`of ${items.length} items`} />
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={toggleAll}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              {selected.size === items.length && items.length > 0 ? "Deselect All" : "Select All"}
            </button>
            {selected.size > 0 && (
              <span className="text-sm text-slate-600">{selected.size} selected</span>
            )}
          </div>
          <button
            onClick={() => setShowConfirm(true)}
            disabled={selected.size === 0}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">
            Create Draft PO{confirmGroups.size > 1 ? "s" : ""}
            {selected.size > 0 ? ` (${selected.size})` : ""}
          </button>
        </div>

        {/* Grouped tables */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400 text-sm">Loading…</div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white py-16 text-center">
            <p className="text-slate-500 font-medium">All products are well-stocked</p>
            <p className="mt-1 text-xs text-slate-400">No items currently at or below reorder point</p>
          </div>
        ) : (
          <div className="space-y-4">
            {[...byVendor.entries()].map(([vendorId, group]) => (
              <div key={vendorId} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between bg-slate-50 border-b border-slate-200 px-5 py-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{group.vendorName}</p>
                    <p className="text-xs text-slate-500">{group.items.length} SKU{group.items.length !== 1 ? "s" : ""}</p>
                  </div>
                  <button
                    onClick={() => {
                      const allSelected = group.items.every(i => selected.has(i.product_id));
                      setSelected(prev => {
                        const next = new Set(prev);
                        if (allSelected) group.items.forEach(i => next.delete(i.product_id));
                        else group.items.forEach(i => next.add(i.product_id));
                        return next;
                      });
                    }}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                    {group.items.every(i => selected.has(i.product_id)) ? "Deselect group" : "Select group"}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                        <th className="w-10 px-4 py-2"></th>
                        <th className="px-4 py-2 font-medium">Product</th>
                        <th className="px-4 py-2 font-medium">SKU</th>
                        <th className="px-4 py-2 font-medium text-right">On Hand</th>
                        <th className="px-4 py-2 font-medium text-right">Reorder Pt</th>
                        <th className="px-4 py-2 font-medium text-right">Order Qty</th>
                        <th className="px-4 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map(item => (
                        <tr key={item.product_id}
                          onClick={() => toggleItem(item.product_id)}
                          className={`cursor-pointer border-b border-slate-100 last:border-0 transition-colors ${
                            selected.has(item.product_id) ? "bg-blue-50" : "hover:bg-slate-50"
                          }`}>
                          <td className="px-4 py-3">
                            <input type="checkbox" readOnly
                              checked={selected.has(item.product_id)}
                              className="h-4 w-4 rounded border-slate-300 accent-blue-600" />
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-900">{item.product_name}</td>
                          <td className="px-4 py-3 text-slate-500">{item.sku ?? "—"}</td>
                          <td className="px-4 py-3 text-right font-semibold text-slate-800">{item.stock_qty}</td>
                          <td className="px-4 py-3 text-right text-slate-600">{item.reorder_pt}</td>
                          <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                            <input
                              type="number" min={1}
                              value={qtys[item.product_id] ?? item.suggested_qty}
                              onChange={e => setQtys(prev => ({ ...prev, [item.product_id]: Math.max(1, Number(e.target.value)) }))}
                              className="w-20 rounded border border-slate-300 px-2 py-1 text-right text-sm focus:border-blue-500 focus:outline-none"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <UrgencyBadge stock={item.stock_qty} reorderPt={item.reorder_pt} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showConfirm && (
        <ConfirmModal
          groups={confirmGroups}
          onConfirm={handleCreatePO}
          onClose={() => setShowConfirm(false)}
          saving={saving}
        />
      )}
    </EnterpriseShell>
  );
}
