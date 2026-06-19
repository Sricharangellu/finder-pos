"use client";

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { formatMoney } from "@/lib/money";
import { apiGet, apiPost } from "@/api-client/client";
import type { SalesOrder, Quotation } from "@/api-client/types";

const SO_STATUS_STYLE: Record<string, string> = {
  pending_approve: "bg-blue-50 text-blue-700 ring-blue-200",
  approved: "bg-amber-50 text-amber-700 ring-amber-200",
  invoiced: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  partially_invoiced: "bg-amber-50 text-amber-700 ring-amber-200",
  cancelled: "bg-red-50 text-red-700 ring-red-200",
};
const QT_STATUS_STYLE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 ring-slate-200",
  sent: "bg-blue-50 text-blue-700 ring-blue-200",
  accepted: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  expired: "bg-amber-50 text-amber-700 ring-amber-200",
  cancelled: "bg-red-50 text-red-700 ring-red-200",
};

function Badge({ value, map }: { value: string; map: Record<string, string> }) {
  return (
    <span className={`inline-flex rounded px-2 py-1 text-xs font-semibold capitalize ring-1 ring-inset ${map[value] ?? "bg-slate-100 text-slate-700 ring-slate-200"}`}>
      {value.replace(/_/g, " ")}
    </span>
  );
}

export default function SalesPage() {
  const [tab, setTab] = useState<"orders" | "quotes">("orders");
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [quotes, setQuotes] = useState<Quotation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [so, qt] = await Promise.all([
        apiGet<{ items: SalesOrder[] }>("/api/v1/sales/sales-orders"),
        apiGet<{ items: Quotation[] }>("/api/v1/sales/quotations"),
      ]);
      setOrders(so.items ?? []);
      setQuotes(qt.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sales data");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (path: string) => {
    setBusy(true);
    try {
      await apiPost(path, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <EnterpriseShell
      active="sales"
      title="Sales"
      subtitle="Quotations · approvals · invoicing"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-950">Sales operations</h1>
            <p className="mt-1 text-sm text-slate-500">
              Manage quotation conversion, approval queues, and invoice readiness.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:w-[26rem]">
            <SummaryTile label="Open orders" value={String(orders.length)} />
            <SummaryTile label="Open quotes" value={String(quotes.length)} />
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="inline-flex rounded-md border border-slate-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setTab("orders")}
            className={`min-h-[38px] rounded px-4 text-sm font-medium transition-colors ${
              tab === "orders" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Sales Orders ({orders.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("quotes")}
            className={`min-h-[38px] rounded px-4 text-sm font-medium transition-colors ${
              tab === "quotes" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Quotations ({quotes.length})
          </button>
        </div>

        {tab === "orders" ? (
          <Card title="Sales Orders" description="Approve and invoice open orders." noPadding>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                    <th className="px-5 py-3">SO #</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Store</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orders.length === 0 && (
                    <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-500">No sales orders</td></tr>
                  )}
                  {orders.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-5 py-3 font-medium text-slate-950">{o.so_number}</td>
                      <td className="whitespace-nowrap px-4 py-3"><Badge value={o.status} map={SO_STATUS_STYLE} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{o.store_id ?? "-"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{formatMoney(o.total_cents)}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right">
                        {o.status === "pending_approve" && (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(`/api/v1/sales/sales-orders/${o.id}/approve`)}>Approve</Button>
                        )}
                        {o.status === "approved" && (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(`/api/v1/sales/sales-orders/${o.id}/invoice`)}>Invoice</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Card title="Quotations" description="Send, accept, and convert quotes to sales orders." noPadding>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                    <th className="px-5 py-3">Quote #</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {quotes.length === 0 && (
                    <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-500">No quotations</td></tr>
                  )}
                  {quotes.map((q) => (
                    <tr key={q.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-5 py-3 font-medium text-slate-950">{q.quote_number}</td>
                      <td className="whitespace-nowrap px-4 py-3"><Badge value={q.status} map={QT_STATUS_STYLE} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{formatMoney(q.total_cents)}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right">
                        {q.status === "draft" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(`/api/v1/sales/quotations/${q.id}/send`)}>Send</Button>}
                        {q.status === "sent" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(`/api/v1/sales/quotations/${q.id}/accept`)}>Accept</Button>}
                        {q.status !== "cancelled" && q.status !== "expired" && (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(`/api/v1/sales/quotations/${q.id}/convert`)}>Convert</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </EnterpriseShell>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{value}</p>
    </div>
  );
}
