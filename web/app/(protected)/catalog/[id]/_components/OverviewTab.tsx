"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/date";
import type { CatalogProduct } from "@/api-client/types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LocationStock {
  location_id: string;
  location_name: string;
  quantity_on_hand: number;
  quantity_committed: number;
  quantity_available: number;
  average_cost_cents: number | null;
}

interface StockSummary {
  total_on_hand: number;
  total_available: number;
  total_committed: number;
  locations: LocationStock[];
}

interface RecentSale {
  id: string;
  sale_number: string;
  date: number;
  quantity: number;
  total_cents: number;
  customer_name: string | null;
}

interface ExpiryBatch {
  expiry_status: string;
  expiry_date: number;
  quantity: number;
  lot_code?: string;
}

interface RecentPO {
  id: string;
  po_number: string;
  vendor_name: string;
  ordered_at: number;
  qty_ordered: number;
  status: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StockPill({ total, reorderPoint }: { total: number; reorderPoint: number }) {
  if (total === 0) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />Out of stock
    </span>
  );
  if (total <= reorderPoint) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Low stock
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />In stock
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OverviewTab({
  product,
  onNavigate,
}: {
  product: CatalogProduct;
  onNavigate: (tab: string) => void;
}) {
  const router = useRouter();

  const [stock, setStock]       = useState<StockSummary | null>(null);
  const [sales, setSales]       = useState<RecentSale[]>([]);
  const [expiry, setExpiry]     = useState<ExpiryBatch[]>([]);
  const [recentPos, setRecentPos] = useState<RecentPO[]>([]);
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const pid = product.id;
    await Promise.allSettled([
      // Stock summary
      apiGet<{ locations: LocationStock[] }>(`/api/v1/catalog/${pid}/stock`).then((r) => {
        const locs = r.locations ?? [];
        setStock({
          total_on_hand:   locs.reduce((s, l) => s + l.quantity_on_hand, 0),
          total_available: locs.reduce((s, l) => s + l.quantity_available, 0),
          total_committed: locs.reduce((s, l) => s + l.quantity_committed, 0),
          locations: locs,
        });
      }),
      // Recent sales
      apiGet<{ items: RecentSale[] }>(`/api/v1/catalog/${pid}/sales?limit=5`).then((r) =>
        setSales(r.items ?? [])
      ),
      // Expiry batches
      apiGet<{ items: ExpiryBatch[] }>(`/api/v1/catalog/${pid}/expiry`).then((r) =>
        setExpiry(r.items ?? [])
      ),
      // Recent POs
      apiGet<{ items: RecentPO[] }>(`/api/v1/catalog/${pid}/purchases`).then((r) =>
        setRecentPos((r.items ?? []).slice(0, 4))
      ),
    ]);
    setLoading(false);
  }, [product.id]);

  useEffect(() => { void load(); }, [load]);

  const reorderPoint = product.reorder_point ?? 0;
  const expiredCount = expiry.filter((b) => b.expiry_status === "expired").length;
  const criticalCount = expiry.filter((b) => b.expiry_status === "critical").length;
  const totalStock = stock?.total_on_hand ?? 0;

  const revenueThisMonth = sales
    .filter((s) => s.date >= Date.now() - 30 * 86_400_000)
    .reduce((sum, s) => sum + s.total_cents, 0);

  return (
    <div className="space-y-5">

      {/* ── KPI row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Stock */}
        <button
          type="button"
          onClick={() => onNavigate("inventory")}
          className="group rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md"
        >
          <p className="text-xs font-medium text-slate-500">Total stock</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {loading ? <span className="block h-7 w-12 animate-pulse rounded bg-slate-100" /> : totalStock.toLocaleString()}
          </p>
          {!loading && stock && (
            <div className="mt-1 flex gap-2 text-[11px] text-slate-400">
              <span>{stock.total_available} avail</span>
              <span>·</span>
              <span>{stock.total_committed} committed</span>
            </div>
          )}
          <div className="mt-2">
            <StockPill total={totalStock} reorderPoint={reorderPoint} />
          </div>
        </button>

        {/* Revenue (30d) */}
        <button
          type="button"
          onClick={() => onNavigate("transactions")}
          className="group rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md"
        >
          <p className="text-xs font-medium text-slate-500">Revenue (30d)</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {loading ? <span className="block h-7 w-16 animate-pulse rounded bg-slate-100" /> : formatMoney(revenueThisMonth)}
          </p>
          {!loading && (
            <p className="mt-1 text-[11px] text-slate-400">{sales.length} recent transactions</p>
          )}
          <p className="mt-2 text-[11px] font-medium text-brand-600 group-hover:underline">View transactions →</p>
        </button>

        {/* Expiry alerts */}
        <button
          type="button"
          onClick={() => onNavigate("expiry")}
          className={`group rounded-xl border p-4 text-left shadow-sm transition-shadow hover:shadow-md ${
            expiredCount > 0 ? "border-red-200 bg-red-50" : criticalCount > 0 ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"
          }`}
        >
          <p className={`text-xs font-medium ${expiredCount > 0 ? "text-red-600" : criticalCount > 0 ? "text-amber-600" : "text-slate-500"}`}>
            Expiry alerts
          </p>
          <p className={`mt-1 text-2xl font-bold ${expiredCount > 0 ? "text-red-700" : criticalCount > 0 ? "text-amber-700" : "text-slate-900"}`}>
            {loading ? <span className="block h-7 w-8 animate-pulse rounded bg-slate-100" /> : expiredCount + criticalCount}
          </p>
          {!loading && (
            <div className="mt-1 text-[11px] text-slate-400">
              {expiredCount > 0 && <span className="text-red-500">{expiredCount} expired · </span>}
              {criticalCount > 0 && <span className="text-amber-500">{criticalCount} critical</span>}
              {expiredCount === 0 && criticalCount === 0 && <span>No alerts</span>}
            </div>
          )}
          <p className="mt-2 text-[11px] font-medium text-brand-600 group-hover:underline">View expiry →</p>
        </button>

        {/* Open POs */}
        <button
          type="button"
          onClick={() => onNavigate("purchasing")}
          className="group rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md"
        >
          <p className="text-xs font-medium text-slate-500">Purchase orders</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {loading ? <span className="block h-7 w-8 animate-pulse rounded bg-slate-100" /> : recentPos.length}
          </p>
          {!loading && (
            <p className="mt-1 text-[11px] text-slate-400">
              {recentPos.filter((p) => p.status === "ordered" || p.status === "partial").length} in progress
            </p>
          )}
          <p className="mt-2 text-[11px] font-medium text-brand-600 group-hover:underline">View purchasing →</p>
        </button>
      </div>

      {/* ── Product snapshot ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

        {/* Product info card */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-3.5">
            <h3 className="text-sm font-semibold text-slate-900">Product info</h3>
          </div>
          <div className="divide-y divide-slate-50 px-5">
            {[
              { label: "SKU",          value: product.sku },
              { label: "Barcode",      value: product.barcode ?? "—" },
              { label: "Category",     value: product.category ?? "—" },
              { label: "Brand",        value: (product as unknown as Record<string, string>).brand ?? "—" },
              { label: "Tax class",    value: product.tax_class ?? "standard" },
              { label: "Retail price", value: formatMoney(product.price_cents) },
              { label: "Cost price",   value: product.raw_cost_price_cents ? formatMoney(product.raw_cost_price_cents) : "—" },
              { label: "Tracking",     value: product.track_inventory ? "Tracked" : "Untracked" },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-2.5">
                <span className="text-xs text-slate-400">{label}</span>
                <span className="text-xs font-medium text-slate-800 text-right max-w-[60%] truncate">{value}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-slate-100 px-5 py-3">
            <button
              type="button"
              onClick={() => onNavigate("general")}
              className="text-xs font-medium text-brand-600 hover:underline"
            >
              Edit details →
            </button>
          </div>
        </div>

        {/* Stock by location */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
            <h3 className="text-sm font-semibold text-slate-900">Stock by location</h3>
            <button type="button" onClick={() => onNavigate("inventory")} className="text-xs text-brand-600 hover:underline">
              All →
            </button>
          </div>
          {loading ? (
            <div className="space-y-2 p-4">{[1,2,3].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-slate-100" />)}</div>
          ) : !stock || stock.locations.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-slate-400">No stock data</p>
          ) : (
            <div className="divide-y divide-slate-50 px-5">
              {stock.locations.map((loc) => (
                <div key={loc.location_id} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="text-xs font-medium text-slate-800">{loc.location_name}</p>
                    <p className="text-[11px] text-slate-400">{loc.quantity_committed} committed</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${loc.quantity_on_hand === 0 ? "text-red-600" : "text-slate-900"}`}>
                      {loc.quantity_on_hand}
                    </p>
                    <p className="text-[11px] text-slate-400">{loc.quantity_available} avail</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent sales */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
            <h3 className="text-sm font-semibold text-slate-900">Recent sales</h3>
            <button type="button" onClick={() => onNavigate("transactions")} className="text-xs text-brand-600 hover:underline">
              All →
            </button>
          </div>
          {loading ? (
            <div className="space-y-2 p-4">{[1,2,3].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-slate-100" />)}</div>
          ) : sales.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-slate-400">No sales yet</p>
          ) : (
            <div className="divide-y divide-slate-50 px-5">
              {sales.slice(0, 5).map((s) => (
                <div key={s.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="text-xs font-medium text-brand-600">{s.sale_number}</p>
                    <p className="text-[11px] text-slate-400">{fmtDate(s.date)} · {s.customer_name ?? "Walk-in"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold text-slate-900">{formatMoney(s.total_cents)}</p>
                    <p className="text-[11px] text-slate-400">×{s.quantity}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Expiry alerts + Recent POs row ───────────────────────────────── */}
      {(expiredCount > 0 || criticalCount > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800">Expiry action required</p>
              <p className="mt-0.5 text-xs text-amber-700">
                {expiredCount > 0 && <span>{expiredCount} expired batch{expiredCount !== 1 ? "es" : ""} should be quarantined. </span>}
                {criticalCount > 0 && <span>{criticalCount} batch{criticalCount !== 1 ? "es" : ""} expire within 7 days.</span>}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate("expiry")}
              className="rounded-lg border border-amber-300 bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-200"
            >
              Review expiry
            </button>
          </div>
        </div>
      )}

      {/* ── Recent purchase orders ───────────────────────────────────────── */}
      {recentPos.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
            <h3 className="text-sm font-semibold text-slate-900">Recent purchase orders</h3>
            <button type="button" onClick={() => onNavigate("purchasing")} className="text-xs text-brand-600 hover:underline">
              All POs →
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 text-left">PO</th>
                  <th className="px-4 py-2.5 text-left">Supplier</th>
                  <th className="px-4 py-2.5 text-right">Qty</th>
                  <th className="px-4 py-2.5 text-left">Date</th>
                  <th className="px-4 py-2.5 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {recentPos.map((po) => (
                  <tr key={po.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/purchasing/${po.id}`)}>
                    <td className="px-4 py-2.5 font-medium text-brand-600">{po.po_number}</td>
                    <td className="px-4 py-2.5 text-slate-600">{po.vendor_name}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700">{po.qty_ordered}</td>
                    <td className="px-4 py-2.5 text-slate-500">{fmtDate(po.ordered_at)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${
                        po.status === "received" ? "bg-emerald-100 text-emerald-700" :
                        po.status === "partial" ? "bg-amber-100 text-amber-700" :
                        po.status === "ordered" ? "bg-blue-100 text-blue-700" :
                        "bg-slate-100 text-slate-600"
                      }`}>{po.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
