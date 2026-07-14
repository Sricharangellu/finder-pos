"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/date";
import type { ProductCredit, ProductCreditsResponse } from "@/api-client/types";

const STATUS_COLOR: Record<string, string> = {
  issued: "bg-blue-100 text-blue-700",
  applied: "bg-emerald-100 text-emerald-700",
  expired: "bg-slate-100 text-slate-500",
  voided: "bg-red-100 text-red-700",
};

export function CreditsTab({ productId }: { productId: string }) {
  const [data, setData] = useState<ProductCreditsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await apiGet<ProductCreditsResponse>(`/api/v1/catalog/${productId}/credits?limit=100`);
      setData(res);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load credits.");
    } finally { setLoading(false); }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  const items: ProductCredit[] = data?.items ?? [];
  const issuedCount = items.filter((c) => c.status === "issued").length;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Total credits", value: data?.total ?? 0 },
          { label: "Outstanding credits", value: data ? formatMoney(data.total_credits_cents) : "—" },
          { label: "Issued (outstanding)", value: issuedCount },
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
          <h3 className="text-sm font-semibold text-[#111]">Credit notes</h3>
          <span className="text-xs text-slate-400">{items.length} records</span>
        </div>

        {loading ? (
          <div className="space-y-2 p-4">{[1,2,3].map((i)=><div key={i} className="h-10 animate-pulse rounded bg-slate-100"/>)}</div>
        ) : error ? (
          <p className="px-5 py-4 text-sm text-red-600">{error}</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">No credit notes for this product.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">Credit #</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left">Reason</th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Expires</th>
                  <th className="px-4 py-3 text-left">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {items.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-brand-600">{c.credit_number}</td>
                    <td className="px-4 py-3 text-slate-600">{fmtDate(c.date)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-600">{formatMoney(c.amount_cents)}</td>
                    <td className="px-4 py-3 text-slate-600 max-w-[160px] truncate">{c.reason}</td>
                    <td className="px-4 py-3 text-slate-600">{c.customer_name ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_COLOR[c.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {c.expires_at ? fmtDate(c.expires_at) : <span className="text-slate-400">No expiry</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 max-w-[120px] truncate">{c.notes ?? "—"}</td>
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
