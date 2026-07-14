"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtDateTime } from "@/lib/date";

interface CustomerOrder {
  id: string;
  orderNumber: string;
  status: string;
  totalCents: number;
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  outlet_name?: string;
  cashier_name?: string;
  channel?: string;
  createdAt: number;
  lines?: Array<{ name: string; quantity: number; unitCents: number }>;
}

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  open:      { bg: "bg-blue-100",    text: "text-blue-700" },
  completed: { bg: "bg-emerald-100", text: "text-emerald-700" },
  refunded:  { bg: "bg-amber-100",   text: "text-amber-700" },
  voided:    { bg: "bg-red-100",     text: "text-red-600" },
};

export function OrdersTab({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [orders, setOrders]   = useState<CustomerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // Fetch all orders then filter by customerId (mock doesn't have customer-scoped endpoint yet)
      const res = await apiGet<{ items: CustomerOrder[] }>("/api/v1/orders?limit=200");
      const customerOrders = (res.items ?? []).filter(
        (o) => (o as unknown as { customerId?: string }).customerId === customerId
      );
      setOrders(customerOrders);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load orders.");
    } finally { setLoading(false); }
  }, [customerId]);

  useEffect(() => { void load(); }, [load]);

  const totalSpend  = orders.filter((o) => o.status === "completed").reduce((s, o) => s + o.totalCents, 0);
  const totalOrders = orders.length;
  const avgOrder    = totalOrders > 0 ? Math.round(totalSpend / Math.max(1, orders.filter((o) => o.status === "completed").length)) : 0;
  const lastOrder   = orders.length > 0 ? orders.reduce((a, b) => a.createdAt > b.createdAt ? a : b) : null;

  if (loading) return (
    <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />)}</div>
  );

  if (error) return <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total orders",  value: totalOrders, color: "text-slate-900" },
          { label: "Lifetime spend", value: formatMoney(totalSpend), color: "text-emerald-700" },
          { label: "Avg order",     value: avgOrder > 0 ? formatMoney(avgOrder) : "—", color: "text-slate-700" },
          { label: "Last order",    value: lastOrder ? fmtDateTime(lastOrder.createdAt) : "—", color: "text-slate-500" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] text-slate-400">{label}</p>
            <p className={`mt-0.5 text-sm font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Orders table */}
      {orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center">
          <p className="text-sm text-slate-400">No orders found for this customer.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr className="text-left">
                <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Order #</th>
                <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Status</th>
                <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Outlet</th>
                <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 text-right">Total</th>
                <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...orders].sort((a, b) => b.createdAt - a.createdAt).map((order) => {
                const st = STATUS_STYLES[order.status] ?? STATUS_STYLES.open;
                return (
                  <tr key={order.id} className="group cursor-pointer hover:bg-slate-50 transition-colors"
                    onClick={() => router.push(`/orders/${order.id}`)}>
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-semibold text-brand-600">{order.orderNumber}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold capitalize ${st.bg} ${st.text}`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-500">
                      {order.outlet_name ?? "—"}
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold text-slate-900">{formatMoney(order.totalCents)}</td>
                    <td className="px-5 py-3.5 text-xs text-slate-400 whitespace-nowrap">{fmtDateTime(order.createdAt)}</td>
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
