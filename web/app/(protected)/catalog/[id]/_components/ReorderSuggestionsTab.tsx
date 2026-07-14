"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReorderSuggestion {
  current_stock: number;
  reserved_stock: number;
  available_stock: number;
  incoming_stock: number;
  reorder_point: number;
  safety_stock: number;
  avg_daily_sales: number;
  days_until_stockout: number;
  suggested_qty: number;
  preferred_supplier_id: string;
  preferred_supplier_name: string;
  preferred_supplier_lead_days: number;
  preferred_supplier_cost_cents: number;
  best_price_supplier_id: string;
  best_price_supplier_name: string;
  best_price_supplier_cost_cents: number;
  savings_per_unit_cents: number;
  reason: string;
  last_reorder_date: number | null;
  open_po_qty: number;
  status: "suggested" | "ok" | "critical";
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ReorderSuggestionsTab({ productId }: { productId: string }) {
  const router = useRouter();
  const [data, setData]       = useState<ReorderSuggestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [qty, setQty]         = useState("");
  const [supplier, setSupplier] = useState<"preferred" | "best_price">("preferred");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await apiGet<ReorderSuggestion>(`/api/v1/catalog/${productId}/reorder-suggestions`);
      setData(d);
      setQty(String(d.suggested_qty));
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load reorder data.");
    } finally { setLoading(false); }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}
    </div>
  );

  if (error) return <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!data) return null;

  const isCritical   = data.days_until_stockout <= 3;
  const isLow        = data.days_until_stockout <= 7;
  const chosenCost   = supplier === "preferred" ? data.preferred_supplier_cost_cents : data.best_price_supplier_cost_cents;
  const chosenName   = supplier === "preferred" ? data.preferred_supplier_name        : data.best_price_supplier_name;
  const qtyNum       = parseInt(qty) || 0;
  const totalOrderCost = qtyNum * chosenCost;

  const stockBarPct  = Math.min(100, Math.round((data.current_stock / Math.max(data.reorder_point * 2, 1)) * 100));

  return (
    <div className="space-y-5">

      {/* ── Alert banner ─────────────────────────────────────────────────────── */}
      {data.status !== "ok" && (
        <div className={`flex items-start gap-3 rounded-xl border px-5 py-4 ${
          isCritical
            ? "border-red-200 bg-red-50 text-red-800"
            : "border-amber-200 bg-amber-50 text-amber-800"
        }`}>
          <svg className={`mt-0.5 h-5 w-5 shrink-0 ${isCritical ? "text-red-500" : "text-amber-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          <div>
            <p className="font-semibold">{isCritical ? "Critical stock level" : "Reorder suggested"}</p>
            <p className="mt-0.5 text-sm">{data.reason}</p>
          </div>
        </div>
      )}

      {/* ── Stock overview ────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Stock position</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "On hand",    value: data.current_stock,    color: isCritical ? "text-red-600" : isLow ? "text-amber-600" : "text-slate-900" },
            { label: "Reserved",   value: data.reserved_stock,   color: "text-slate-700" },
            { label: "Available",  value: data.available_stock,  color: "text-emerald-700" },
            { label: "Incoming",   value: data.incoming_stock,   color: "text-blue-700" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-lg bg-slate-50 px-3 py-2.5">
              <p className="text-xs text-slate-400">{label}</p>
              <p className={`mt-0.5 text-xl font-bold ${color}`}>{value}</p>
              <p className="text-[11px] text-slate-400">units</p>
            </div>
          ))}
        </div>

        {/* Stock bar */}
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
            <span>0</span>
            <span className="font-medium text-slate-700">Reorder point: {data.reorder_point}</span>
          </div>
          <div className="relative h-3 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all ${
                isCritical ? "bg-red-500" : isLow ? "bg-amber-400" : "bg-emerald-500"
              }`}
              style={{ width: `${stockBarPct}%` }}
            />
            {/* Reorder point marker */}
            <div
              className="absolute top-0 h-full w-0.5 bg-slate-400"
              style={{ left: `${Math.min(100, Math.round((data.reorder_point / Math.max(data.reorder_point * 2, 1)) * 100))}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center gap-4 text-[11px] text-slate-500">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />Safe</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" />Low</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" />Critical</span>
          </div>
        </div>
      </div>

      {/* ── Velocity & forecast ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Avg daily sales",     value: `${data.avg_daily_sales.toFixed(1)} units/day`, color: "text-slate-900" },
          { label: "Days until stockout", value: `${data.days_until_stockout} days`, color: isCritical ? "text-red-600 font-bold" : isLow ? "text-amber-600" : "text-emerald-700" },
          { label: "Safety stock",        value: `${data.safety_stock} units`,       color: "text-slate-900" },
          { label: "Open PO qty",         value: `${data.open_po_qty} units`,         color: "text-blue-700" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] text-slate-400">{label}</p>
            <p className={`mt-0.5 text-sm font-semibold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Create purchase order ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Create purchase order</h3>

        {/* Supplier selector */}
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          {(["preferred", "best_price"] as const).map((s) => {
            const name = s === "preferred" ? data.preferred_supplier_name : data.best_price_supplier_name;
            const cost = s === "preferred" ? data.preferred_supplier_cost_cents : data.best_price_supplier_cost_cents;
            const lead = s === "preferred" ? data.preferred_supplier_lead_days : null;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSupplier(s)}
                className={`relative rounded-xl border-2 p-4 text-left transition-all ${
                  supplier === s ? "border-brand-600 bg-brand-600/5" : "border-slate-200 hover:border-slate-300"
                }`}
              >
                {s === "best_price" && data.savings_per_unit_cents > 0 && (
                  <span className="absolute right-3 top-3 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                    Save {formatMoney(data.savings_per_unit_cents)}/unit
                  </span>
                )}
                {s === "preferred" && (
                  <span className="absolute right-3 top-3 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                    Preferred
                  </span>
                )}
                <p className="text-sm font-semibold text-slate-900">{name}</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{formatMoney(cost)}<span className="ml-1 text-xs font-normal text-slate-400">/ unit</span></p>
                {lead && <p className="mt-0.5 text-[11px] text-slate-400">Lead time: {lead} days</p>}
              </button>
            );
          })}
        </div>

        {/* Qty + total */}
        <div className="mb-4 flex items-end gap-4">
          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Quantity to order</label>
            <input
              type="number"
              min="1"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
            />
            <p className="mt-1 text-[11px] text-slate-400">Suggested: {data.suggested_qty} units</p>
          </div>
          <div className="rounded-lg bg-slate-50 px-4 py-2.5 text-right">
            <p className="text-xs text-slate-400">Estimated cost</p>
            <p className="text-lg font-bold text-slate-900">{formatMoney(totalOrderCost)}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => router.push(`/purchasing/new?product=${productId}&supplier=${supplier === "preferred" ? data.preferred_supplier_id : data.best_price_supplier_id}&qty=${qtyNum}`)}
            className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-600"
          >
            Create Purchase Order
          </button>
          <button
            type="button"
            onClick={() => router.push(`/catalog/${productId}?tab=supplier-comparison`)}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Compare supplier prices
          </button>
        </div>
      </div>

    </div>
  );
}
