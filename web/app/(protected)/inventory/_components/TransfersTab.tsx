"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@/lib/useQuery";
import { apiGet } from "@/api-client/client";
import { TableSkeleton } from "@/components/TableSkeleton";

interface Transfer {
  id: string;
  transfer_number: string;
  from_location: string;
  to_location: string;
  status: string;
  qty: number;
  created_at: number;
  due_date: number;
  note: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  completed:  "bg-emerald-50 text-emerald-700",
  in_transit: "bg-blue-50 text-blue-700",
  pending:    "bg-amber-50 text-amber-700",
  cancelled:  "bg-red-50 text-red-700",
};

function fmt(ts: number) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "2-digit" }).format(new Date(ts));
}

export function TransfersTab() {
  const [show, setShow] = useState("All");
  const [search, setSearch] = useState("");
  const [outlet, setOutlet] = useState("All");

  const { data, loading, error } =
    useQuery("inventory:transfers", () => apiGet<{ items: Transfer[] }>("/api/v1/inventory/transfers"));

  const transfers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.items ?? []).filter((t) => {
      const matchShow = show === "All" || t.status === show;
      const matchQ = !q || t.transfer_number.toLowerCase().includes(q) ||
        t.from_location.toLowerCase().includes(q) ||
        t.to_location.toLowerCase().includes(q);
      const matchOutlet = outlet === "All" || t.from_location === outlet || t.to_location === outlet;
      return matchShow && matchQ && matchOutlet;
    });
  }, [data, show, search, outlet]);

  const totalQty = useMemo(() => transfers.reduce((s, t) => s + t.qty, 0), [transfers]);

  return (
    <>
      {/* Filter bar */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-end gap-3 px-4 py-4">
          <div className="w-36">
            <label className="mb-1 block text-xs font-medium text-slate-500">Show</label>
            <select value={show} onChange={(e) => setShow(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-[#111] outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600">
              <option value="All">All transfers</option>
              <option value="pending">Pending</option>
              <option value="in_transit">In transit</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div className="min-w-[160px] flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-500">Search</label>
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Transfer # or location…"
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-[#111] outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600" />
          </div>
          <div className="w-40">
            <label className="mb-1 block text-xs font-medium text-slate-500">Outlet</label>
            <select value={outlet} onChange={(e) => setOutlet(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-[#111] outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600">
              <option value="All">All outlets</option>
              <option value="Main Store">Main Store</option>
              <option value="Warehouse">Warehouse</option>
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
            Displaying {transfers.length} transfers · {totalQty.toLocaleString()} total qty
          </span>
          <button type="button"
            className="rounded-md border border-brand-600 px-3 py-1.5 text-xs font-semibold text-brand-600 transition-colors hover:bg-brand-600/5">
            New transfer
          </button>
        </div>

        {loading ? (
          <TableSkeleton headers={["Transfer #", "From", "To", "Status", "Due date", "Created", "Qty"]} rows={5} />
        ) : error ? (
          <div className="p-6 text-sm text-red-600" role="alert">{error}</div>
        ) : transfers.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-500">No transfers match the current filters.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3 text-left">Transfer # / Due</th>
                <th className="px-4 py-3 text-left">From</th>
                <th className="px-4 py-3 text-left">To</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-right">Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {transfers.map((t) => (
                <tr key={t.id} className="cursor-pointer hover:bg-[#FAFAFA]">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[#111]">{t.transfer_number}</div>
                    <div className="text-xs text-[#666]">Due {fmt(t.due_date)}</div>
                  </td>
                  <td className="px-4 py-3 text-[#111]">{t.from_location}</td>
                  <td className="px-4 py-3 text-[#666]">{t.to_location}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_COLORS[t.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {t.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#666]">{fmt(t.created_at)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-[#111]">{t.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
