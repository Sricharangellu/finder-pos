"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/date";
import type { ProductInvoice, ProductInvoicesResponse } from "@/api-client/types";

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  partial: "bg-blue-100 text-blue-700",
  received: "bg-emerald-100 text-emerald-700",
  invoiced: "bg-purple-100 text-purple-700",
  cancelled: "bg-red-100 text-red-700",
};

export function InvoicesTab({ productId }: { productId: string }) {
  const [data, setData] = useState<ProductInvoicesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await apiGet<ProductInvoicesResponse>(`/api/v1/catalog/${productId}/invoices?limit=100`);
      setData(res);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load invoices.");
    } finally { setLoading(false); }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  const items: ProductInvoice[] = data?.items ?? [];
  const pendingCount = items.filter((i) => i.status === "pending" || i.status === "partial").length;

  // Calculate avg landed cost
  const totalCost = data?.total_cost_cents ?? 0;
  const totalUnits = data?.total_units_ordered ?? 0;
  const avgCost = totalUnits > 0 ? Math.round(totalCost / totalUnits) : 0;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Purchase orders", value: data?.total ?? 0 },
          { label: "Units ordered", value: (data?.total_units_ordered ?? 0).toLocaleString() },
          { label: "Total cost", value: data ? formatMoney(data.total_cost_cents) : "—" },
          { label: "Avg landed cost", value: formatMoney(avgCost) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
          </div>
        ))}
      </div>

      {pendingCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          <span>ℹ</span>
          <span><strong>{pendingCount}</strong> order{pendingCount !== 1 ? "s" : ""} pending receipt.</span>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-[#111]">Purchase / invoice history</h3>
          <span className="text-xs text-slate-400">{items.length} records</span>
        </div>

        {loading ? (
          <div className="space-y-2 p-4">{[1,2,3].map((i)=><div key={i} className="h-10 animate-pulse rounded bg-slate-100"/>)}</div>
        ) : error ? (
          <p className="px-5 py-4 text-sm text-red-600">{error}</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">No purchase orders for this product yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">PO #</th>
                  <th className="px-4 py-3 text-left">Invoice #</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Supplier</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Unit cost</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-left">Lot</th>
                  <th className="px-4 py-3 text-left">Expiry</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {items.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-[#5D5FEF]">{inv.po_number}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{inv.invoice_number ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-3 text-slate-600">{fmtDate(inv.date)}</td>
                    <td className="px-4 py-3 text-slate-600">{inv.supplier_name}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">{inv.quantity.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatMoney(inv.unit_cost_cents)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">{formatMoney(inv.total_cost_cents)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 font-mono">{inv.lot_code ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {inv.expiry_date ? fmtDate(inv.expiry_date) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_COLOR[inv.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {inv.status}
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
