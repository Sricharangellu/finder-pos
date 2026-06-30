"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtDateShort } from "@/lib/date";
import { hasRole } from "@/lib/auth";
import type { ReorderSuggestion, VendorPOSummary } from "./shared";

type ReorderViewMode = "vendor" | "product";

export function ReorderTab({
  onNavigateToOrders,
}: {
  onNavigateToOrders: () => void;
}) {
  const [suggestions, setSuggestions] = useState<ReorderSuggestion[]>([]);
  const [vendorHistory, setVendorHistory] = useState<Record<string, VendorPOSummary[]>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdPOs, setCreatedPOs] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ReorderViewMode>("vendor");
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);
  const canManage = hasRole("manager");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [sugRes, histRes] = await Promise.all([
        apiGet<{ items: ReorderSuggestion[] }>("/api/v1/inventory/reorder-suggestions"),
        apiGet<{ history: Record<string, VendorPOSummary[]> }>("/api/v1/purchasing/vendor-history"),
      ]);
      setSuggestions(sugRes.items ?? []);
      setVendorHistory(histRes.history ?? {});
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Failed to load reorder suggestions.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const createPOsForVendor = async (vendorId: string | null, vendorName: string) => {
    const lines = suggestions
      .filter((s) => s.preferred_vendor_id === vendorId)
      .map((s) => ({ productId: s.product_id, vendorId: vendorId ?? "", quantity: s.suggested_qty, unitCostCents: 0 }));
    if (lines.length === 0) return;
    setBusy(true); setError(null);
    try {
      await apiPost("/api/v1/inventory/reorder-suggestions/create-po", { lines });
      setCreatedPOs((prev) => [...prev, vendorName]);
      onNavigateToOrders();
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Failed to create purchase order.");
    } finally { setBusy(false); }
  };

  const vendorGroups = suggestions.reduce<Map<string, { vendorId: string | null; vendorName: string; items: ReorderSuggestion[] }>>(
    (acc, s) => {
      const key = s.preferred_vendor_id ?? "__none__";
      if (!acc.has(key)) {
        acc.set(key, { vendorId: s.preferred_vendor_id, vendorName: s.preferred_vendor_name ?? "No vendor assigned", items: [] });
      }
      acc.get(key)!.items.push(s);
      return acc;
    },
    new Map(),
  );

  const sortedByProduct = [...suggestions].sort((a, b) => a.product_name.localeCompare(b.product_name));

  if (loading) {
    return (
      <div className="space-y-3 p-6">
        {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Products below reorder point</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {viewMode === "vendor" ? "Grouped by vendor — one PO per vendor" : "All items sorted A–Z"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-slate-200 text-xs font-medium">
            <button
              type="button"
              onClick={() => setViewMode("vendor")}
              className={`px-3 py-1.5 transition-colors ${viewMode === "vendor" ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
            >
              By vendor
            </button>
            <button
              type="button"
              onClick={() => setViewMode("product")}
              className={`border-l border-slate-200 px-3 py-1.5 transition-colors ${viewMode === "product" ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
            >
              By product
            </button>
          </div>
          <Button variant="secondary" size="sm" disabled={loading} onClick={() => void load()}>Refresh</Button>
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      {createdPOs.length > 0 && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800">
          Purchase orders created for: {createdPOs.join(", ")} — see Purchase Orders tab.
        </div>
      )}

      {suggestions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <svg aria-hidden="true" className="mb-3 h-10 w-10 text-slate-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
          </svg>
          <p className="text-base font-semibold text-slate-700">All stocked up</p>
          <p className="mt-1 text-sm text-slate-400">No products are currently below their reorder point.</p>
        </div>
      ) : viewMode === "vendor" ? (
        <div className="space-y-4">
          {Array.from(vendorGroups.values()).map((group) => {
            const vhKey = group.vendorId ?? "__none__";
            const history = vendorHistory[group.vendorId ?? ""] ?? [];
            const lastPO = history[0];
            const histExpanded = expandedVendor === vhKey;
            return (
              <div key={vhKey} className="overflow-hidden rounded-xl border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{group.vendorName}</p>
                      <p className="text-xs text-slate-500">
                        {group.items.length} item{group.items.length !== 1 ? "s" : ""} to reorder
                        {lastPO && (
                          <> · last ordered <span className="font-medium text-slate-700">{fmtDateShort(lastPO.created_at)}</span> · {history.length} previous PO{history.length !== 1 ? "s" : ""}</>
                        )}
                      </p>
                    </div>
                    {history.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setExpandedVendor(histExpanded ? null : vhKey)}
                        className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-800"
                      >
                        {histExpanded ? "Hide history" : "View history"}
                      </button>
                    )}
                  </div>
                  {canManage && (
                    <Button size="sm" variant="primary" disabled={busy || !group.vendorId} onClick={() => void createPOsForVendor(group.vendorId, group.vendorName)}>
                      Create PO
                    </Button>
                  )}
                </div>
                {histExpanded && history.length > 0 && (
                  <div className="border-b border-blue-100 bg-blue-50 px-4 py-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-700">Purchase history from this vendor</p>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left uppercase tracking-wide text-slate-500">
                          <th className="pb-1 pr-6">PO #</th>
                          <th className="pb-1 pr-6">Date</th>
                          <th className="pb-1 pr-6 text-right">Total</th>
                          <th className="pb-1 pr-6 text-right">Items</th>
                          <th className="pb-1">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-blue-100">
                        {history.map((po) => (
                          <tr key={po.po_id}>
                            <td className="py-1 pr-6 font-mono text-slate-700">#{po.po_number}</td>
                            <td className="py-1 pr-6 text-slate-600">{fmtDateShort(po.created_at)}</td>
                            <td className="py-1 pr-6 text-right font-semibold tabular-nums text-slate-800">{formatMoney(po.total_cost_cents)}</td>
                            <td className="py-1 pr-6 text-right text-slate-500">{po.item_count}</td>
                            <td className="py-1"><span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">{po.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-white">
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-2.5">Product</th>
                      <th className="px-4 py-2.5 text-right">On hand</th>
                      <th className="px-4 py-2.5 text-right">Reorder pt</th>
                      <th className="px-4 py-2.5 text-right">Gap</th>
                      <th className="px-4 py-2.5 text-right">Suggest qty</th>
                      <th className="px-4 py-2.5 text-right">Last cost</th>
                      <th className="px-4 py-2.5 text-right">Last ordered</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 bg-white">
                    {group.items.map((s) => {
                      const gap = s.reorder_pt - s.stock_qty;
                      const critical = s.stock_qty === 0;
                      return (
                        <tr key={s.product_id} className={critical ? "bg-red-50/40" : "hover:bg-slate-50"}>
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-slate-900">{s.product_name}</p>
                            <p className="font-mono text-xs text-slate-400">{s.sku}</p>
                          </td>
                          <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${critical ? "text-red-600" : "text-slate-900"}`}>
                            {critical && <span className="mr-1 text-red-500">●</span>}{s.stock_qty}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{s.reorder_pt}</td>
                          <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${gap > 0 ? "text-amber-600" : "text-slate-400"}`}>{gap > 0 ? `−${gap}` : "—"}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-blue-700">{s.suggested_qty}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                            {s.last_unit_cost_cents != null ? formatMoney(s.last_unit_cost_cents) : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs text-slate-500">
                            {s.last_ordered_at != null ? (
                              <span title={`Qty ${s.last_ordered_qty ?? "?"}`}>{fmtDateShort(s.last_ordered_at)}</span>
                            ) : "Never"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5">Product</th>
                <th className="px-4 py-2.5">Vendor</th>
                <th className="px-4 py-2.5 text-right">On hand</th>
                <th className="px-4 py-2.5 text-right">Reorder pt</th>
                <th className="px-4 py-2.5 text-right">Gap</th>
                <th className="px-4 py-2.5 text-right">Suggest qty</th>
                <th className="px-4 py-2.5 text-right">Last cost</th>
                <th className="px-4 py-2.5 text-right">Last ordered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {sortedByProduct.map((s) => {
                const gap = s.reorder_pt - s.stock_qty;
                const critical = s.stock_qty === 0;
                return (
                  <tr key={s.product_id} className={critical ? "bg-red-50/40" : "hover:bg-slate-50"}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900">{s.product_name}</p>
                      <p className="font-mono text-xs text-slate-400">{s.sku}</p>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {s.preferred_vendor_name ?? <span className="italic text-slate-300">Unassigned</span>}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${critical ? "text-red-600" : "text-slate-900"}`}>{s.stock_qty}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{s.reorder_pt}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${gap > 0 ? "text-amber-600" : "text-slate-400"}`}>{gap > 0 ? `−${gap}` : "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-blue-700">{s.suggested_qty}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {s.last_unit_cost_cents != null ? formatMoney(s.last_unit_cost_cents) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-500">
                      {s.last_ordered_at != null ? (
                        <span title={`Qty: ${s.last_ordered_qty ?? "?"}`}>{fmtDateShort(s.last_ordered_at)}</span>
                      ) : "Never"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
