"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { apiGet, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/date";
import type { ProductSaleRecord, ProductSalesResponse } from "@/api-client/types";

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash", card: "Card", gift_card: "Gift Card", split: "Split",
};

const METHOD_COLOR: Record<string, string> = {
  cash: "bg-emerald-100 text-emerald-700",
  card: "bg-blue-100 text-blue-700",
  gift_card: "bg-purple-100 text-purple-700",
  split: "bg-amber-100 text-amber-700",
};

type Period = "7d" | "30d" | "90d" | "all";

const PERIODS: { key: Period; label: string }[] = [
  { key: "7d",  label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "all", label: "All time" },
];

const DAY = 86_400_000;
const CUTOFF: Record<Period, number> = {
  "7d":  Date.now() - 7  * DAY,
  "30d": Date.now() - 30 * DAY,
  "90d": Date.now() - 90 * DAY,
  "all": 0,
};

export function SalesTab({ productId }: { productId: string }) {
  const [data, setData]       = useState<ProductSalesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [period, setPeriod]   = useState<Period>("all");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await apiGet<ProductSalesResponse>(`/api/v1/catalog/${productId}/sales?limit=500`);
      setData(res);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load sales.");
    } finally { setLoading(false); }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  const items = useMemo<ProductSaleRecord[]>(() => {
    const all = data?.items ?? [];
    const cut = CUTOFF[period];
    return cut > 0 ? all.filter((s) => s.date >= cut) : all;
  }, [data, period]);

  const totalRevenue = useMemo(() => items.reduce((s, r) => s + r.total_cents, 0), [items]);
  const totalUnits   = useMemo(() => items.reduce((s, r) => s + r.quantity, 0), [items]);
  const avgOrder     = items.length > 0 ? Math.round(totalRevenue / items.length) : 0;

  return (
    <div className="space-y-4">

      {/* Period filter */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          {PERIODS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setPeriod(key)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                period === key
                  ? "bg-brand-600 text-white"
                  : "text-slate-500 hover:text-[#111]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void load()} className="text-xs text-slate-400 hover:text-[#111]">
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Transactions",  value: items.length },
          { label: "Units sold",    value: totalUnits.toLocaleString() },
          { label: "Revenue",       value: formatMoney(totalRevenue) },
          { label: "Avg order",     value: formatMoney(avgOrder) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-[#111]">Sales history</h3>
          <span className="text-xs text-slate-400">{items.length} records</span>
        </div>

        {loading ? (
          <div className="space-y-2 p-4">{[1,2,3,4].map((i)=><div key={i} className="h-10 animate-pulse rounded bg-slate-100"/>)}</div>
        ) : error ? (
          <p className="px-5 py-4 text-sm text-red-600">{error}</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">
            No sales in the selected period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">Sale #</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Unit price</th>
                  <th className="px-4 py-3 text-right">Tax</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left">Cashier</th>
                  <th className="px-4 py-3 text-left">Payment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {items.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-brand-600">{s.sale_number}</td>
                    <td className="px-4 py-3 text-slate-600">{fmtDate(s.date)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">{s.quantity}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatMoney(s.unit_price_cents)}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{formatMoney(s.tax_cents)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">{formatMoney(s.total_cents)}</td>
                    <td className="px-4 py-3 text-slate-600">{s.customer_name ?? <span className="text-slate-400">Walk-in</span>}</td>
                    <td className="px-4 py-3 text-slate-600">{s.cashier_name}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${METHOD_COLOR[s.payment_method] ?? "bg-slate-100 text-slate-600"}`}>
                        {METHOD_LABEL[s.payment_method] ?? s.payment_method}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
