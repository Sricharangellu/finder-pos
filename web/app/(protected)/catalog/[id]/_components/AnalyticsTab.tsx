"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TrendPoint {
  date: number;
  units: number;
  revenue_cents: number;
}

interface AnalyticsSummary {
  revenue_cents: number;
  units_sold: number;
  orders: number;
  avg_order_qty: number;
  return_rate_pct: number;
  gross_margin_pct: number;
  inventory_turnover: number;
  abc_class: "A" | "B" | "C";
}

interface AnalyticsData {
  period: string;
  trend: TrendPoint[];
  summary: AnalyticsSummary;
}

type Period = "7d" | "30d" | "90d" | "12m";

const PERIOD_LABELS: Record<Period, string> = { "7d": "7 Days", "30d": "30 Days", "90d": "90 Days", "12m": "12 Months" };

const ABC_COLOR: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-700",
  B: "bg-amber-100 text-amber-700",
  C: "bg-red-100 text-red-700",
};

// ── Sparkline chart ───────────────────────────────────────────────────────────

function Sparkline({ data, height = 80 }: { data: TrendPoint[]; height?: number }) {
  if (data.length < 2) return null;
  const maxRevenue = Math.max(...data.map((d) => d.revenue_cents));
  if (maxRevenue === 0) return null;

  const width = 600;
  const pad   = 4;
  const pts   = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * (width - pad * 2);
    const y = pad + ((1 - d.revenue_cents / maxRevenue) * (height - pad * 2));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5D5FEF" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#5D5FEF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`${pad},${height} ${pts.join(" ")} ${width - pad},${height}`}
        fill="url(#spark-fill)"
      />
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke="#5D5FEF"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AnalyticsTab({ productId }: { productId: string }) {
  const [period, setPeriod]   = useState<Period>("30d");
  const [data, setData]       = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await apiGet<AnalyticsData>(`/api/v1/catalog/${productId}/analytics?period=${period}`);
      setData(d);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load analytics.");
    } finally { setLoading(false); }
  }, [productId, period]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-5">

      {/* ── Period selector ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Product Analytics</h3>
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          {(["7d", "30d", "90d", "12m"] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${period === p ? "bg-brand-600 text-white" : "text-slate-500 hover:text-slate-700"}`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <div className="space-y-4">
          <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
          <div className="h-48 animate-pulse rounded-lg bg-slate-100" />
        </div>
      ) : data ? (
        <>
          {/* ── KPI cards ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs text-slate-400">Revenue</p>
              <p className="mt-1 text-xl font-bold text-slate-900">{formatMoney(data.summary.revenue_cents)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs text-slate-400">Units Sold</p>
              <p className="mt-1 text-xl font-bold text-slate-900">{data.summary.units_sold.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs text-slate-400">Orders</p>
              <p className="mt-1 text-xl font-bold text-slate-900">{data.summary.orders.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs text-slate-400">Avg Order Qty</p>
              <p className="mt-1 text-xl font-bold text-slate-900">{data.summary.avg_order_qty}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs text-slate-400">Gross Margin</p>
              <p className={`mt-1 text-xl font-bold ${data.summary.gross_margin_pct >= 30 ? "text-emerald-600" : data.summary.gross_margin_pct > 0 ? "text-amber-600" : "text-red-600"}`}>
                {data.summary.gross_margin_pct.toFixed(1)}%
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs text-slate-400">Return Rate</p>
              <p className={`mt-1 text-xl font-bold ${data.summary.return_rate_pct < 3 ? "text-emerald-600" : data.summary.return_rate_pct < 8 ? "text-amber-600" : "text-red-600"}`}>
                {data.summary.return_rate_pct}%
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs text-slate-400">Inventory Turnover</p>
              <p className="mt-1 text-xl font-bold text-slate-900">{data.summary.inventory_turnover}×</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs text-slate-400">ABC Class</p>
              <div className="mt-1">
                <span className={`rounded-full px-3 py-1 text-sm font-bold ${ABC_COLOR[data.summary.abc_class] ?? "bg-slate-100 text-slate-600"}`}>
                  Class {data.summary.abc_class}
                </span>
              </div>
            </div>
          </div>

          {/* ── Revenue trend chart ───────────────────────────────────────── */}
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-[#111]">Revenue Trend — {PERIOD_LABELS[period]}</h3>
            </div>
            <div className="px-5 py-4">
              <div className="relative h-40">
                <Sparkline data={data.trend} height={160} />
              </div>
              {/* X-axis labels: first and last date */}
              {data.trend.length > 1 && (
                <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                  <span>{new Date(data.trend[0].date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  <span>{new Date(data.trend[data.trend.length - 1].date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Daily breakdown table (last 7 days) ─────────────────────── */}
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-[#111]">Recent Daily Breakdown</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left">
                  <tr>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Date</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Units</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...data.trend].reverse().slice(0, 7).map((pt) => (
                    <tr key={pt.date} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-slate-600">
                        {new Date(pt.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{pt.units}</td>
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{formatMoney(pt.revenue_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
