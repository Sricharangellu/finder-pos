"use client";

/**
 * /dashboard — POS management overview.
 *
 * Shows KPI tiles, revenue trend chart, top products, top customers,
 * sales-by-hour bar chart, quick-access action links, and payment breakdown.
 */

import { useState, useCallback, useEffect } from "react";
import { useQuery, invalidateQuery } from "@/lib/useQuery";
import Link from "next/link";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { KpiCard } from "@/components/KpiCard";
import { apiGet } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { useFinderContext, type FinderDateRange } from "@/lib/useFinderContext";
import { useRealtimeStream } from "@/hooks/useRealtimeStream";

// ─── Types ────────────────────────────────────────────────────────────────────

type Range = "today" | "7d" | "30d";

interface SummaryResponse {
  orders: {
    open: number;
    completed: number;
    refunded: number;
    voided: number;
    total: number;
  };
  revenue: {
    grossCents: number;
    taxCents: number;
    netCents: number;
  };
  payments: {
    capturedCount: number;
    capturedCents: number;
    byMethod: Record<string, number>;
  };
  /** FE-41: Implementation Prompt §4.1 spec KPIs */
  kpi?: {
    saleCount: number;
    grossProfitCents: number;
    customerCount: number;
    avgSaleValueCents: number;
    avgItemsPerSale: number;
    discountedAmountCents: number;
    discountedPct: number;
  };
  sparklines?: {
    revenue: number[];
    saleCount: number[];
  };
}

interface OutletItem { id: string; name: string; }

interface TopProductItem {
  id?: string;
  productId?: string;
  sku?: string;
  name: string;
  category?: string;
  revenue?: number;
  revenueCents?: number;
  qty?: number;
  units?: number;
}

interface TopProductsResponse {
  items: TopProductItem[];
}

interface TopCustomerItem {
  customer_id?: string;
  key?: string;
  name: string;
  totalCents?: number;
  revenueCents?: number;
  orderCount?: number;
  units?: number;
}

interface TopCustomersResponse {
  items: TopCustomerItem[];
}

interface TrendDay {
  date: string;
  label: string;
  revenueCents: number;
  orderCount: number;
}

interface TrendResponse { items: TrendDay[]; }

interface HourlyBucket {
  hour: number;
  label: string;
  orderCount: number;
  revenueCents: number;
  value: number;
}

interface HourlyResponse { items: HourlyBucket[]; }

interface CategoryItem {
  key: string;
  name: string;
  units: number;
  revenueCents: number;
}

interface CategoryResponse { items: CategoryItem[]; }

// ─── Skeleton primitives ──────────────────────────────────────────────────────

