"use client";

import { useState, useCallback, useEffect } from "react";
import { useQuery, invalidateQuery } from "@/lib/useQuery";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { apiGet, apiPost } from "@/api-client/client";
import { useFinderContext, type FinderDateRange } from "@/lib/useFinderContext";
import { useRealtimeStream } from "@/hooks/useRealtimeStream";
import { VerticalWidgets } from "@/components/dashboard/VerticalWidgets";
import { RetailSetupChecklist } from "@/components/setup/RetailSetupChecklist";
import { usePermissions } from "@/contexts/PermissionsContext";
import { PendingApprovalsPanel } from "./_components/PendingApprovalsPanel";
import { AdminShortcuts } from "./_components/AdminShortcuts";
import { DashboardTopLists } from "./_components/DashboardTopLists";
import { DashboardOperational } from "./_components/DashboardOperational";
import { DashboardKpiSection } from "./_components/DashboardKpiSection";
import { DashboardCharts } from "./_components/DashboardCharts";
import { DashboardQuickActions } from "./_components/DashboardQuickActions";
import { DashboardRecommendations, type RecommendationReport, type DashboardRecommendation } from "./_components/DashboardRecommendations";
import ProgressPanel from "./_components/ProgressPanel";

// Map each actionable recommendation signal to the progress verification source
// Ascend can prove it from — so a recommendation-born task can later be
// system-verified against real data. Signals without a data check stay manual.
const SIGNAL_TO_VERIFICATION: Record<string, string> = {
  no_products: "retail.first_product",
  products_without_cost: "retail.cost_prices_complete",
  out_of_stock: "retail.first_receiving",
  low_stock: "retail.first_receiving",
  no_sales_yet: "retail.first_sale",
  uncategorized_expenses: "retail.expenses_categorized",
};

// ─── Types ────────────────────────────────────────────────────────────────────

type Range = "today" | "7d" | "30d";

interface SummaryResponse {
  orders: { open: number; completed: number; refunded: number; voided: number; total: number };
  revenue: { grossCents: number; taxCents: number; netCents: number };
  payments: { capturedCount: number; capturedCents: number; byMethod: Record<string, number> };
  kpi?: {
    saleCount: number; grossProfitCents: number | null; customerCount: number;
    avgSaleValueCents: number; avgItemsPerSale: number;
    discountedAmountCents: number; discountedPct: number;
  };
  sparklines?: { revenue: number[]; saleCount: number[] };
}

interface OutletItem { id: string; name: string; }

interface TopProductItem {
  id?: string; productId?: string; sku?: string; name: string; category?: string;
  revenue?: number; revenueCents?: number; qty?: number; units?: number;
}
interface TopProductsResponse { items: TopProductItem[]; }

interface TopCustomerItem {
  customer_id?: string; key?: string; name: string;
  totalCents?: number; revenueCents?: number; orderCount?: number; units?: number;
}
interface TopCustomersResponse { items: TopCustomerItem[]; }

interface TrendDay { date: string; label: string; revenueCents: number; orderCount: number; }
interface TrendResponse { items: TrendDay[]; }

interface HourlyBucket { hour: number; label: string; orderCount: number; revenueCents: number; value: number; }
interface HourlyResponse { items: HourlyBucket[]; }

interface CategoryItem { key: string; name: string; units: number; revenueCents: number; }
interface CategoryResponse { items: CategoryItem[]; }

interface LowStockItem {
  id: string; sku: string; name: string; category: string;
  onHand: number; reorderPoint: number; lowStock: boolean;
}
interface DashNotification {
  id: string; type: string; severity: string; title: string; body: string; read: boolean; created_at: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  const iso = (v: Date) => v.toISOString().slice(0, 10);
  return { startDate: iso(start), endDate: iso(end), preset };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { storeId, outletId, dateRange, granularity, setDateRange, setGranularity } = useFinderContext();
  const { role } = usePermissions();
  // Mirrors the backend's own approver set (owner/admin unconditionally, manager
  // up to their tier limit — enforced server-side either way) rather than
  // owner-only, so the workspace never hides a control a manager can really use.
  const isApprover = role === "owner" || role === "admin" || role === "manager";
  const range: Range = dateRange.preset === "today" ? "today" : dateRange.preset === "current_month" ? "30d" : "7d";
  const scope = new URLSearchParams({ store_id: storeId, outlet_id: outletId }).toString();

  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [recentNotifs, setRecentNotifs] = useState<DashNotification[]>([]);
  const [outlets, setOutlets] = useState<OutletItem[]>([]);
  const [selectedOutletId, setSelectedOutletId] = useState<string>(outletId);
  const [progressRefresh, setProgressRefresh] = useState(0);

  useEffect(() => {
    apiGet<{ items: LowStockItem[] }>("/api/v1/inventory/levels?pageSize=200")
      .then((d) => setLowStock((d.items ?? []).filter((i) => i.lowStock).slice(0, 5)))
      .catch(() => {});
    apiGet<{ items: DashNotification[] }>("/api/v1/notifications?limit=5")
      .then((d) => setRecentNotifs(d.items ?? []))
      .catch(() => {});
    apiGet<{ items: OutletItem[] }>("/api/v1/outlets")
      .then((d) => setOutlets(d.items ?? []))
      .catch(() => {});
  }, []);

  const trendRange = range === "today" ? "7d" : range;

