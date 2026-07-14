"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@/lib/useQuery";
import { apiGet } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { TableSkeleton } from "@/components/TableSkeleton";

interface PurchaseOrder {
  id: string;
  po_number: number;
  supplier_id: string;
  status: string;
  receive_status: string;
  total_cost_cents: number;
  created_at: number;
  received_at: number | null;
}

interface Supplier { id: string; name: string; }

const STATUS_COLORS: Record<string, string> = {
  received: "bg-emerald-50 text-emerald-700",
  ordered:  "bg-blue-50 text-blue-700",
  draft:    "bg-slate-100 text-slate-600",
  cancelled:"bg-red-50 text-red-700",
  partial:  "bg-amber-50 text-amber-700",
};

function fmt(ts: number) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "2-digit" }).format(new Date(ts));
}

export function OrdersTab() {
  const [show, setShow] = useState("All");
  const [search, setSearch] = useState("");
  const [outlet, setOutlet] = useState("All");

  const { data: ordersData, loading, error } =
    useQuery("purchasing:orders", () => apiGet<{ items: PurchaseOrder[] }>("/api/v1/purchasing/orders"));
  const { data: suppliersData } =
    useQuery("purchasing:suppliers", () => apiGet<{ items: Supplier[] }>("/api/v1/purchasing/suppliers"));

  const supplierMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of suppliersData?.items ?? []) map[s.id] = s.name;
    return map;
  }, [suppliersData]);

  const orders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (ordersData?.items ?? []).filter((o) => {
      const supplier = (supplierMap[o.supplier_id] ?? o.supplier_id).toLowerCase();
      const matchShow = show === "All" || o.status === show;
      const matchQ = !q || String(o.po_number).includes(q) || supplier.includes(q);
      return matchShow && matchQ;
    });
  }, [ordersData, supplierMap, show, search]);

  const totalCost = useMemo(() => orders.reduce((s, o) => s + o.total_cost_cents, 0), [orders]);

  return (
    <>
      {/* Filter bar */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-end gap-3 px-4 py-4">
          <div className="w-36">
            <label className="mb-1 block text-xs font-medium text-slate-500">Show</label>
            <select value={show} onChange={(e) => setShow(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-[#111] outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600">
              <option value="All">All orders</option>
              <option value="ordered">Ordered</option>
              <option value="received">Received</option>
              <option value="draft">Draft</option>
            </select>
          </div>
          <div className="min-w-[160px] flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-500">Search</label>
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="PO number or supplier…"
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-[#111] outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600" />
          </div>
          <div className="w-40">
            <label className="mb-1 block text-xs font-medium text-slate-500">Outlet</label>
            <select value={outlet} onChange={(e) => setOutlet(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-[#111] outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600">
              <option value="All">All outlets</option>
              <option value="Main Store">Main Store</option>
              <option value="Downtown">Downtown</option>
            </select>
          </div>
          <div className="ml-auto flex items-center gap-4 pb-0.5">
            <button type="button" onClick={() => { setShow("All"); setSearch(""); setOutlet("All"); }}
              className="text-sm text-brand-600 hover:underline">Clear filters</button>
            <button type="button" className="text-sm text-slate-500 hover:text-slate-700">More filters</button>
            <button type="button"
              className="rounded-md bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#4849d0]">
              Search
            </button>
          </div>
        </div>
      </div>

      {/* Table card */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          <span className="text-sm text-slate-500">
            Displaying {orders.length} orders · {formatMoney(totalCost)} total cost
          </span>
          <button type="button"
            className="rounded-md border border-brand-600 px-3 py-1.5 text-xs font-semibold text-brand-600 transition-colors hover:bg-brand-600/5">
            New order
          </button>
        </div>

        {loading ? (
          <TableSkeleton headers={["Order #", "From", "To", "Status", "Created", "Total cost"]} rows={5} />
        ) : error ? (
          <div className="p-6 text-sm text-red-600" role="alert">{error}</div>
        ) : orders.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-500">No orders match the current filters.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3 text-left">Order # / Date</th>
                <th className="px-4 py-3 text-left">From</th>
                <th className="px-4 py-3 text-left">To</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-right">Total cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((o) => (
                <tr key={o.id} className="cursor-pointer hover:bg-[#FAFAFA]">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[#111]">PO-{o.po_number}</div>
                    {o.received_at && (
                      <div className="text-xs text-[#666]">Received {fmt(o.received_at)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#111]">{supplierMap[o.supplier_id] ?? o.supplier_id}</td>
                  <td className="px-4 py-3 text-[#666]">Main Store</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_COLORS[o.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {o.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#666]">{fmt(o.created_at)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-[#111]">{formatMoney(o.total_cost_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