function SkeletonBox({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded bg-slate-200 ${className}`}
    />
  );
}

// ─── KPI Icons ────────────────────────────────────────────────────────────────

function IconDollar() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function IconCart() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

function IconPackage() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function IconCreditCard() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}

// ─── Quick-action card ────────────────────────────────────────────────────────

function QuickActionCard({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-[64px] items-center gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-950 text-white">
        {icon}
      </span>
      <span className="min-w-0 text-sm font-semibold text-slate-800">{label}</span>
    </Link>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconRegister() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8" />
      <path d="M8 11h8" />
      <path d="M8 15h2" />
      <path d="M14 15h2" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M8 16v-5" />
      <path d="M12 16V8" />
      <path d="M16 16v-3" />
    </svg>
  );
}

function IconBox() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 8a2 2 0 0 0-1-1.73L13 2.27a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

function IconQuote() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>
  );
}

// ─── Range label helper ───────────────────────────────────────────────────────

function rangeLabel(range: Range): string {
  if (range === "today") return "Today";
  if (range === "7d") return "Last 7 days";
  return "Last 30 days";
}

function dateRangeForPreset(preset: FinderDateRange["preset"]): FinderDateRange {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  if (preset === "current_week") {
    const day = start.getDay();
    start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
  } else if (preset === "current_month") {
    start.setDate(1);
    end.setMonth(start.getMonth() + 1, 0);
  }
  const iso = (value: Date) => value.toISOString().slice(0, 10);
  return { startDate: iso(start), endDate: iso(end), preset };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface LowStockItem {
  id: string; sku: string; name: string; category: string;
  onHand: number; reorderPoint: number; lowStock: boolean;
}

interface DashNotification {
  id: string; type: string; severity: string; title: string; body: string; read: boolean; created_at: number;
}

export default function DashboardPage() {
  const {
    storeId,
    outletId,
    dateRange,
    granularity,
    setDateRange,
    setGranularity,
  } = useFinderContext();
  const range: Range = dateRange.preset === "today"
    ? "today"
    : dateRange.preset === "current_month" ? "30d" : "7d";
  const scope = new URLSearchParams({ store_id: storeId, outlet_id: outletId }).toString();
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [recentNotifs, setRecentNotifs] = useState<DashNotification[]>([]);

  useEffect(() => {
    apiGet<{ items: LowStockItem[] }>("/api/v1/inventory/levels?pageSize=200")
      .then(d => setLowStock((d.items ?? []).filter(i => i.lowStock).slice(0, 5)))
      .catch(() => {/* silent */});
    apiGet<{ items: DashNotification[] }>("/api/v1/notifications?limit=5")
      .then(d => setRecentNotifs(d.items ?? []))
      .catch(() => {/* silent */});
  }, []);

  const fetchSummary = useCallback(
    () => apiGet<SummaryResponse>(`/api/v1/reports/summary?range=${range}&${scope}`),
    [range, scope],
  );
  const fetchTopProducts = useCallback(
    () => apiGet<TopProductsResponse>(`/api/v1/reports/top-products?range=${range}&limit=5&${scope}`),
    [range, scope],
  );
  const fetchTopCustomers = useCallback(
    () => apiGet<TopCustomersResponse>(`/api/v1/reports/sales-by-customer?range=${range}&${scope}`),
    [range, scope],
  );
  const trendRange = range === "today" ? "7d" : range;
  const fetchTrend = useCallback(
    () => apiGet<TrendResponse>(`/api/v1/reports/revenue-trend?range=${trendRange}&${scope}`),
    [scope, trendRange],
  );
  const fetchHourly = useCallback(
    () => apiGet<HourlyResponse>(`/api/v1/reports/hourly?range=${range}&${scope}`),
    [range, scope],
  );
  const fetchCategory = useCallback(
    () => apiGet<CategoryResponse>(`/api/v1/reports/sales-by-category?range=${range}&${scope}`),
    [range, scope],
  );

  // Outlet list for the filter dropdown
  const [outlets, setOutlets] = useState<OutletItem[]>([]);
  const [selectedOutletId, setSelectedOutletId] = useState<string>(outletId);
  useEffect(() => {
    apiGet<{ items: OutletItem[] }>("/api/v1/outlets")
      .then((d) => setOutlets(d.items ?? []))
      .catch(() => {});
  }, []);

  // FE-30: Real-time updates — invalidate summary + products on live events.
  useRealtimeStream(
    useCallback((event) => {
      if (event.type === "order_created" || event.type === "payment_captured") {
        invalidateQuery(`dashboard:summary:${range}:${scope}`);
        invalidateQuery(`dashboard:top-products:${range}:${scope}`);
      }
    }, [range, scope]),
  );

  const { data: summary, loading: loadingSummary, error: errorSummary } =
    useQuery(`dashboard:summary:${range}:${scope}`, fetchSummary, { staleMs: 60_000 });
  const { data: topProductsData, loading: loadingProducts } =
    useQuery(`dashboard:top-products:${range}:${scope}`, fetchTopProducts, { staleMs: 60_000 });
  const { data: topCustomersData, loading: loadingCustomers } =
    useQuery(`dashboard:top-customers:${range}:${scope}`, fetchTopCustomers, { staleMs: 60_000 });
  const { data: trendData, loading: loadingTrend } =
    useQuery(`dashboard:trend:${trendRange}:${scope}`, fetchTrend, { staleMs: 60_000 });
  const { data: hourlyData, loading: loadingHourly } =
    useQuery(`dashboard:hourly:${range}:${scope}`, fetchHourly, { staleMs: 60_000 });
  const { data: categoryData, loading: loadingCategory } =
    useQuery(`dashboard:category:${range}:${scope}`, fetchCategory, { staleMs: 60_000 });

  const topProducts = (topProductsData?.items ?? []).map((item) => ({
    ...item,
    id: item.id ?? item.productId ?? "",
    qty: item.qty ?? item.units ?? 0,
    revenue: item.revenue ?? item.revenueCents ?? 0,
  }));
  const topCustomers = (topCustomersData?.items ?? []).map((item) => ({
    ...item,
    customer_id: item.customer_id ?? item.key ?? "",
    orderCount: item.orderCount ?? item.units ?? 0,
    totalCents: item.totalCents ?? item.revenueCents ?? 0,
  }));
  const loading = loadingSummary || loadingProducts || loadingCustomers;
  const error = errorSummary;

  const trendPoints = (trendData?.items ?? []).map((d) => ({ label: d.label, value: d.revenueCents }));
  const hourlyPoints = (hourlyData?.items ?? []).map((d) => ({ label: d.label, value: d.revenueCents }));
  const categoryItems = (categoryData?.items ?? []).slice(0, 6);

  // ── Derived KPI values (Implementation Prompt §4.1 spec) ─────────────────

  const gross = summary?.revenue.grossCents ?? 0;
  const kpi = summary?.kpi;
  const spark = summary?.sparklines;
  const saleCount = kpi?.saleCount ?? summary?.orders.completed ?? 0;
  const grossProfit = kpi?.grossProfitCents ?? gross;
  const customerCount = kpi?.customerCount ?? 0;
  const avgSaleValue = kpi?.avgSaleValueCents ?? (saleCount > 0 ? Math.trunc(gross / saleCount) : 0);
  const avgItems = kpi?.avgItemsPerSale ?? 0;
  const discountedAmt = kpi?.discountedAmountCents ?? 0;
  const discountedPct = kpi?.discountedPct ?? 0;
  const sparkRev = (spark?.revenue ?? []).map((v) => ({ value: v }));
  const sparkSales = (spark?.saleCount ?? []).map((v) => ({ value: v }));

  return (
    <EnterpriseShell
      active="dashboard"
      title="Dashboard"
      subtitle={`Overview · Demo Store · ${rangeLabel(range)}`}
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6">

        {/* ── Filter bar (date range + outlet) ─────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-table-border)] pb-4">
          <div>
            <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
              Business Overview
            </h1>
            <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
              Revenue, orders, inventory movement, and tender mix.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Outlet filter — Implementation Prompt §4.3 */}
            {outlets.length > 0 && (
              <select
                aria-label="Filter by outlet"
                value={selectedOutletId}
                onChange={(e) => setSelectedOutletId(e.target.value)}
                className="h-8 rounded border border-[#D9D9D9] bg-white px-3 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-brand-600"
              >
                <option value="">All Outlets</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            )}
            {/* Day/Week/Month granularity toggle */}
            <div role="group" aria-label="Report granularity" className="inline-flex rounded-md border border-[#D9D9D9] bg-white p-1">
              {(["day", "week", "month"] as const).map((value) => (
                <button key={value} type="button" onClick={() => setGranularity(value)} aria-pressed={granularity === value}
                  className={`min-h-[28px] rounded px-3 text-[12px] font-medium capitalize transition-colors ${granularity === value ? "bg-brand-600 text-white" : "text-[var(--color-text-secondary)] hover:bg-gray-50"}`}>
                  {value}
                </button>
              ))}
            </div>
            <select
              aria-label="Date range"
              value={dateRange.preset === "custom" ? "current_week" : dateRange.preset}
              onChange={(e) => setDateRange(dateRangeForPreset(e.target.value as FinderDateRange["preset"]))}
              className="h-8 rounded border border-[#D9D9D9] bg-white px-3 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-brand-600"
            >
              <option value="today">Today</option>
              <option value="current_week">This Week</option>
              <option value="current_month">This Month</option>
            </select>
          </div>
        </div>

        {error && !loading && (
          <Card><p role="alert" className="text-sm text-danger-500">{error}</p></Card>
        )}

        {/* ── KPI tiles — Implementation Prompt §4.1 (8 spec metrics) ──────── */}
        <section aria-label="Key performance indicators">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {/* 1. Revenue */}
            <KpiCard title="Revenue" value={formatMoney(gross)} loading={loadingSummary}
              tone="green" icon={<IconDollar />}
              sparkline={sparkRev}
              reportHref="/reporting/sales?metric=revenue"
            />
            {/* 2. Sale Count */}
            <KpiCard title="Sale Count" value={saleCount.toLocaleString()} loading={loadingSummary}
              tone="blue" icon={<IconCart />}
              sparkline={sparkSales}
              reportHref="/reporting/sales?metric=sale_count"
            />
            {/* 3. Gross Profit */}
            <KpiCard title="Gross Profit" value={formatMoney(grossProfit)} loading={loadingSummary}
              tone="green" icon={<IconDollar />}
              reportHref="/reporting/sales?metric=gross_profit"
            />
            {/* 4. Customer Count */}
            <KpiCard title="Customer Count" value={customerCount.toLocaleString()} loading={loadingSummary}
              tone="blue" icon={<IconPackage />}
              reportHref="/reporting/sales?metric=customer_count"
            />
            {/* 5. Avg Sale Value */}
            <KpiCard title="Avg Sale Value" value={formatMoney(avgSaleValue)} loading={loadingSummary}
              tone="neutral" icon={<IconDollar />}
              reportHref="/reporting/sales?metric=avg_sale_value"
            />
            {/* 6. Avg Items / Sale */}
            <KpiCard title="Avg Items / Sale" value={avgItems.toFixed(1)} loading={loadingSummary}
              tone="neutral" icon={<IconCart />}
              reportHref="/reporting/sales?metric=avg_items_per_sale"
            />
            {/* 7. Discounted Amount */}
            <KpiCard title="Discounted (amt)" value={formatMoney(discountedAmt)} loading={loadingSummary}
              tone="amber" icon={<IconCreditCard />}
              reportHref="/reporting/sales?metric=discounted"
            />
            {/* 8. Discounted % */}
            <KpiCard title="Discounted (%)" value={`${discountedPct.toFixed(1)}%`} loading={loadingSummary}
              tone="amber" icon={<IconCreditCard />}
              reportHref="/reporting/sales?metric=discounted_pct"
            />
            <KpiCard
              title="Avg Order Value"
              value={formatMoney(avgSaleValue)}
              loading={loadingSummary}
              tone="neutral"
              icon={<IconDollar />}
            />
          </div>
        </section>

        {/* ── Revenue Trend ──────────────────────────────────────────────── */}
        <section aria-label="Revenue trend">
          <Card
            title={`Revenue Trend — Last ${trendRange === "7d" ? "7 Days" : "30 Days"}`}
            noPadding
          >
            <div className="px-5 pb-4 pt-2">
              <LineChart
                data={trendPoints}
                height={200}
                color="#10b981"
                loading={loadingTrend}
                formatValue={(v) => formatMoney(v)}
              />
            </div>
          </Card>
        </section>

        {/* ── Sales by Hour + Top Products ───────────────────────────────── */}
        <section
          aria-label="Sales patterns"
          className="grid grid-cols-1 gap-5 lg:grid-cols-2"
        >
          <Card title="Sales by Hour" noPadding>
            <div className="px-5 pb-4 pt-2">
              <BarChart
                data={hourlyPoints}
                height={160}
                color="#6366f1"
                loading={loadingHourly}
                showEveryNthLabel={4}
                formatValue={(v) => formatMoney(v)}
              />
            </div>
          </Card>

          {/* Inventory value summary tile */}
          <Card title="Revenue Mix by Payment Method" noPadding>
            {loading ? (
              <div className="space-y-3 px-5 py-4">
                {[...Array(3)].map((_, i) => <SkeletonBox key={i} className="h-6 w-full" />)}
              </div>
            ) : Object.entries(summary?.payments.byMethod ?? {}).length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-400">No payments in this period.</p>
            ) : (
              <div className="space-y-3 px-5 py-4">
                {Object.entries(summary?.payments.byMethod ?? {}).map(([method, cents]) => {
                  const total = Object.values(summary?.payments.byMethod ?? {}).reduce((s, v) => s + v, 0);
                  const pct = total > 0 ? Math.round((cents / total) * 100) : 0;
                  return (
                    <div key={method}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="font-medium capitalize text-slate-700">{method}</span>
                        <span className="tabular-nums text-slate-600">{formatMoney(cents)} <span className="text-xs text-slate-400">({pct}%)</span></span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                        <div className="h-2 rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </section>

        {/* ── Top Products & Top Customers ───────────────────────────────── */}
        <section
          aria-label="Top products and customers"
          className="grid grid-cols-1 gap-5 md:grid-cols-2"
        >
          {/* Top Products */}
          <Card title="Top Products" noPadding>
            {loading ? (
              <div className="space-y-3 px-5 py-4">
                {[...Array(5)].map((_, i) => (
                  <SkeletonBox key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : topProducts.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-500">No data for this period.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left">
                    <th className="px-5 py-3 font-medium text-slate-600">Product</th>
                    <th className="px-3 py-3 font-medium text-slate-600 text-right">Qty</th>
                    <th className="px-5 py-3 font-medium text-slate-600 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {topProducts.map((p) => (
                    <tr
                      key={p.id}
                      className="transition-colors hover:bg-slate-50"
                    >
                      <td className="px-5 py-3">
                        <Link
                          href={`/inventory/products/${p.id}`}
                          className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
                        >
                          {p.name}
                        </Link>
                        {p.category && (
                          <span className="ml-2 text-xs text-slate-400">
                            {p.category}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-700">
                        {p.qty}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-700">
                        {formatMoney(p.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {/* Top Customers */}
          <Card title="Top Customers" noPadding>
            {loading ? (
              <div className="space-y-3 px-5 py-4">
                {[...Array(5)].map((_, i) => (
                  <SkeletonBox key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : topCustomers.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-500">No data for this period.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left">
                    <th className="px-5 py-3 font-medium text-slate-600">Customer</th>
                    <th className="px-3 py-3 font-medium text-slate-600 text-right">Orders</th>
                    <th className="px-5 py-3 font-medium text-slate-600 text-right">Total Spent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {topCustomers.map((c) => (
                    <tr
                      key={c.customer_id}
                      className="transition-colors hover:bg-slate-50"
                    >
                      <td className="px-5 py-3">
                        <Link
                          href={`/customers/${c.customer_id}`}
                          className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
                        >
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-700">
                        {c.orderCount}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-700">
                        {formatMoney(c.totalCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </section>

        {/* ── Sales by Category ─────────────────────────────────────────── */}
        {(loadingCategory || categoryItems.length > 0) && (
          <section aria-label="Sales by category">
            <Card title="Sales by Category" noPadding>
              {loadingCategory ? (
                <div className="space-y-2 px-5 py-4">
                  {[...Array(4)].map((_, i) => <SkeletonBox key={i} className="h-7 w-full" />)}
                </div>
              ) : (
                <div className="px-5 py-3 space-y-2">
                  {(() => {
                    const maxRev = Math.max(...categoryItems.map(c => c.revenueCents), 1);
                    return categoryItems.map((c) => {
                      const pct = Math.round((c.revenueCents / maxRev) * 100);
                      return (
                        <div key={c.key}>
                          <div className="flex items-center justify-between mb-1 text-sm">
                            <span className="font-medium text-slate-700">{c.name}</span>
                            <span className="tabular-nums text-slate-500">{formatMoney(c.revenueCents)}</span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                            <div className="h-2 rounded-full bg-violet-500 transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </Card>
          </section>
        )}

        {/* ── Quick-access action grid ───────────────────────────────────── */}
        <section aria-label="Quick actions">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">
            Quick Actions
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <QuickActionCard href="/terminal" label="New Sale" icon={<IconRegister />} />
            <QuickActionCard href="/inventory/products/new" label="Add Product" icon={<IconPlus />} />
            <QuickActionCard href="/quotes" label="New Quote" icon={<IconQuote />} />
            <QuickActionCard href="/reports" label="View Reports" icon={<IconChart />} />
            <QuickActionCard href="/inventory" label="Manage Inventory" icon={<IconBox />} />
          </div>
        </section>

        {/* ── Operational widgets ────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Low stock alerts */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-900">Low Stock Alerts</h2>
              <Link href="/inventory" className="text-xs text-blue-600 hover:underline">View all →</Link>
            </div>
            {lowStock.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">All stock levels are healthy.</p>
            ) : (
              <ul className="space-y-2">
                {lowStock.map(item => (
                  <li key={item.id} className="flex items-center justify-between rounded-lg bg-amber-50 border border-amber-100 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{item.name}</p>
                      <p className="text-xs text-slate-500 font-mono">{item.sku} · {item.category}</p>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-sm font-semibold text-amber-700">{item.onHand} left</p>
                      <p className="text-xs text-slate-400">reorder at {item.reorderPoint}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Recent notifications */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-900">Recent Alerts</h2>
              <Link href="/notifications" className="text-xs text-blue-600 hover:underline">View all →</Link>
            </div>
            {recentNotifs.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">No recent alerts.</p>
            ) : (
              <ul className="space-y-2">
                {recentNotifs.map(n => {
                  const sevColor = n.severity === "critical" ? "bg-red-50 border-red-100" : n.severity === "warning" ? "bg-amber-50 border-amber-100" : "bg-blue-50 border-blue-100";
                  const dotColor = n.severity === "critical" ? "bg-red-500" : n.severity === "warning" ? "bg-amber-400" : "bg-blue-400";
                  return (
                    <li key={n.id} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${sevColor}`}>
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotColor}`} aria-hidden="true" />
                      <div className="min-w-0">
                        <p className={`text-sm font-medium ${n.read ? "text-slate-600" : "text-slate-900"}`}>{n.title}</p>
                        <p className="text-xs text-slate-500 truncate">{n.body}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

      </div>
    </EnterpriseShell>
  );
}
