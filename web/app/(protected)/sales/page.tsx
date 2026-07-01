"use client";

/**
 * Sales History — retail POS transactions.
 *
 * Pattern per reference spec:
 *   Filter bar (Date · Time · Customer · Receipt/Note) → Clear / More filters / Search
 *   Expandable table rows → inline sale detail with actions
 */

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { formatMoney } from "@/lib/money";
import { apiGet } from "@/api-client/client";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SaleRecord {
  id: string;
  receipt_number: string;
  created_at: number;
  customer_name: string | null;
  sold_by: string;
  outlet: string;
  note: string | null;
  total_cents: number;
  status: "completed" | "open" | "voided" | "returned";
  lines?: SaleLine[];
  payments?: SalePayment[];
}

interface SaleLine {
  qty: number;
  name: string;
  unit_price_cents: number;
  tax_cents: number;
  total_cents: number;
}

interface SalePayment {
  method: string;
  amount_cents: number;
  date: number;
}

// ── Avatar colors (vivid per reference spec) ──────────────────────────────────

const AVATAR_COLORS = [
  "#F97316", "#EAB308", "#8B5CF6", "#10B981", "#EC4899", "#3B82F6", "#EF4444", "#14B8A6",
];
function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}
function initials(name: string) {
  return name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

// ── Status label ──────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  completed: "text-emerald-700",
  open:      "text-blue-600",
  voided:    "text-red-500",
  returned:  "text-amber-600",
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SalesHistoryPage() {
  const [sales, setSales]       = useState<SaleRecord[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filter state
  const [filterDate, setFilterDate]       = useState("");
  const [filterCustomer, setFilterCustomer] = useState("");
  const [filterReceipt, setFilterReceipt]   = useState("");
  const [filterStatus, setFilterStatus]     = useState("all");
  const [moreFilters, setMoreFilters]       = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ items: SaleRecord[] }>("/api/v1/sales/history");
      setSales(data.items ?? []);
    } catch {
      setError("Failed to load sales history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function clearFilters() {
    setFilterDate("");
    setFilterCustomer("");
    setFilterReceipt("");
    setFilterStatus("all");
  }

  // Client-side filter
  const visible = sales.filter(s => {
    if (filterStatus !== "all" && s.status !== filterStatus) return false;
    if (filterCustomer && !s.customer_name?.toLowerCase().includes(filterCustomer.toLowerCase())) return false;
    if (filterReceipt && !s.receipt_number.toLowerCase().includes(filterReceipt.toLowerCase())) return false;
    return true;
  });

  function fmt(ts: number) {
    return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  return (
    <EnterpriseShell active="sales" title="Sales History" subtitle="All register transactions">
      <div className="flex flex-col min-h-full">

        {/* ── Page header ──────────────────────────────────────────────────── */}
        <div className="bg-white border-b border-[#E8E8E8] px-6 py-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-[#111]">Sales history</h1>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded border border-[#D9D9D9] bg-white px-3 py-1.5 text-sm text-[#555] hover:bg-gray-50 transition-colors"
          >
            <DownloadIcon />
            Export list
          </button>
        </div>

        {/* ── Filter bar (reference pattern) ───────────────────────────────── */}
        <div className="bg-white border-b border-[#E8E8E8] px-6 py-3">
          <div className="flex flex-wrap items-end gap-3">
            {/* Date */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-[#555]">Date</label>
              <input
                type="date"
                value={filterDate}
                onChange={e => setFilterDate(e.target.value)}
                className="h-8 rounded border border-[#D9D9D9] px-2 text-sm text-[#111] focus:border-[#5D5FEF] focus:outline-none focus:ring-1 focus:ring-[#5D5FEF]"
              />
            </div>

            {/* Customer */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-[#555]">Customer</label>
              <input
                type="text"
                placeholder="Search customer"
                value={filterCustomer}
                onChange={e => setFilterCustomer(e.target.value)}
                className="h-8 rounded border border-[#D9D9D9] px-2 text-sm text-[#111] focus:border-[#5D5FEF] focus:outline-none focus:ring-1 focus:ring-[#5D5FEF] w-36"
              />
            </div>

            {/* Receipt or note */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-[#555]">Receipt or note</label>
              <input
                type="text"
                placeholder="Receipt #, note…"
                value={filterReceipt}
                onChange={e => setFilterReceipt(e.target.value)}
                className="h-8 rounded border border-[#D9D9D9] px-2 text-sm text-[#111] focus:border-[#5D5FEF] focus:outline-none focus:ring-1 focus:ring-[#5D5FEF] w-36"
              />
            </div>

            {/* More filters toggle */}
            {moreFilters && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[#555]">Status</label>
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  className="h-8 rounded border border-[#D9D9D9] px-2 text-sm text-[#111] focus:border-[#5D5FEF] focus:outline-none"
                >
                  <option value="all">All statuses</option>
                  <option value="completed">Completed</option>
                  <option value="open">Open</option>
                  <option value="voided">Voided</option>
                  <option value="returned">Returned</option>
                </select>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 ml-auto">
              <button type="button" onClick={clearFilters} className="text-sm text-[#5D5FEF] hover:underline">
                Clear filters
              </button>
              <button type="button" onClick={() => setMoreFilters(m => !m)} className="text-sm text-[#5D5FEF] hover:underline">
                {moreFilters ? "Fewer filters" : "More filters"}
              </button>
              <button
                type="button"
                onClick={() => void load()}
                className="h-8 rounded bg-[#5D5FEF] px-4 text-sm font-medium text-white hover:bg-[#4a4cc8] transition-colors"
              >
                Search
              </button>
            </div>
          </div>

          {/* Results count */}
          {!loading && (
            <p className="mt-2 text-xs text-[#666]">
              Showing <strong>{visible.length}</strong> sale{visible.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>

        {/* ── Table ─────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-x-auto">
          {error && (
            <div role="alert" className="m-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#F0F0F0] bg-[#FAFAFA] text-left text-xs font-semibold text-[#888] uppercase tracking-wider">
                <th className="w-6 px-4 py-3" />
                <th className="px-4 py-3">Receipt # &amp; date</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Sold by</th>
                <th className="px-4 py-3">Note</th>
                <th className="px-4 py-3 text-right">Sale total</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[#888]">
                    <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[#5D5FEF] border-t-transparent" />
                  </td>
                </tr>
              )}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[#888]">No sales found for the selected filters.</td>
                </tr>
              )}
              {visible.map(sale => (
                <>
                  <tr
                    key={sale.id}
                    className="border-b border-[#F5F5F5] hover:bg-[#FAFAFA] cursor-pointer"
                    onClick={() => setExpandedId(expandedId === sale.id ? null : sale.id)}
                  >
                    {/* Expand chevron */}
                    <td className="px-4 py-3">
                      <svg
                        width="14" height="14" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        className={`text-[#999] transition-transform ${expandedId === sale.id ? "rotate-90" : ""}`}
                        aria-hidden="true"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </td>

                    {/* Receipt # + date */}
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#5D5FEF]">{sale.receipt_number}</p>
                      <p className="text-xs text-[#888]">{fmt(sale.created_at)}</p>
                    </td>

                    {/* Customer */}
                    <td className="px-4 py-3 text-[#555]">
                      {sale.customer_name ?? <span className="text-[#bbb]">—</span>}
                    </td>

                    {/* Sold by — avatar + name + outlet */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-bold text-white shrink-0"
                          style={{ backgroundColor: avatarColor(sale.sold_by) }}
                          aria-hidden="true"
                        >
                          {initials(sale.sold_by)}
                        </div>
                        <div>
                          <p className="text-xs font-medium text-[#111]">{sale.sold_by}</p>
                          <p className="text-[11px] text-[#888]">{sale.outlet}</p>
                        </div>
                      </div>
                    </td>

                    {/* Note */}
                    <td className="px-4 py-3 text-[#888] italic text-xs max-w-[160px] truncate">
                      {sale.note ?? "—"}
                    </td>

                    {/* Total */}
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-[#111]">
                      {formatMoney(sale.total_cents)}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={`capitalize font-medium ${STATUS_STYLE[sale.status] ?? "text-[#555]"}`}>
                        {sale.status}
                      </span>
                    </td>
                  </tr>

                  {/* ── Expanded detail row ───────────────────────────────── */}
                  {expandedId === sale.id && (
                    <tr key={`${sale.id}-detail`}>
                      <td colSpan={7} className="p-0">
                        <SaleDetailPanel sale={sale} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </EnterpriseShell>
  );
}

// ── Sale detail panel (expanded inline row) ───────────────────────────────────

function SaleDetailPanel({ sale }: { sale: SaleRecord }) {
  const lines: SaleLine[] = sale.lines ?? [
    { qty: 1, name: "Item (demo)", unit_price_cents: sale.total_cents, tax_cents: 0, total_cents: sale.total_cents },
  ];
  const payments: SalePayment[] = sale.payments ?? [
    { method: "Cash", amount_cents: sale.total_cents, date: sale.created_at },
  ];

  const subtotal = lines.reduce((s, l) => s + l.total_cents - l.tax_cents, 0);
  const tax      = lines.reduce((s, l) => s + l.tax_cents, 0);

  return (
    <div className="bg-[#2a2a2a] text-white px-6 py-5">
      {/* Tab bar */}
      <div className="mb-4 border-b border-white/10">
        <button type="button" className="pb-2 text-sm font-medium text-white border-b-2 border-[#5D5FEF]">
          Sale details
        </button>
      </div>

      <div className="flex gap-8">
        {/* Line items */}
        <div className="flex-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-white/40 uppercase">
                <th className="pb-2">Qty</th>
                <th className="pb-2">Product</th>
                <th className="pb-2 text-right">Price</th>
                <th className="pb-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="py-2 text-white/60">{l.qty}</td>
                  <td className="py-2 font-medium text-white">{l.name}</td>
                  <td className="py-2 text-right text-white/70">
                    {formatMoney(l.unit_price_cents)}
                    {l.tax_cents > 0 && <span className="ml-1 text-[11px] text-white/40">+tax</span>}
                  </td>
                  <td className="py-2 text-right font-semibold tabular-nums">{formatMoney(l.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Summary */}
          <div className="mt-3 border-t border-white/10 pt-3 space-y-1 text-sm">
            <div className="flex justify-between text-white/60">
              <span>Subtotal</span><span>{formatMoney(subtotal)}</span>
            </div>
            <div className="flex justify-between text-white/60">
              <span>Total tax</span><span>{formatMoney(tax)}</span>
            </div>
            <div className="flex justify-between font-bold text-white text-base uppercase">
              <span>Sale total</span><span>{formatMoney(sale.total_cents)}</span>
            </div>
            {payments.map((p, i) => (
              <div key={i} className="flex justify-between text-white/50 text-xs">
                <span>{p.method} · {new Date(p.date).toLocaleDateString()}</span>
                <span>{formatMoney(p.amount_cents)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 min-w-[140px]">
          <ActionBtn primary>Return items</ActionBtn>
          <ActionBtn>Edit</ActionBtn>
          <ActionBtn>Gift receipt</ActionBtn>
          <ActionBtn>Email receipt</ActionBtn>
          <ActionBtn>Print receipt</ActionBtn>
          <ActionBtn danger>Void</ActionBtn>
        </div>
      </div>
    </div>
  );
}

function ActionBtn({ children, primary, danger }: { children: React.ReactNode; primary?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      className={[
        "w-full rounded px-4 py-2 text-sm font-medium text-left transition-colors",
        primary ? "bg-[#5D5FEF] text-white hover:bg-[#4a4cc8]" :
        danger  ? "bg-transparent text-red-400 hover:text-red-300 border border-red-800 hover:border-red-600" :
                  "bg-white/10 text-white hover:bg-white/20",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
