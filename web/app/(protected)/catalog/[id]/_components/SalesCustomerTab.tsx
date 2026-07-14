"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/date";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SaleRecord {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_type: "retail" | "wholesale";
  order_id: string;
  order_number: string;
  order_date: number;
  outlet: string;
  qty_bought: number;
  unit_price_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  margin_pct: number;
  returned_qty: number;
  last_purchase_date: number;
}

interface Summary {
  total_revenue_cents: number;
  total_qty: number;
  total_returns: number;
  unique_customers: number;
}

type DatePreset = "today" | "yesterday" | "7d" | "30d" | "month" | "last-month" | "quarter" | "year" | "all";
type CustomerType = "all" | "retail" | "wholesale";

const DAY = 86_400_000;

function presetRange(preset: DatePreset): { from: number; to: number } {
  const now = Date.now();
  const d = new Date();
  switch (preset) {
    case "today":      return { from: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), to: now };
    case "yesterday": { const y = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1); return { from: y.getTime(), to: y.getTime() + DAY - 1 }; }
    case "7d":         return { from: now - 7 * DAY,  to: now };
    case "30d":        return { from: now - 30 * DAY, to: now };
    case "month":      return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: now };
    case "last-month": { const lm = new Date(d.getFullYear(), d.getMonth() - 1, 1); return { from: lm.getTime(), to: new Date(d.getFullYear(), d.getMonth(), 1).getTime() - 1 }; }
    case "quarter":  { const qStart = new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1); return { from: qStart.getTime(), to: now }; }
    case "year":       return { from: new Date(d.getFullYear(), 0, 1).getTime(), to: now };
    default:           return { from: 0, to: Infinity };
  }
}

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today",      label: "Today" },
  { key: "yesterday",  label: "Yesterday" },
  { key: "7d",         label: "Last 7 days" },
  { key: "30d",        label: "Last 30 days" },
  { key: "month",      label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "quarter",    label: "This quarter" },
  { key: "year",       label: "This year" },
  { key: "all",        label: "All time" },
];

