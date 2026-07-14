"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/Badge";
import { apiGet, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/date";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PurchaseLine {
  id: string;
  product_id: string;
  po_id: string;
  po_number: string;
  vendor_name: string;
  ordered_at: number;
  received_at: number | null;
  qty_ordered: number;
  qty_received: number;
  unit_cost_cents: number;
  total_cost_cents: number;
  status: "ordered" | "partial" | "received" | "cancelled";
}

interface PurchasesResponse {
  items: PurchaseLine[];
  total: number;
  total_qty_received: number;
  total_cost_cents: number;
}

const STATUS_BADGE: Record<PurchaseLine["status"], "blue" | "yellow" | "green" | "gray"> = {
  ordered: "blue", partial: "yellow", received: "green", cancelled: "gray",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function PurchasesTab({ productId }: { productId: string }) {
  const router = useRouter();
  const [data, setData]       = useState<PurchasesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await apiGet<PurchasesResponse>(`/api/v1/catalog/${productId}/purchases`);
      setData(d);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load purchase history.");
    } finally { setLoading(false); }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />)}
    </div>
  );

  if (error) return <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;

  if (!data || data.items.length === 0) return (
    <div className="rounded-lg border border-dashed border-slate-200 py-12 text-center">
      <p className="text-sm text-slate-400">No purchase orders have included this product yet.</p>
    </div>
  );

  return (
    <div className="space-y-4">

      {/* ── Summary stats ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total POs",        value: data.total.toString() },
          { label: "Total Received",   value: `${data.total_qty_received} units` },
          { label: "Total Cost",       value: formatMoney(data.total_cost_cents) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg bg-slate-50 px-4 py-3 border border-slate-200">
            <p className="text-xs text-slate-400">{label}</p>
            <p className="mt-0.5 text-base font-bold text-slate-900">{value}</p>
          </div>
        ))}
      </div>

      {/* ── PO lines table ───────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-[#111]">Purchase Order History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">PO Number</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Vendor</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Ordered</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Received</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Qty</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Unit Cost</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Total Cost</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((line) => (
                <tr
                  key={line.id}
                  className="cursor-pointer hover:bg-slate-50 transition-colors"
                  onClick={() => router.push(`/purchasing/${line.po_id}`)}
                >
                  <td className="px-4 py-3 font-medium text-brand-600 hover:underline">{line.po_number}</td>
                  <td className="px-4 py-3 text-slate-700">{line.vendor_name}</td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(line.ordered_at)}</td>
                  <td className="px-4 py-3 text-slate-500">{line.received_at ? fmtDate(line.received_at) : "—"}</td>
                  <td className="px-4 py-3">
                    <span className="text-slate-700">{line.qty_received}</span>
                    <span className="text-slate-400"> / {line.qty_ordered}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{formatMoney(line.unit_cost_cents)}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{formatMoney(line.total_cost_cents)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_BADGE[line.status]}>{line.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50">
              <tr>
                <td colSpan={6} className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Totals</td>
                <td className="px-4 py-3 text-sm font-bold text-slate-900">{formatMoney(data.total_cost_cents)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
