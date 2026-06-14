"use client";

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { formatMoney } from "@/lib/money";
import { apiGet, apiPost } from "@/api-client/client";

interface SalesOrder {
  id: string;
  so_number: string;
  customer_id: string;
  status: string;
  total_cents: number;
  store_id: string | null;
  created_at: number;
}
interface Quotation {
  id: string;
  quote_number: string;
  customer_id: string;
  status: string;
  total_cents: number;
  created_at: number;
}

const SO_STATUS_STYLE: Record<string, string> = {
  pending_approve: "bg-blue-100 text-blue-800",
  approved: "bg-amber-100 text-amber-800",
  invoiced: "bg-green-100 text-green-800",
  partially_invoiced: "bg-amber-100 text-amber-800",
  cancelled: "bg-red-100 text-red-700",
};
const QT_STATUS_STYLE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-800",
  accepted: "bg-green-100 text-green-800",
  expired: "bg-amber-100 text-amber-800",
  cancelled: "bg-red-100 text-red-700",
};

function Badge({ value, map }: { value: string; map: Record<string, string> }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${map[value] ?? "bg-gray-100 text-gray-700"}`}>
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
    <EnterpriseShell active="sales" title="Sales" subtitle="Quotations → Sales Orders → Invoice">
      <div className="space-y-4 p-4">
        {error && <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
        <div className="flex gap-2">
          <Button variant={tab === "orders" ? "primary" : "ghost"} size="sm" onClick={() => setTab("orders")}>
            Sales Orders ({orders.length})
          </Button>
          <Button variant={tab === "quotes" ? "primary" : "ghost"} size="sm" onClick={() => setTab("quotes")}>
            Quotations ({quotes.length})
          </Button>
        </div>

        {tab === "orders" ? (
          <Card title="Sales Orders" description="Approve and invoice open orders.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="py-2 pr-4">SO #</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Store</th>
                    <th className="py-2 pr-4 text-right">Total</th>
                    <th className="py-2 pr-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0 && (
                    <tr><td colSpan={5} className="py-6 text-center text-gray-400">No sales orders</td></tr>
                  )}
                  {orders.map((o) => (
                    <tr key={o.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{o.so_number}</td>
                      <td className="py-2 pr-4"><Badge value={o.status} map={SO_STATUS_STYLE} /></td>
                      <td className="py-2 pr-4 text-gray-500">{o.store_id ?? "—"}</td>
                      <td className="py-2 pr-4 text-right">{formatMoney(o.total_cents)}</td>
                      <td className="py-2 pr-4 text-right">
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
          <Card title="Quotations" description="Send, accept, and convert quotes to sales orders.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="py-2 pr-4">Quote #</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4 text-right">Total</th>
                    <th className="py-2 pr-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.length === 0 && (
                    <tr><td colSpan={4} className="py-6 text-center text-gray-400">No quotations</td></tr>
                  )}
                  {quotes.map((q) => (
                    <tr key={q.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{q.quote_number}</td>
                      <td className="py-2 pr-4"><Badge value={q.status} map={QT_STATUS_STYLE} /></td>
                      <td className="py-2 pr-4 text-right">{formatMoney(q.total_cents)}</td>
                      <td className="py-2 pr-4 text-right">
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