  const fetchSummary = useCallback(() => apiGet<SummaryResponse>(`/api/v1/reports/summary?range=${range}&${scope}`), [range, scope]);
  const fetchTopProducts = useCallback(() => apiGet<TopProductsResponse>(`/api/v1/reports/top-products?range=${range}&limit=5&${scope}`), [range, scope]);
  const fetchTopCustomers = useCallback(() => apiGet<TopCustomersResponse>(`/api/v1/reports/sales-by-customer?range=${range}&${scope}`), [range, scope]);
  const fetchTrend = useCallback(() => apiGet<TrendResponse>(`/api/v1/reports/revenue-trend?range=${trendRange}&${scope}`), [scope, trendRange]);
  const fetchHourly = useCallback(() => apiGet<HourlyResponse>(`/api/v1/reports/hourly?range=${range}&${scope}`), [range, scope]);
  const fetchCategory = useCallback(() => apiGet<CategoryResponse>(`/api/v1/reports/sales-by-category?range=${range}&${scope}`), [range, scope]);
  const fetchRecommendations = useCallback(() => apiGet<RecommendationReport>("/api/v1/reports/recommendations?recentDays=30"), []);

  // Turn a recommendation into a progress task, carrying the linked source
  // context (the reason, the destination, and the data source it verifies from).
  const onTrackRecommendation = useCallback(async (rec: DashboardRecommendation) => {
    await apiPost("/api/v1/progress/tasks", {
      title: rec.title,
      description: `${rec.detail}\n\nRecommended: ${rec.action} → ${rec.href}`,
      category: `recommendation:${rec.category}`,
      verificationSource: (rec.signalCode && SIGNAL_TO_VERIFICATION[rec.signalCode]) || null,
    });
    setProgressRefresh((n) => n + 1);
  }, []);

  useRealtimeStream(
    useCallback((event) => {
      if (event.type === "order_created" || event.type === "payment_captured") {
        invalidateQuery(`dashboard:summary:${range}:${scope}`);
        invalidateQuery(`dashboard:top-products:${range}:${scope}`);
        invalidateQuery("dashboard:recommendations:30d");
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
  const { data: recommendationsData, loading: loadingRecommendations, error: errorRecommendations } =
    useQuery("dashboard:recommendations:30d", fetchRecommendations, { staleMs: 60_000 });

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

  const trendPoints = (trendData?.items ?? []).map((d) => ({ label: d.label, value: d.revenueCents }));
  const hourlyPoints = (hourlyData?.items ?? []).map((d) => ({ label: d.label, value: d.revenueCents }));
  const categoryItems = (categoryData?.items ?? []).slice(0, 6);

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

        {/* ── Retail setup checklist (auto-hides when complete or dismissed) ── */}
        <RetailSetupChecklist />

        {/* ── Executive workspace: owner/admin/manager only ───────────────── */}
        {isApprover && (
          <div className="space-y-5 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <PendingApprovalsPanel />
            <AdminShortcuts />
          </div>
        )}

        {/* ── Filter bar ───────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-table-border)] pb-4">
          <div>
            <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Business Overview</h1>
            <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
              Revenue, orders, inventory movement, and tender mix.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {outlets.length > 0 && (
              <select
                aria-label="Filter by outlet"
                value={selectedOutletId}
                onChange={(e) => setSelectedOutletId(e.target.value)}
                className="h-8 rounded border border-slate-200 bg-white px-3 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-brand-600"
              >
                <option value="">All Outlets</option>
                {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
            <div role="group" aria-label="Report granularity" className="inline-flex rounded-md border border-slate-200 bg-white p-1">
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
              className="h-8 rounded border border-slate-200 bg-white px-3 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-brand-600"
            >
              <option value="today">Today</option>
              <option value="current_week">This Week</option>
              <option value="current_month">This Month</option>
            </select>
          </div>
        </div>

        {errorSummary && !loading && (
          <Card><p role="alert" className="text-sm text-danger-500">{errorSummary}</p></Card>
        )}

        <DashboardKpiSection
          loading={loadingSummary}
          gross={gross}
          saleCount={saleCount}
          grossProfit={grossProfit}
          customerCount={customerCount}
          avgSaleValue={avgSaleValue}
          avgItems={avgItems}
          discountedAmt={discountedAmt}
          discountedPct={discountedPct}
          sparkRev={sparkRev}
          sparkSales={sparkSales}
        />

        <DashboardRecommendations
          report={recommendationsData}
          loading={loadingRecommendations}
          error={errorRecommendations}
          onTrackTask={onTrackRecommendation}
        />

        <ProgressPanel refreshSignal={progressRefresh} />

        <DashboardCharts
          trendPoints={trendPoints}
          hourlyPoints={hourlyPoints}
          paymentsByMethod={summary?.payments.byMethod}
          loadingTrend={loadingTrend}
          loadingHourly={loadingHourly}
          loadingPayments={loading}
          trendRange={trendRange}
        />

        <DashboardTopLists
          topProducts={topProducts}
          topCustomers={topCustomers}
          categoryItems={categoryItems}
          loading={loading}
          loadingCategory={loadingCategory}
        />

        <DashboardQuickActions />

        <VerticalWidgets />

        <DashboardOperational lowStock={lowStock} recentNotifs={recentNotifs} />

      </div>
    </EnterpriseShell>
  );
}
