"use client";

/**
 * /dashboard — POS management overview.
 *
 * Shows KPI tiles, top products, top customers, quick-access action links,
 * and a payment-method breakdown — all driven by a date-range picker.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { apiGet, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";

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

// ─── Skeleton primitives ──────────────────────────────────────────────────────

function SkeletonBox({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded bg-gray-200 ${className}`}
    />
  );
}

// ─── KPI Tile ─────────────────────────────────────────────────────────────────

function KpiTile({
  label,
  value,
  loading,
}: {
  label: string;
  value: string | number;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>
      {loading ? (
        <SkeletonBox className="mt-2 h-8 w-3/4" />
      ) : (
        <p className="mt-2 text-2xl font-bold text-gray-900 tabular-nums">
          {value}
        </p>
      )}
    </div>
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
      className="flex flex-col items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white p-6 text-center transition-colors hover:border-brand-300 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-700">
        {icon}
      </span>
      <span className="text-sm font-semibold text-gray-800">{label}</span>
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

  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [topProducts, setTopProducts] = useState<TopProductItem[]>([]);
  const [topCustomers, setTopCustomers] = useState<TopCustomerItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const [summaryData, productsData, customersData] = await Promise.all([
          apiGet<SummaryResponse>(`/api/v1/reports/summary?range=${range}`, { signal }),
          apiGet<TopProductsResponse>(`/api/v1/reports/top-products?range=${range}&limit=5`, { signal }),
          apiGet<TopCustomersResponse>(`/api/v1/reports/sales-by-customer?range=${range}`, { signal }),
        ]);
        setSummary(summaryData);
        setTopProducts(productsData.items);
        setTopCustomers(customersData.items);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setError(
          err instanceof ApiResponseError ? err.message : "Failed to load dashboard data."
        );
      } finally {
        setLoading(false);
      }
    },
    [range]
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchAll(controller.signal);
    return () => controller.abort();
  }, [fetchAll]);

  // ── Derived KPI values ────────────────────────────────────────────────────

  const gross = summary?.revenue.grossCents ?? 0;
  const net = summary?.revenue.netCents ?? 0;
  const tax = summary?.revenue.taxCents ?? 0;
  const totalOrders = summary?.orders.total ?? 0;
  const completedOrders = summary?.orders.completed ?? 0;
  const openOrders = summary?.orders.open ?? 0;
  const capturedCents = summary?.payments.capturedCents ?? 0;
  const avgOrderCents =
    completedOrders > 0 ? Math.trunc(gross / completedOrders) : 0;
  const byMethod = summary?.payments.byMethod ?? {};
  const methodEntries = Object.entries(byMethod);

  return (
    <EnterpriseShell
      active="dashboard"
      title="Dashboard"
      subtitle={`Overview · Demo Store · ${rangeLabel(range)}`}
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-7xl px-4 py-6 space-y-6">

        {/* ── Date range toggle ──────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-gray-900">
            Business Overview
          </h1>
          <div
            role="group"
            aria-label="Date range"
            className="inline-flex rounded-lg border border-gray-200 bg-white p-1"
          >
            {(["today", "7d", "30d"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                aria-pressed={range === r}
                className={`min-h-[36px] rounded-md px-4 text-sm font-medium transition-colors ${
                  range === r
                    ? "bg-brand-600 text-white shadow-sm"
                    : "text-gray-600 hover:bg-gray-100"
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

        {/* ── KPI tile grid ──────────────────────────────────────────────── */}
        <section aria-label="Key performance indicators">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiTile label="Revenue" value={formatMoney(gross)} loading={loading} />
            <KpiTile label="Net Revenue" value={formatMoney(net)} loading={loading} />
            <KpiTile label="Tax Collected" value={formatMoney(tax)} loading={loading} />
            <KpiTile label="Payments Captured" value={formatMoney(capturedCents)} loading={loading} />
            <KpiTile label="Total Orders" value={totalOrders} loading={loading} />
            <KpiTile label="Completed Sales" value={completedOrders} loading={loading} />
            <KpiTile label="Open Orders" value={openOrders} loading={loading} />
            <KpiTile label="Avg Order Value" value={formatMoney(avgOrderCents)} loading={loading} />
          </div>
        </section>

        {/* ── Top Products & Top Customers ───────────────────────────────── */}
        <section
          aria-label="Top products and customers"
          className="grid grid-cols-1 gap-6 md:grid-cols-2"
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
              <p className="px-5 py-4 text-sm text-gray-500">No data for this period.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left">
                    <th className="px-5 py-3 font-medium text-gray-600">Product</th>
                    <th className="px-3 py-3 font-medium text-gray-600 text-right">Qty</th>
                    <th className="px-5 py-3 font-medium text-gray-600 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {topProducts.map((p) => (
                    <tr
                      key={p.id}
                      className="transition-colors hover:bg-gray-50"
                    >
                      <td className="px-5 py-3">
                        <Link
                          href={`/inventory/products/${p.id}`}
                          className="font-medium text-brand-600 hover:underline"
                        >
                          {p.name}
                        </Link>
                        {p.category && (
                          <span className="ml-2 text-xs text-gray-400">
                            {p.category}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-gray-700">
                        {p.qty}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-gray-700">
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
              <p className="px-5 py-4 text-sm text-gray-500">No data for this period.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left">
                    <th className="px-5 py-3 font-medium text-gray-600">Customer</th>
                    <th className="px-3 py-3 font-medium text-gray-600 text-right">Orders</th>
                    <th className="px-5 py-3 font-medium text-gray-600 text-right">Total Spent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {topCustomers.map((c) => (
                    <tr
                      key={c.customer_id}
                      className="transition-colors hover:bg-gray-50"
                    >
                      <td className="px-5 py-3">
                        <Link
                          href={`/customers/${c.customer_id}`}
                          className="font-medium text-brand-600 hover:underline"
                        >
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-gray-700">
                        {c.orderCount}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-gray-700">
                        {formatMoney(c.totalCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </section>

        {/* ── Quick-access action grid ───────────────────────────────────── */}
        <section aria-label="Quick actions">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Quick Actions
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <QuickActionCard href="/terminal" label="New Sale" icon={<IconRegister />} />
            <QuickActionCard href="/inventory/products/new" label="Add Product" icon={<IconPlus />} />
            <QuickActionCard href="/reports" label="View Reports" icon={<IconChart />} />
            <QuickActionCard href="/inventory" label="Manage Inventory" icon={<IconBox />} />
          </div>
        </section>

        {/* ── Payment breakdown ──────────────────────────────────────────── */}
        {loading && (
          <section aria-label="Payment method breakdown" aria-busy="true">
            <Card title="Payment Methods">
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <SkeletonBox key={i} className="h-8 w-full" />
                ))}
              </div>
            </Card>
          </section>
        )}

        {!loading && methodEntries.length > 0 && (
          <section aria-label="Payment method breakdown">
            <Card title="Payment Methods">
              <div className="space-y-3">
                {methodEntries.map(([method, cents]) => {
                  const totalMethodCents = methodEntries.reduce(
                    (sum, [, v]) => sum + v,
                    0
                  );
                  const pct =
                    totalMethodCents > 0
                      ? Math.round((cents / totalMethodCents) * 100)
                      : 0;
                  return (
                    <div key={method}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="font-medium capitalize text-gray-700">
                          {method}
                        </span>
                        <span className="tabular-nums text-gray-600">
                          {formatMoney(cents)}{" "}
                          <span className="text-xs text-gray-400">({pct}%)</span>
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-2 rounded-full bg-brand-500 transition-all"
                          style={{ width: `${pct}%` }}
                          role="progressbar"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${method}: ${pct}%`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </section>
        )}

      </div>
    </EnterpriseShell>
  );
}
