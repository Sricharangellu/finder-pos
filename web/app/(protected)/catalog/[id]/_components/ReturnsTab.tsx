"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/date";
import type { ProductReturn, ProductReturnsResponse } from "@/api-client/types";

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
  restocked: "bg-blue-100 text-blue-700",
};

const REASON_LABEL: Record<string, string> = {
  defective: "Defective",
  wrong_item: "Wrong item",
  customer_changed_mind: "Changed mind",
  expired: "Expired",
  damaged: "Damaged",
  other: "Other",
};

export function ReturnsTab({ productId }: { productId: string }) {
  const [data, setData] = useState<ProductReturnsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await apiGet<ProductReturnsResponse>(`/api/v1/catalog/${productId}/returns?limit=100`);
      setData(res);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load returns.");
    } finally { setLoading(false); }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  const items: ProductReturn[] = data?.items ?? [];
  const pendingCount = items.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total returns", value: data?.total ?? 0, highlight: false },
          { label: "Units returned", value: data?.total_units_returned ?? 0, highlight: false },
          { label: "Total refunded", value: data ? formatMoney(data.total_refunded_cents) : "—", highlight: false },
          { label: "Pending review", value: pendingCount, highlight: pendingCount > 0 },
        ].map(({ label, value, highlight }) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`mt-1 text-xl font-bold ${highlight ? "text-amber-600" : "text-slate-900"}`}>{value}</p>
          </div>
        ))}
      </div>

      {pendingCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-700">
          <span>ℹ</span>
          <span><strong>{pendingCount}</strong> return{pendingCount !== 1 ? "s" : ""} pending review.</span>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-[#111]">Return history</h3>
          <span className="text-xs text-slate-400">{items.length} records</span>
        </div>

        {loading ? (
          <div className="space-y-2 p-4">{[1,2,3].map((i)=><div key={i} className="h-10 animate-pulse rounded bg-slate-100"/>)}</div>
        ) : error ? (
          <p className="px-5 py-4 text-sm text-red-600">{error}</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">No returns recorded for this product.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">Return #</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Original sale</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Refund</th>
                  <th className="px-4 py-3 text-left">Reason</th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {items.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-brand-600">{r.return_number}</td>
                    <td className="px-4 py-3 text-slate-600">{fmtDate(r.date)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {r.original_sale_number ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">{r.quantity}</td>
                    <td className="px-4 py-3 text-right font-semibold text-red-600">{formatMoney(r.refund_cents)}</td>
                    <td className="px-4 py-3 text-slate-600">{REASON_LABEL[r.reason] ?? r.reason}</td>
                    <td className="px-4 py-3 text-slate-600">{r.customer_name ?? <span className="text-slate-400">Walk-in</span>}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_COLOR[r.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 max-w-[120px] truncate">{r.notes ?? "—"}</td>
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
