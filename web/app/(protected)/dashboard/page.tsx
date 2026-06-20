"use client";

/**
 * /dashboard — POS management overview.
 *
 * Shows KPI tiles, revenue trend chart, top products, top customers,
 * sales-by-hour bar chart, quick-access action links, and payment breakdown.
 */

import { useState, useCallback } from "react";
import { useQuery } from "@/lib/useQuery";
import Link from "next/link";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { KpiCard } from "@/components/KpiCard";
import { apiGet } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";

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
}

interface TopProductItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  revenue: number;
  qty: number;
}

interface TopProductsResponse {
  items: TopProductItem[];
}

interface TopCustomerItem {
  customer_id: string;
  name: string;
  totalCents: number;
  orderCount: number;
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

// ─── Range label helper ───────────────────────────────────────────────────────

function rangeLabel(range: Range): string {
  if (range === "today") return "Today";
  if (range === "7d") return "Last 7 days";
  return "Last 30 days";
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [range, setRange] = useState<Range>("7d");

  const fetchSummary = useCallback(
    () => apiGet<SummaryResponse>(`/api/v1/reports/summary?range=${range}`),
    [range],
  );
  const fetchTopProducts = useCallback(
    () => apiGet<TopProductsResponse>(`/api/v1/reports/top-products?range=${range}&limit=5`),
    [range],
  );
  const fetchTopCustomers = useCallback(
    () => apiGet<TopCustomersResponse>(`/api/v1/reports/sales-by-customer?range=${range}`),
    [range],
  );
  const trendRange = range === "today" ? "7d" : range;
  const fetchTrend = useCallback(
    () => apiGet<TrendResponse>(`/api/v1/reports/revenue-trend?range=${trendRange}`),
    [trendRange],
  );
  const fetchHourly = useCallback(
    () => apiGet<HourlyResponse>(`/api/v1/reports/hourly?range=${range}`),
    [range],
  );
  const fetchCategory = useCallback(
    () => apiGet<CategoryResponse>(`/api/v1/reports/sales-by-category?range=${range}`),
    [range],
  );

  const { data: summary, loading: loadingSummary, error: errorSummary } =
    useQuery(`dashboard:summary:${range}`, fetchSummary, { staleMs: 60_000 });
  const { data: topProductsData, loading: loadingProducts } =
    useQuery(`dashboard:top-products:${range}`, fetchTopProducts, { staleMs: 60_000 });
  const { data: topCustomersData, loading: loadingCustomers } =
    useQuery(`dashboard:top-customers:${range}`, fetchTopCustomers, { staleMs: 60_000 });
  const { data: trendData, loading: loadingTrend } =
    useQuery(`dashboard:trend:${trendRange}`, fetchTrend, { staleMs: 60_000 });
  const { data: hourlyData, loading: loadingHourly } =
    useQuery(`dashboard:hourly:${range}`, fetchHourly, { staleMs: 60_000 });
  const { data: categoryData, loading: loadingCategory } =
    useQuery(`dashboard:category:${range}`, fetchCategory, { staleMs: 60_000 });

  const topProducts = topProductsData?.items ?? [];
  const topCustomers = topCustomersData?.items ?? [];
  const loading = loadingSummary || loadingProducts || loadingCustomers;
  const error = errorSummary;

  const trendPoints = (trendData?.items ?? []).map((d) => ({ label: d.label, value: d.revenueCents }));
  const hourlyPoints = (hourlyData?.items ?? []).map((d) => ({ label: d.label, value: d.revenueCents }));
  const categoryItems = (categoryData?.items ?? []).slice(0, 6);

  // ── Derived KPI values ────────────────────────────────────────────────────

  const gross = summary?.revenue.grossCents ?? 0;
  const net = summary?.revenue.netCents ?? 0;
  const tax = summary?.revenue.taxCents ?? 0;
  const totalOrders = summary?.orders.total ?? 0;
  const completedOrders = summary?.orders.completed ?? 0;
  const openOrders = summary?.orders.open ?? 0;
  const avgOrderCents =
    completedOrders > 0 ? Math.trunc(gross / completedOrders) : 0;

  return (
    <EnterpriseShell
      active="dashboard"
      title="Dashboard"
      subtitle={`Overview · Demo Store · ${rangeLabel(range)}`}
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6">

        {/* ── Date range toggle ──────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-950">
              Business Overview
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Revenue, orders, inventory movement, and tender mix.
            </p>
          </div>
          <div
            role="group"
            aria-label="Date range"
            className="inline-flex rounded-md border border-slate-200 bg-white p-1 shadow-sm"
          >
            {(["today", "7d", "30d"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                aria-pressed={range === r}
                className={`min-h-[36px] rounded px-4 text-sm font-medium transition-colors ${
                  range === r
                    ? "bg-slate-950 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {rangeLabel(r)}
              </button>
            ))}
          </div>
        </div>

        {/* ── Error banner ───────────────────────────────────────────────── */}
        {error && !loading && (
          <Card>
            <p role="alert" className="text-sm text-danger-700">
              {error}
            </p>
          </Card>
        )}

        {/* ── KPI card grid ──────────────────────────────────────────────── */}
        <section aria-label="Key performance indicators">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              title="Revenue"
              value={formatMoney(gross)}
              loading={loading}
              tone="green"
              icon={<IconDollar />}
              trend={{ value: 12.5, label: "vs last period" }}
            />
            <KpiCard
              title="Net Revenue"
              value={formatMoney(net)}
              loading={loading}
              tone="green"
              icon={<IconDollar />}
            />
            <KpiCard
              title="Tax Collected"
              value={formatMoney(tax)}
              loading={loading}
              tone="neutral"
              icon={<IconCreditCard />}
            />
            <KpiCard
              title="Payments Captured"
              value={formatMoney(summary?.payments.capturedCents ?? 0)}
              loading={loading}
              tone="blue"
              icon={<IconCreditCard />}
            />
            <KpiCard
              title="Total Orders"
              value={totalOrders}
              loading={loading}
              tone="blue"
              icon={<IconCart />}
              trend={{ value: 0, label: "vs yesterday" }}
            />
            <KpiCard
              title="Completed Sales"
              value={completedOrders}
              loading={loading}
              tone="green"
              icon={<IconPackage />}
            />
            <KpiCard
              title="Open Orders"
              value={openOrders}
              loading={loading}
              tone="amber"
              icon={<IconCart />}
            />
            <KpiCard
              title="Avg Order Value"
              value={formatMoney(avgOrderCents)}
              loading={loading}
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <QuickActionCard href="/terminal" label="New Sale" icon={<IconRegister />} />
            <QuickActionCard href="/inventory/products/new" label="Add Product" icon={<IconPlus />} />
            <QuickActionCard href="/reports" label="View Reports" icon={<IconChart />} />
            <QuickActionCard href="/inventory" label="Manage Inventory" icon={<IconBox />} />
          </div>
        </section>


      </div>
    </EnterpriseShell>
  );
}
