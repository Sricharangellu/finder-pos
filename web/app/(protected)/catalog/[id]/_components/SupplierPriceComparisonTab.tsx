"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PricePoint { date: number; cost: number; }

interface SupplierComparison {
  supplier_id: string;
  supplier_name: string;
  is_preferred: boolean;
  vendor_sku: string | null;
  last_purchase_date: number | null;
  last_cost_cents: number;
  landed_cost_cents: number;
  moq: number | null;
  lead_time_days: number | null;
  price_30d_trend: "up" | "down" | "stable";
  price_history: PricePoint[];
}

interface ComparisonResponse {
  items: SupplierComparison[];
  best_price_supplier_id: string;
  current_retail_price_cents: number;
}

function fmtDate(ts: number | null) {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(ts));
}

function TrendBadge({ trend }: { trend: "up" | "down" | "stable" }) {
  if (trend === "up")     return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">↑ Rising</span>;
  if (trend === "down")   return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">↓ Falling</span>;
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">→ Stable</span>;
}

function MiniSparkline({ history, min, max }: { history: PricePoint[]; min: number; max: number }) {
  if (history.length < 2) return null;
  const range = max - min || 1;
  const w = 80; const h = 28;
  const pts = history.map((p, i) => {
    const x = (i / (history.length - 1)) * w;
    const y = h - ((p.cost - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  const last = history[history.length - 1]!;
  const prev = history[history.length - 2]!;
  const color = last.cost > prev.cost ? "#ef4444" : last.cost < prev.cost ? "#10b981" : "#94a3b8";
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SupplierPriceComparisonTab({ productId }: { productId: string }) {
  const router = useRouter();
  const [data, setData]       = useState<ComparisonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await apiGet<ComparisonResponse>(`/api/v1/catalog/${productId}/supplier-price-comparison`);
      setData(d);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load comparison data.");
    } finally { setLoading(false); }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}
    </div>
  );

  if (error) return <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!data || data.items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center">
        <p className="text-sm text-slate-400">No supplier pricing data available.</p>
        <button type="button" onClick={() => router.push(`/catalog/${productId}?tab=suppliers`)}
          className="mt-2 text-sm text-brand-600 hover:underline">
          Add a supplier
        </button>
      </div>
    );
  }

  const allCosts = data.items.flatMap((s) => s.price_history.map((p) => p.cost));
  const minCost  = Math.min(...allCosts);
  const maxCost  = Math.max(...allCosts);

  const retailMargins = data.items.map((s) => ({
    id: s.supplier_id,
    margin: ((data.current_retail_price_cents - s.last_cost_cents) / data.current_retail_price_cents) * 100,
  }));

  const sortedItems = [...data.items].sort((a, b) => a.last_cost_cents - b.last_cost_cents);
  const cheapest    = sortedItems[0];

  return (
    <div className="space-y-5">

      {/* ── Best price callout ────────────────────────────────────────────────── */}
      {cheapest && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <div>
            <p className="text-sm font-semibold text-emerald-900">
              Best price: {formatMoney(cheapest.last_cost_cents)}/unit from {cheapest.supplier_name}
            </p>
            <p className="mt-0.5 text-xs text-emerald-700">
              {data.items.length > 1
                ? `Saves ${formatMoney(data.items.reduce((max, s) => Math.max(max, s.last_cost_cents - cheapest.last_cost_cents), 0))}/unit vs most expensive option`
                : "Only supplier on record"}
            </p>
          </div>
        </div>
      )}

      {/* ── Comparison table ──────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Supplier pricing comparison</h3>
          <p className="text-xs text-slate-400">Retail price: {formatMoney(data.current_retail_price_cents)}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100">
              <tr className="text-left">
                <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Supplier</th>
                <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Vendor SKU</th>
                <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Unit Cost</th>
                <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Landed Cost</th>
                <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Margin</th>
                <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">MOQ</th>
                <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Lead Time</th>
                <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">30d Trend</th>
                <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Price History</th>
                <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Last Order</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedItems.map((s, i) => {
                const isBest = s.last_cost_cents === cheapest?.last_cost_cents;
                const margin = retailMargins.find((m) => m.id === s.supplier_id)?.margin ?? 0;
                return (
                  <tr key={s.supplier_id} className={`hover:bg-slate-50/70 transition-colors ${isBest ? "bg-emerald-50/30" : ""}`}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        {isBest && (
                          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700">Best</span>
                        )}
                        {s.is_preferred && (
                          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-700">Preferred</span>
                        )}
                        <span className="font-medium text-slate-900">{s.supplier_name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-500">{s.vendor_sku ?? "—"}</td>
                    <td className="px-5 py-3.5">
                      <span className={`font-semibold ${isBest ? "text-emerald-700" : i === sortedItems.length - 1 ? "text-red-600" : "text-slate-900"}`}>
                        {formatMoney(s.last_cost_cents)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-600">{formatMoney(s.landed_cost_cents)}</td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs font-semibold ${
                        margin >= 35 ? "text-emerald-700" : margin >= 20 ? "text-amber-600" : "text-red-600"
                      }`}>
                        {margin.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-600">{s.moq ?? "—"}</td>
                    <td className="px-5 py-3.5 text-xs text-slate-600">{s.lead_time_days != null ? `${s.lead_time_days}d` : "—"}</td>
                    <td className="px-5 py-3.5"><TrendBadge trend={s.price_30d_trend} /></td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-end gap-2">
                        <MiniSparkline history={s.price_history} min={minCost} max={maxCost} />
                        <div className="text-right">
                          <p className="text-[10px] text-slate-400">Low: {formatMoney(Math.min(...s.price_history.map((p) => p.cost)))}</p>
                          <p className="text-[10px] text-slate-400">High: {formatMoney(Math.max(...s.price_history.map((p) => p.cost)))}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-500">{fmtDate(s.last_purchase_date)}</td>
                    <td className="px-5 py-3.5">
                      <button
                        type="button"
                        onClick={() => router.push(`/purchasing/new?supplier=${s.supplier_id}&product=${productId}`)}
                        className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-600 whitespace-nowrap"
                      >
                        Create PO
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Price history detail ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Price history (last 90 days)</h3>
        <div className="space-y-4">
          {sortedItems.map((s) => (
            <div key={s.supplier_id}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700">{s.supplier_name}</span>
                <span className="text-xs text-slate-400">Current: {formatMoney(s.last_cost_cents)}</span>
              </div>
              <div className="flex gap-3">
                {s.price_history.map((point, idx) => {
                  const prevCost = idx > 0 ? s.price_history[idx - 1]!.cost : point.cost;
                  const pct = maxCost > minCost ? ((point.cost - minCost) / (maxCost - minCost)) * 100 : 50;
                  return (
                    <div key={idx} className="flex-1 text-center">
                      <div className="mb-1 h-12 relative flex items-end justify-center">
                        <div
                          className={`w-4 rounded-t transition-all ${
                            point.cost < prevCost ? "bg-emerald-400" : point.cost > prevCost ? "bg-red-400" : "bg-slate-300"
                          }`}
                          style={{ height: `${Math.max(8, pct)}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-slate-900 font-semibold">{formatMoney(point.cost)}</p>
                      <p className="text-[9px] text-slate-400">
                        {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(point.date))}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
