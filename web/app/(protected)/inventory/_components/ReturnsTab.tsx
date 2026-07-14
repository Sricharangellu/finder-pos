"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@/lib/useQuery";
import { apiGet } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { TableSkeleton } from "@/components/TableSkeleton";

interface SupplierReturn {
  id: string;
  return_number: string;
  supplier: string;
  from_location: string;
  status: string;
  qty: number;
  total_cost_cents: number;
  created_at: number;
  note: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending:  "bg-amber-50 text-amber-700",
  sent:     "bg-blue-50 text-blue-700",
  credited: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
};

function fmt(ts: number) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "2-digit" }).format(new Date(ts));
}

export function ReturnsTab() {
  const [show, setShow] = useState("All");
  const [search, setSearch] = useState("");
  const [outlet, setOutlet] = useState("All");

  const { data, loading, error } =
    useQuery("inventory:returns", () => apiGet<{ items: SupplierReturn[] }>("/api/v1/inventory/supplier-returns"));

  const returns = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.items ?? []).filter((r) => {
      const matchShow = show === "All" || r.status === show;
      const matchQ = !q || r.return_number.toLowerCase().includes(q) ||
        r.supplier.toLowerCase().includes(q) ||
        r.from_location.toLowerCase().includes(q);
      const matchOutlet = outlet === "All" || r.from_location === outlet;
      return matchShow && matchQ && matchOutlet;
    });
  }, [data, show, search, outlet]);

  const totalQty = useMemo(() => returns.reduce((s, r) => s + r.qty, 0), [returns]);
  const totalCost = useMemo(() => returns.reduce((s, r) => s + r.total_cost_cents, 0), [returns]);

  return (
    <>
      {/* Filter bar */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-end gap-3 px-4 py-4">
          <div className="w-36">
            <label className="mb-1 block text-xs font-medium text-slate-500">Show</label>
            <select value={show} onChange={(e) => setShow(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-[#111] outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600">
              <option value="All">All returns</option>
              <option value="pending">Pending</option>
              <option value="sent">Sent</option>
              <option value="credited">Credited</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div className="min-w-[160px] flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-500">Search</label>
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Return # or supplier…"
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
            Displaying {returns.length} returns · {totalQty} total qty · {formatMoney(totalCost)} total cost
          </span>
          <button type="button"
            className="rounded-md border border-brand-600 px-3 py-1.5 text-xs font-semibold text-brand-600 transition-colors hover:bg-brand-600/5">
            New return
          </button>
        </div>

        {loading ? (
          <TableSkeleton headers={["Return #", "Supplier", "From", "Status", "Created", "Qty", "Cost"]} rows={5} />
        ) : error ? (
          <div className="p-6 text-sm text-red-600" role="alert">{error}</div>
        ) : returns.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-500">No returns match the current filters.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3 text-left">Return # / Note</th>
                <th className="px-4 py-3 text-left">Supplier</th>
                <th className="px-4 py-3 text-left">From</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Total cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {returns.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-[#FAFAFA]">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[#111]">{r.return_number}</div>
                    {r.note && <div className="text-xs text-[#666]">{r.note}</div>}
                  </td>
                  <td className="px-4 py-3 text-[#111]">{r.supplier}</td>
                  <td className="px-4 py-3 text-[#666]">{r.from_location}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_COLORS[r.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#666]">{fmt(r.created_at)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-[#111]">{r.qty}</td>
                  <td className="px-4 py-3 text-right font-semibold text-[#111]">{formatMoney(r.total_cost_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