const OUTLETS = ["All outlets", "Main Store", "South Branch", "Warehouse", "Online"];
const CASHIERS = ["All cashiers", "Alex T.", "Maria S.", "John D.", "Sara K."];
const ORDER_STATUSES = ["All statuses", "Completed", "Pending", "Cancelled", "Refunded"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function exportCSV(items: SaleRecord[], productId: string) {
  const headers = ["Customer","Type","Order #","Date","Outlet","Qty","Unit Price","Discount","Tax","Total","Margin %","Returns"];
  const rows = items.map((r) => [
    r.customer_name, r.customer_type, r.order_number,
    fmtDate(r.order_date), r.outlet, r.qty_bought,
    (r.unit_price_cents / 100).toFixed(2),
    (r.discount_cents / 100).toFixed(2),
    (r.tax_cents / 100).toFixed(2),
    (r.total_cents / 100).toFixed(2),
    r.margin_pct.toFixed(1),
    r.returned_qty,
  ]);
  const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `product-${productId}-sales-by-customer.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SalesCustomerTab({ productId }: { productId: string }) {
  const router = useRouter();
  const [items, setItems]         = useState<SaleRecord[]>([]);
  const [summary, setSummary]     = useState<Summary | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [datePreset, setDatePreset]       = useState<DatePreset>("30d");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerType, setCustomerType]   = useState<CustomerType>("all");
  const [outlet, setOutlet]               = useState("All outlets");
  const [cashier, setCashier]             = useState("All cashiers");
  const [orderStatus, setOrderStatus]     = useState("All statuses");
  const [showFilters, setShowFilters]     = useState(false);
  const [sortCol, setSortCol]             = useState<keyof SaleRecord>("order_date");
  const [sortDir, setSortDir]             = useState<"asc" | "desc">("desc");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await apiGet<{ items: SaleRecord[]; summary: Summary }>(
        `/api/v1/catalog/${productId}/sales-by-customer`
      );
      setItems(d.items ?? []);
      setSummary(d.summary ?? null);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load sales data.");
    } finally { setLoading(false); }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  const { from, to } = presetRange(datePreset);

  const filtered = useMemo(() => {
    let rows = items.filter((r) => r.order_date >= from && r.order_date <= to);
    if (customerSearch.trim()) {
      const q = customerSearch.toLowerCase();
      rows = rows.filter((r) => r.customer_name.toLowerCase().includes(q) || r.order_number.toLowerCase().includes(q));
    }
    if (customerType !== "all") rows = rows.filter((r) => r.customer_type === customerType);
    if (outlet !== "All outlets") rows = rows.filter((r) => r.outlet === outlet);
    return [...rows].sort((a, b) => {
      const av = a[sortCol]; const bv = b[sortCol];
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [items, from, to, customerSearch, customerType, outlet, sortDir, sortCol]);

  const visibleSummary = useMemo(() => ({
    revenue: filtered.reduce((s, r) => s + r.total_cents, 0),
    qty:     filtered.reduce((s, r) => s + r.qty_bought, 0),
    returns: filtered.reduce((s, r) => s + r.returned_qty, 0),
    customers: new Set(filtered.map((r) => r.customer_id)).size,
    avgOrder: filtered.length ? Math.round(filtered.reduce((s, r) => s + r.total_cents, 0) / filtered.length) : 0,
    avgMargin: filtered.length ? filtered.reduce((s, r) => s + r.margin_pct, 0) / filtered.length : 0,
  }), [filtered]);

  const handleSort = (col: keyof SaleRecord) => {
    if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
  };

  const SortIcon = ({ col }: { col: keyof SaleRecord }) => (
    <span className="ml-0.5 text-[10px] text-slate-300">
      {sortCol === col ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
    </span>
  );

  const activeFilters = [customerSearch, customerType !== "all", outlet !== "All outlets", cashier !== "All cashiers", orderStatus !== "All statuses"].filter(Boolean).length;

  if (loading) return (
    <div className="space-y-3">
      {[1,2,3,4].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}
    </div>
  );

  if (error) return <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;

  return (
    <div className="space-y-4">

      {/* ── Toolbar ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Date preset pills */}
        <div className="flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {DATE_PRESETS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setDatePreset(key)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                datePreset === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Customer search */}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input
            type="search"
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            placeholder="Customer or order…"
            className="h-8 rounded-md border border-slate-200 bg-white pl-8 pr-3 text-sm focus:border-brand-600 focus:outline-none"
          />
        </div>

        {/* Type toggle */}
        <div className="flex rounded-md border border-slate-200 p-0.5">
          {(["all","retail","wholesale"] as CustomerType[]).map((t) => (
            <button key={t} type="button" onClick={() => setCustomerType(t)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors capitalize ${
                customerType === t ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {t === "all" ? "All" : t}
            </button>
          ))}
        </div>

        {/* More filters */}
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
            activeFilters > 0 ? "border-brand-600 bg-brand-600/5 text-brand-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z"/>
          </svg>
          Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}
        </button>

        <div className="ml-auto">
          <button
            type="button"
            onClick={() => exportCSV(filtered, productId)}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/* ── Advanced filters panel ────────────────────────────────────────────── */}
      {showFilters && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-4">
          {[
            { label: "Outlet", value: outlet, onChange: setOutlet, options: OUTLETS },
            { label: "Cashier", value: cashier, onChange: setCashier, options: CASHIERS },
            { label: "Order status", value: orderStatus, onChange: setOrderStatus, options: ORDER_STATUSES },
          ].map(({ label, value, onChange, options }) => (
            <div key={label}>
              <label className="mb-1 block text-[11px] font-medium text-slate-500">{label}</label>
              <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-brand-600 focus:outline-none"
              >
                {options.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
          ))}
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => { setOutlet("All outlets"); setCashier("All cashiers"); setOrderStatus("All statuses"); setCustomerSearch(""); setCustomerType("all"); setShowFilters(false); }}
              className="text-xs text-slate-400 hover:text-slate-700 underline"
            >
              Clear all
            </button>
          </div>
        </div>
      )}

      {/* ── Summary cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        {[
          { label: "Unique customers", value: visibleSummary.customers.toString(),                    color: "text-[#111]" },
          { label: "Total orders",     value: filtered.length.toString(),                             color: "text-[#111]" },
          { label: "Units sold",       value: visibleSummary.qty.toString(),                         color: "text-blue-600" },
          { label: "Revenue",          value: formatMoney(visibleSummary.revenue),                   color: "text-emerald-700" },
          { label: "Avg order",        value: formatMoney(visibleSummary.avgOrder),                  color: "text-slate-700" },
          { label: "Avg margin",       value: `${visibleSummary.avgMargin.toFixed(1)}%`,             color: visibleSummary.avgMargin >= 30 ? "text-emerald-700" : "text-amber-600" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
            <p className="text-[11px] text-slate-400">{label}</p>
            <p className={`mt-0.5 text-base font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Returns warning ───────────────────────────────────────────────────── */}
      {visibleSummary.returns > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <svg className="h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          {visibleSummary.returns} unit{visibleSummary.returns !== 1 ? "s" : ""} returned in this period
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-12 text-center">
          <p className="text-sm text-slate-400">No sales match the selected filters.</p>
          <button type="button" onClick={() => { setDatePreset("all"); setCustomerSearch(""); setCustomerType("all"); setOutlet("All outlets"); }}
            className="mt-2 text-xs text-brand-600 hover:underline">
            Clear filters
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                  {[
                    { col: "customer_name" as const, label: "Customer" },
                    { col: "order_number"  as const, label: "Order" },
                    { col: "order_date"    as const, label: "Date" },
                    { col: "outlet"        as const, label: "Outlet" },
                    { col: "qty_bought"    as const, label: "Qty" },
                    { col: "unit_price_cents" as const, label: "Unit Price" },
                    { col: "discount_cents"   as const, label: "Discount" },
                    { col: "tax_cents"        as const, label: "Tax" },
                    { col: "total_cents"      as const, label: "Total" },
                    { col: "margin_pct"       as const, label: "Margin" },
                    { col: "returned_qty"     as const, label: "Returns" },
                  ].map(({ col, label }) => (
                    <th
                      key={col}
                      className="cursor-pointer select-none whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-slate-500 hover:text-slate-700"
                      onClick={() => handleSort(col)}
                    >
                      {label}<SortIcon col={col} />
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((row) => (
                  <tr key={row.id} className="group hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div>
                        <button
                          type="button"
                          onClick={() => router.push(`/customers/${row.customer_id}`)}
                          className="text-sm font-medium text-brand-600 hover:underline"
                        >
                          {row.customer_name}
                        </button>
                        <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          row.customer_type === "wholesale"
                            ? "bg-violet-100 text-violet-700"
                            : "bg-sky-100 text-sky-700"
                        }`}>
                          {row.customer_type}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => router.push(`/orders/${row.order_id}`)}
                        className="text-xs font-medium text-brand-600 hover:underline"
                      >
                        {row.order_number}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{fmtDate(row.order_date)}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{row.outlet}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-900">{row.qty_bought}</td>
                    <td className="px-4 py-3 text-xs text-slate-700">{formatMoney(row.unit_price_cents)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {row.discount_cents > 0 ? <span className="text-red-600">−{formatMoney(row.discount_cents)}</span> : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{row.tax_cents > 0 ? formatMoney(row.tax_cents) : "—"}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-900">{formatMoney(row.total_cents)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold ${
                        row.margin_pct >= 35 ? "text-emerald-700" : row.margin_pct >= 20 ? "text-amber-600" : "text-red-600"
                      }`}>
                        {row.margin_pct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {row.returned_qty > 0 ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                          {row.returned_qty}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => router.push(`/customers/${row.customer_id}`)}
                          title="View customer"
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-600"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => router.push(`/orders/${row.order_id}`)}
                          title="View order"
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-600"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                          </svg>
                        </button>
                        {row.returned_qty > 0 && (
                          <button
                            type="button"
                            onClick={() => router.push(`/returns?order=${row.order_id}`)}
                            title="View return"
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Totals footer */}
              <tfoot className="border-t border-slate-200 bg-slate-50">
                <tr>
                  <td colSpan={4} className="px-4 py-2.5 text-xs font-semibold text-slate-500">
                    {filtered.length} order{filtered.length !== 1 ? "s" : ""} · {visibleSummary.customers} customer{visibleSummary.customers !== 1 ? "s" : ""}
                  </td>
                  <td className="px-4 py-2.5 text-sm font-bold text-slate-900">{visibleSummary.qty}</td>
                  <td colSpan={3} />
                  <td className="px-4 py-2.5 text-sm font-bold text-slate-900">{formatMoney(visibleSummary.revenue)}</td>
                  <td className="px-4 py-2.5 text-xs font-semibold text-slate-600">{visibleSummary.avgMargin.toFixed(1)}%</td>
                  <td className="px-4 py-2.5 text-xs font-semibold text-red-600">{visibleSummary.returns > 0 ? visibleSummary.returns : "—"}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
